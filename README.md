# RobotSwarmSimulator

Simulador de enxame de robôs que **imita, por software, um gateway e uma frota
de robôs do ecossistema [DotBots](https://github.com/DotBots)** — para você
desenvolver e testar um sistema de controle (backend) **sem hardware nenhum**.

A prioridade é **fidelidade funcional/lógica**, não física: o simulador
reproduz o *comportamento observável* do sistema real (as mensagens que
trafegam, o ciclo de vida da rede, os modos de controle, a orquestração), mas
com uma cinemática de movimento simples — sem dinâmica mecânica de rodas nem
rádio de verdade. A ideia é que, do ponto de vista de quem controla a frota, o
simulador seja **indistinguível de hardware real**.

Fidelidade visual não é objetivo: a interface é 2D, de topo, minimalista.

---

## A ideia em uma imagem

No sistema real, o controle de uma frota DotBot tem quatro camadas:

```
seu backend ──REST/WS/MQTT──▶ gateway ──rádio──▶ 🤖🤖🤖 robôs
(control plane)                (ponte)            (firmware)
```

O **gateway** é uma ponte: converte comandos que descem em pacotes de rádio, e
telemetria que sobe em mensagens para o backend. O `RobotSwarmSimulator`
**substitui o gateway + os robôs**: ele fala o mesmo protocolo (tópicos MQTT,
frames Mari, payloads DotBot) e simula o movimento dos robôs. O seu backend
conversa com ele como conversaria com o hardware — basta apontar para o mesmo
broker MQTT.

Por isso o simulador **não é amarrado a nenhum backend específico**: qualquer
control plane que fale o padrão do DotBot (o seu, o PyDotBot, o swarmit, ou
qualquer código seu) funciona com ele. "Trocar de sistema" é trocar a URL do
broker.

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18+ (testado no 20/22)
- [Docker](https://www.docker.com/) — opcional, só para subir o broker MQTT
  (Mosquitto) quando for conectar um backend de verdade

Instale as dependências uma vez:

```bash
npm install
```

---

## Como usar

### 1. Interface visual (o jeito mais fácil de ver funcionando)

```bash
npm run dev
```

Abre em `http://localhost:5173`. A tela tem dois modos:

**Editar** — monte o cenário:

- desenhe **barreiras** (retângulos) arrastando na arena; selecione para
  mover, redimensionar (alças) ou apagar;
- adicione **robôs**, posicione, gire o heading e edite as propriedades
  (endereço, modo Manual/Automático, bateria e, no modo automático, a lista de
  waypoints e se a rota é em loop);
- **salve/replique** a configuração completa pela ferramenta **"Importar /
  Exportar"** (no topo): baixar/carregar um arquivo `.json` ou copiar/colar o
  JSON. Um cenário guarda **tudo** — tamanho do mapa, grid, barreiras, rede,
  parâmetros de simulação (tick, PDR/latência) e todos os robôs (endereço,
  modo, pose, bateria, waypoints, loop e cor do LED). No modo Simular há também
  **"Exportar estado"**, que salva as poses correntes como um novo cenário.

**Simular** — rode o cenário em tempo real:

- controles **Play / Pause / Reset**;
- robôs em modo automático seguem seus waypoints; barreiras e as bordas da
  arena bloqueiam o movimento, e **os robôs não se atravessam** (colisão entre
  eles);
- botão **"Move-raw teste"** empurra um robô manual para demonstrar movimento;
- no painel lateral, cada robô mostra posição, ângulo, modo, bateria e estado
  na rede — e dá para **derrubar/religar** um robô (simular falha) para ver a
  frota reagir;
- menu **"Configurações de rede"**: liga/desliga e ajusta perda de pacote
  (PDR), latência e jitter ao vivo, para testar a robustez do backend a
  mensagens perdidas ou atrasadas;
- menu **"Swarmit"**: liga a camada de orquestração e deixa você agir como o
  backend — mandar *flash* (OTA), *start*, *stop*, *reset* em cada robô e
  acompanhar o estado do dispositivo (`Bootloader` → `Programming` → `Running`).

### 2. Testes

```bash
npm test        # roda a suíte (Vitest)
npm run typecheck
```

### 3. Demonstração headless (sem interface)

```bash
npm run demo
```

Carrega um cenário de exemplo, roda alguns segundos e imprime as poses no
console. Bom para entender o núcleo sem abrir o navegador.

### 4. Rodar como gateway MQTT (conectar um backend de verdade)

Suba um broker MQTT (Mosquitto) via Docker — expõe `1883` (TCP, para o
backend) e `9001` (WebSocket, para clientes de navegador):

```bash
docker compose up -d
```

Rode o gateway simulado, que conecta no broker, publica a telemetria da frota
e obedece aos comandos que chegam:

```bash
npm run gateway                       # usa scenarios/exemplo.json
npm run gateway -- scenarios/enxame.json
MQTT_URL=mqtt://localhost:1883 npm run gateway
SWARMIT=1 npm run gateway             # também liga a orquestração swarmit
```

A partir daí, qualquer backend que fale o protocolo (ver abaixo) enxerga a
frota simulada.

---

## O cenário (`.json`)

Um cenário descreve a arena, as barreiras e os robôs. Exemplos ficam em
`scenarios/` (`exemplo.json`, `enxame.json`). Formato resumido:

```jsonc
{
  "version": 1,
  "network": { "id": "1200", "gateway_addr": "0000000000000001" },
  "arena":   { "width_mm": 4000, "height_mm": 4000, "grid_mm": 100 },
  "obstacles": [
    { "id": "parede-1", "x_mm": 1000, "y_mm": 500, "w_mm": 200, "h_mm": 1500 }
  ],
  "robots": [
    {
      "address": "BDF2B04BC00D2725",   // 16 dígitos hex (identidade do rádio)
      "application": 0,                  // 0=DotBot
      "mode": 1,                         // 0=Manual, 1=Automático
      "start": { "x_mm": 300, "y_mm": 300, "theta_deg": 0 },
      "battery": 100,
      "waypoints": [ { "x_mm": 1500, "y_mm": 300 }, { "x_mm": 1500, "y_mm": 1700 } ],
      "waypoint_threshold_mm": 50,
      "loop": true
    }
  ],
  "sim": {
    "tick_hz": 50, "advertise_hz": 2, "battery_drain_per_min": 1.0,
    "pdr_percent": 100, "slot_latency_ms": 0
  }
}
```

Tudo em milímetros; ângulos em graus (o núcleo converte para radianos). Os
campos `waypoints`, `waypoint_threshold_mm` e `loop` são opcionais.

---

## O que o simulador reproduz (fidelidade)

**No canal de comunicação (o que o backend vê):** o simulador fala o contrato
de gateway do DotBot na fronteira MQTT — os mesmos tópicos, o mesmo
enquadramento de bytes e os mesmos payloads do hardware real:

- **tópicos** `/mari/{NETID}/to_edge` (comandos descendo) e
  `/mari/{NETID}/to_cloud` (eventos/telemetria subindo), com `NETID` = id da
  rede em 4 dígitos hex;
- **enquadramento** `base64( [1 byte de EdgeEvent] + frame Mari )`, com o frame
  Mari v3 (header de 21 bytes, little-endian) e o `next_proto` distinguindo o
  app DotBot da camada swarmit;
- **payloads DotBot** de comando (mover, LED RGB, modo, waypoints) e de
  telemetria (advertisement com posição, direção, bateria, encoders, waypoint),
  com layout byte-a-byte validado contra o PyDotBot/marilib reais.

**No comportamento dos robôs:**

- movimento por cinemática de tração diferencial simples;
- **modo manual** (obedece comandos de joystick) e **modo automático** (segue
  uma rota de waypoints, com opção de repetir em loop);
- **colisão**: com barreiras, com as bordas da arena e **entre robôs** (não se
  atravessam);
- **bateria** que decai; robô sem bateria (ou "derrubado") sai da rede e o
  gateway avisa — que é o gatilho para o backend marcá-lo como inativo/perdido;
- **ciclo de vida da rede**: o gateway anuncia-se, avisa quando um robô entra
  ou sai, e reemite "keep-alive" para um backend que conecta depois descobrir a
  frota.

**Realismo de rede (opcional):** perda de pacote (PDR) e latência lógicas,
ajustáveis, para testar como o backend se comporta com mensagens perdidas ou
atrasadas.

**Orquestração swarmit (opcional):** o simulador implementa o *lado
dispositivo* — a máquina de estados (`Bootloader`/`Programming`/`Running`), o
ACK por chunk do flash OTA e o heartbeat de status. Quem *orquestra*
(decide flashar/iniciar/parar) é sempre o backend; o simulador só **reage**.

O que fica **de fora** de propósito: física mecânica realista, o rádio TSCH de
verdade e a localização Lighthouse física.

---

## Conectando o seu backend

Para o seu backend conversar com o simulador, ele precisa se comportar como o
*control plane* na fronteira MQTT: assinar `/mari/{NETID}/to_cloud`, publicar
em `/mari/{NETID}/to_edge`, e (de)codificar o `base64([EdgeEvent]+frame Mari)`
com os payloads DotBot (e swarmit, se for usar orquestração). Os formatos
exatos — tópicos, enquadramento, tamanhos e endianness — estão documentados no
[`PLANO.md`](./PLANO.md), e o próprio código do simulador (`src/protocol/`) é a
referência executável.

---

## Estrutura do projeto

```
RobotSwarmSimulator/
  scenarios/            # cenários de exemplo (.json)
  docker-compose.yml    # broker MQTT (Mosquitto) para dev
  src/
    core/               # simulação pura, sem UI: mundo, robô, movimento,
                        # colisão, waypoints, (de)serialização de cenário
    protocol/           # codec byte-a-byte: payloads DotBot, frame Mari,
                        # enquadramento de gateway, swarmit
    net/                # gateway simulado, modelo de rede (PDR/latência),
                        # respondedor swarmit
    link/               # transporte: interface + implementação MQTT
    ui/                 # interface React (mapa 2D, editor, painéis)
    gateway-run.ts      # entrada headless (npm run gateway)
    demo.ts             # demonstração headless (npm run demo)
```

Detalhes de arquitetura, decisões e o formato exato do protocolo estão no
[`PLANO.md`](./PLANO.md).

---

## Créditos

Projeto de TCC inspirado na organização [DotBots](https://github.com/DotBots)
(Inria, Paris) — em especial PyDotBot (control plane), mari/marilib (rede) e
swarmit (orquestração). Nenhum código desses projetos é usado; só a
arquitetura e os formatos de protocolo como especificação a seguir.
