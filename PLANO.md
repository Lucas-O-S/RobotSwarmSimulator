# RobotSwarmSimulator — Parecer + Plano de Arquitetura

> Simulador que impersona **gateway + frota de robôs** do ecossistema
> [DotBots](https://github.com/DotBots) pra um backend customizado (o
> [TCC_Swarm_Robots](https://github.com/Lucas-O-S/TCC_Swarm_Robots), NestJS),
> **sem hardware**. Prioridade: **fidelidade funcional/lógica** — comportar-se
> o mais perto possível da vida real, excluindo a parte física (dinâmica de
> roda, rádio de verdade). Fidelidade visual **não** é objetivo.
>
> Este repo é o simulador; o backend vive em outro repo. Separação proposital.

## 1. Parecer: é possível? Sim, com alta fidelidade funcional.

O DotBot foi arquitetado em camadas com uma fronteira de troca bem definida
(o **gateway**), e o próprio PyDotBot já traz um simulador embutido
(`dotbot run simulator`). Reproduzir o *comportamento* (não a física) é
viável porque todo o comportamento observável do sistema trafega como
**mensagens** num contrato bem documentado. Se o simulador emitir/consumir
exatamente essas mensagens, o backend não distingue simulador de frota real.

O que **excluímos** (parte física): dinâmica mecânica das rodas, rádio BLE/TSCH
real, localização Lighthouse física. O que **mantemos** (parte funcional):
protocolo, ciclo de vida da rede, loop de telemetria, modos de controle,
envelhecimento de estado, perda de pacote/latência lógicas, e a orquestração
do enxame.

## 2. As 4 camadas do DotBot (quem fala com quem)

```text
web UI / CLI / seu código ──REST/WS──▶ controller ──serial/MQTT──▶ gateway ──rádio──▶ 🤖🤖🤖
                           ╰──────────── control plane ───────────╯
```

- **control plane** = o seu **backend NestJS** (papel do `dotbot/controller.py`):
  guarda o estado da frota em memória, recebe comandos, publica telemetria.
- **transporte** = **serial** (cabo) OU **MQTT** (cloud), intercambiáveis atrás
  da mesma interface (`marilib`).
- **gateway** = ponte UART↔rádio (ou UART↔MQTT). **É o que o simulador vai
  impersonar.**
- **rádio + robôs** = a rede Mari + firmware dos DotBots. **O simulador emula
  o comportamento lógico deles.**

Fato estrutural que sustenta o projeto: **PyDotBot e swarmit falam ambos com o
mesmo contrato de gateway (`marilib`).** Se o simulador imita esse contrato, os
dois paradigmas (dirigir a frota + orquestrar experimentos) funcionam sem
alteração.

## 3. MQTT — o que é e por que é a fronteira certa

MQTT é um protocolo **publish/subscribe** leve sobre TCP, feito pra IoT.

- **Broker**: servidor central (ex.: Mosquitto). Todos conectam nele; ninguém
  fala direto com ninguém.
- **Publish/Subscribe por tópico**: publica-se numa string de tópico; quem
  está inscrito recebe. Publicador e assinante são desacoplados.
- **QoS** 0/1/2 (o DotBots usa **0**, "dispara e esquece").
- **`mqtt://`** (texto) vs **`mqtts://`** (TLS, porta 8883).
- No **navegador**: MQTT roda por cima de **WebSocket** — o simulador em TS
  consegue falar MQTT direto do browser.

### Como o DotBot usa MQTT (o caminho "cloud")

O gateway físico é só uma ponte UART↔MQTT. Dois tópicos, namespaced pelo
`network_id` (4 dígitos hex, maiúsculos):

```text
/mari/{NETID}/to_edge     # control plane → gateway   (comandos descendo)
/mari/{NETID}/to_cloud    # gateway → control plane   (eventos + telemetria subindo)
```

- Conteúdo: **`base64( [1 byte EdgeEvent] + [frame Mari] )`** — o **mesmo**
  stream de bytes que iria pela serial, só que relayado por MQTT.
- QoS 0, MQTT v5.
- O **edge** (gateway) inscreve em `to_edge`, publica em `to_cloud`. O **cloud**
  (seu backend) faz o oposto.

**Por isso o MQTT é a fronteira de fidelidade máxima:** publicando/assinando
exatamente nesses tópicos com esse enquadramento, o backend NestJS
(fazendo o papel de "cloud control plane") não distingue o simulador de um
gateway real com frota real.

## 4. Contrato funcional a reproduzir (a "vida real", sem física)

### 4.1 Enquadramento do gateway (camada Mari)

`EdgeEvent` — o primeiro byte de cada mensagem no wire do gateway
(`marilib/model.py`):

| Valor | EdgeEvent | Direção | Papel |
| --- | --- | --- | --- |
| 1 | `NODE_JOINED` | uplink | robô entrou na rede (emitido 1×) |
| 2 | `NODE_LEFT` | uplink | robô saiu |
| 3 | `NODE_DATA` | ambos | carrega um frame de aplicação |
| 4 | `NODE_KEEP_ALIVE` | uplink | robô ainda vivo (periódico) |
| 5 | `GATEWAY_INFO` | uplink | o gateway se descrevendo |
| 255 | `UNKNOWN` | — | — |

**Frame Mari** (`marilib/mari_protocol.py`): header de 20 B
(`version=2 : 1`, `type : 1`, `network_id : 2`, `destination : 8`,
`source : 8`), +1 B de `rssi` só no uplink, + payload. Endereço de broadcast:
`0xFFFFFFFFFFFFFFFF`.

> Nota importante pra backend que se conecta tarde: `NODE_JOINED` é publicado
> **uma vez** e não é retido no MQTT. O lado cloud **auto-adiciona** nós
> desconhecidos ao ver qualquer `NODE_DATA`/`NODE_KEEP_ALIVE`. O simulador deve
> reemitir keep-alives pra que um backend recém-conectado descubra a frota.

### 4.2 Demux de protocolo superior

Dentro de `NODE_DATA` há um `next_proto`:

- `DOTBOT_APP` — dirigir/telemetria (PyDotBot).
- `SWARMIT_TESTBED` — orquestração (swarmit).

Uma mesma rede carrega os dois; o adaptador filtra por `next_proto`.

### 4.3 Payloads da aplicação DotBot (`dotbot/protocol.py`)

| Direção | Tipo (hex) | Campos | Papel |
| --- | --- | --- | --- |
| ↓ consome | `CMD_MOVE_RAW` 0x00 | `left_x,left_y,right_x,right_y` (int8) | joystick (MANUAL) |
| ↓ consome | `CMD_RGB_LED` 0x01 | `red,green,blue` | LED/cor |
| ↓ consome | `CONTROL_MODE` 0x07 | `mode` | MANUAL↔AUTO |
| ↓ consome | `LH2_WAYPOINTS` 0x08 | `threshold, count, waypoints[x,y]` | rota (AUTO) |
| ↑ produz | `DOTBOT_ADVERTISEMENT` 0x06 | `calibrated, direction, pos_x, pos_y, battery, pwm_l/r, mode, enc_l/r, waypoint_x/y/idx` | **telemetria (~500ms)** |
| ↑ produz | `ADVERTISEMENT` 0x04 | `application` | robô entrando |
| ↑ produz | `DOTBOT_SIMULATOR_DATA` 0xFA | `theta, pos_x, pos_y` | pose enxuta (reservada p/ sim) |

Enums a manter idênticos ao backend: `ApplicationType` (0=DotBot…4=LH2_mini_mote),
`ControlModeType` (0=Manual,1=Auto), `RobotStatus`.

### 4.4 Loop de comportamento do robô (o contrato inteiro)

Espelha o `DotBotSimulator` do PyDotBot (`dotbot/dotbot_simulator.py`), sem a
física realista:

1. **advertise** — a cada `~500ms`, publica `DOTBOT_ADVERTISEMENT` com o estado
   atual.
2. **rx** — reage a comandos descendo: `CMD_MOVE_RAW` → MANUAL + define
   velocidades; `LH2_WAYPOINTS` → AUTO + carrega rota; `CMD_RGB_LED`,
   `CONTROL_MODE`.
3. **movimento** — integra pose num tick fixo (cinemática **simples** de tração
   diferencial; sem modelo físico fiel). Em AUTO, controlador de waypoint até
   `threshold`, avançando `waypoint_idx`.
4. **bateria** — decai com tempo/uso (linear basta).

### 4.5 Envelhecimento de estado (no lado do controller/backend)

O controller marca cada robô: `ACTIVE` → `INACTIVE` após 5s sem telemetria →
`LOST` após 60s. Na camada Mari, nó é considerado morto após ~3s sem
keep-alive. Reproduzir isso é o que habilita testar **reatividade**
(reatribuir task de um robô `LOST`, etc.).

### 4.6 (Opcional) Fidelidade de rede

O simulador oficial modela **PDR** (perda de pacote, 0–100%) e **latência de
slot TSCH** (~63–150ms) sem rádio. Bom pra testar robustez do backend a
mensagens perdidas/atrasadas. Fase posterior.

### 4.7 (Opcional) Orquestração swarmit (`next_proto=SWARMIT_TESTBED`)

Máquina de estados por dispositivo: `Bootloader(0) → Programming(4) → Running(1)`
(+ `Stopping`, `Resetting`). Payloads `0x80–0xA2`:

- `status`: nó emite heartbeat `SWARMIT_STATUS {device, status, battery, pos_x, pos_y}`.
- `flash` = `OTA_START` (SHA-256, nº de chunks) → chunks de **128 B** com
  `OTA_CHUNK_ACK` por índice (ARQ pare-e-espere sobre link não confiável).
- `start`/`stop`/`reset`/`message`/`calibrate-lh2`/`monitor` (eventos de log).
- Servidor `swarmit serve` (FastAPI) usa **JWT (Ed25519)** com reservas de slot
  de 30min — o mesmo caminho de auth que o seu backend já adotou.

Reproduzir isso dá ao simulador o lado **automatizado** do enxame que o
`AGENTS.md` quer (`Task` com conteúdo real, flash/start/stop de "programas").

## 5. Recomendação de conexão

**Recomendado — fronteira MQTT/marilib (fidelidade máxima).** O simulador
publica/assina em `/mari/{NETID}/to_edge|to_cloud` e o backend ganha um
adaptador MQTT espelhando o `cloud adapter` do PyDotBot. Você já usa Docker →
sobe um **Mosquitto** num container. O backend passa a viver o mesmo caminho de
um deploy real.

```text
[ RobotSwarmSimulator (browser/TS) ]  ⇄ MQTT(WS) ⇄  [ Mosquitto ]  ⇄ MQTT ⇄  [ backend NestJS ]
        emula gateway + frota                          broker              control plane (cloud)
```

**Fallback — WebSocket/JSON no backend (fidelidade média).** O simulador
conecta no WebSocket do próprio backend trafegando os mesmos *campos/enums* em
JSON. Menos código, sem broker, mas o backend não exercita o protocolo de
gateway de verdade.

> **DECIDIDO:** adotar MQTT no backend (fidelidade máxima). Sobe Mosquitto no
> Docker e o backend NestJS ganha um adaptador MQTT espelhando o cloud adapter
> do PyDotBot. O fallback WS/JSON fica descartado como caminho principal.

### Interface `FleetLink`

De qualquer forma, o núcleo do simulador conversa com o mundo por uma interface
única (`onCommand(cb)` / `publishTelemetry(...)`), com implementações
plugáveis: `MqttLink` (recomendada) e/ou `WsJsonLink` (fallback). Espelha o
`dotbot/adapter.py`, que troca serial/MQTT/simulador atrás de uma interface.

## 6. Estrutura proposta do repo

```text
RobotSwarmSimulator/
  src/
    core/            # independente de UI e de transporte (testável headless)
      World.ts       # arena, grid, obstáculos, tick de tempo
      Robot.ts       # estado + cinemática simples + bateria
      waypoints.ts   # controlador de rota (modo AUTO)
      scenario.ts    # (de)serialização do cenário (JSON)
    net/             # fidelidade de rede (lógica, sem rádio)
      lifecycle.ts   # NODE_JOINED / KEEP_ALIVE / LEFT / GATEWAY_INFO
      pdr.ts         # perda de pacote + latência de slot (opcional)
    protocol/        # espelha src/Protocol do backend
      dotbot.ts      # payloads 0x00..0xFA + enums
      mari.ts        # frame Mari + EdgeEvent + next_proto
      swarmit.ts     # payloads 0x80..0xA2 + máquina de estados (opcional)
      codec.ts       # encode/decode binário (paridade byte-a-byte)
    link/
      FleetLink.ts   # interface
      MqttLink.ts    # impl recomendada (MQTT sobre WebSocket)
      WsJsonLink.ts  # impl fallback
    ui/              # 2D topo, minimalista (fidelidade visual não é meta)
      MapView.tsx    # grid + robôs (pontos/setas) + barreiras (retângulos)
      ScenarioEditor.tsx  # desenhar/mover/redimensionar barreiras e robôs
      Inspector.tsx  # telemetria por robô + config do broker/tópico
```

Stack: **React + TypeScript + Vite** (mesma base do PyDotBot). Núcleo `core/`
sem dependência de React → testável em unidade e, se quiser, num Web Worker.
Cliente MQTT no browser: `mqtt.js` (suporta MQTT-over-WebSocket).

## 7. Modelo de cenário (rascunho JSON)

```jsonc
{
  "version": 1,
  "network": { "id": "1200", "gateway_addr": "0000000000000001" },
  "arena":   { "width_mm": 4000, "height_mm": 4000, "grid_mm": 100 },
  "obstacles": [
    { "id": "wall-1", "x_mm": 1000, "y_mm": 500, "w_mm": 200, "h_mm": 1500 }
  ],
  "robots": [
    { "address": "BDF2B04BC00D2725", "application": 0, "mode": 0,
      "start": { "x_mm": 200, "y_mm": 200, "theta_deg": 90 }, "battery": 100 }
  ],
  "sim": { "tick_hz": 50, "advertise_hz": 2, "battery_drain_per_min": 1.0,
           "pdr_percent": 100, "slot_latency_ms": 0 }
}
```

Unidades em mm (o mundo LH2 usa x/y de 4 bytes). `address` em hex 16 chars
(bate com `VARCHAR(16)` do `init.sql`). `network.id` em 4 hex (swarmit=`1200`).

## 8. Roadmap incremental

1. **Núcleo headless** — `World`+`Robot`+waypoints; 1 robô obedecendo move-raw;
   teste unitário do movimento. (não depende de backend nem broker)
2. **Mapa 2D read-only** — desenhar grid/robô/barreiras de um JSON fixo.
3. **Editor de cenário** — desenhar/mover/redimensionar; salvar/carregar JSON.
4. **`protocol/` + `codec.ts`** — payloads DotBot + frame Mari + EdgeEvents.
5. **`MqttLink` + Mosquitto (Docker)** — publicar `to_cloud`, assinar
   `to_edge`; ciclo de vida (join/keep-alive/leave) + advertisement loop.
   Backend ganha o adaptador MQTT. **Ponta-a-ponta.**
6. **Modo AUTO + múltiplos robôs + envelhecimento de estado.**
7. **(Opcional) PDR/latência** e **(opcional) camada swarmit** (state machine +
   OTA chunk/ack).

Cada fase é demonstrável sozinha — bom pro TCC e evita travar tudo numa
dependência do backend.

## 9. Riscos / pré-requisitos

- **Backend precisa de um adaptador MQTT** (DECIDIDO na seção 5) — hoje é só
  REST + WS planejado. Trabalho a fazer no repo do backend: cliente MQTT
  (ex.: `@nestjs/microservices` transport MQTT ou lib `mqtt`), Mosquitto no
  `docker-compose`, e o encode/decode do frame Mari + EdgeEvents.
- **`RobotsGateway`/`SwarmService` do backend ainda não existem** (pendentes no
  `AGENTS.md`); Fases 1–4 não dependem deles.
- **Paridade byte-a-byte** só é garantida quando `protocol/codec.ts` (aqui) e
  `src/Protocol/` (backend) estiverem alinhados. Antes disso, trafegar os
  mesmos campos em JSON mantém a transição mecânica.
- **Contrato exato** (tópicos, `network_id`, formato) deve ser fixado e anotado
  no `AGENTS.md` do backend antes da Fase 5.

## 10. Referências (repos DotBots)

- `PyDotBot/dotbot/{controller,adapter,protocol,dotbot_simulator,server}.py`
- `marilib/marilib/{communication_adapter,mari_protocol,model,marilib_edge,marilib_cloud}.py`
- `swarmit/swarmit/{cli/main,server/main,testbed/{protocol,adapter,controller,webserver,model}}.py`
- `mari` (README — modelo TSCH-over-BLE, join/handover, latência)
