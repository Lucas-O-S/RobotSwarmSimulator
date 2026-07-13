# RobotSwarmSimulator

Simulador para testes de robot swarm — impersona **gateway + frota de robôs**
do ecossistema [DotBots](https://github.com/DotBots) para o backend
[TCC_Swarm_Robots](https://github.com/Lucas-O-S/TCC_Swarm_Robots) (NestJS),
sem hardware. Arquitetura e roadmap completos em [`PLANO.md`](./PLANO.md).

## Estado atual: Fase 7 — fidelidade de rede (Peça 1: PDR + latência)

Implementa a seção 4.6 do PLANO: **perda de pacote (PDR 0–100%)** e
**latência de entrega** (abstração lógica da latência de slot TSCH,
~63–150 ms no Mari real) — ligáveis/desligáveis e ajustáveis **ao vivo**,
pra testar a robustez do backend a mensagens perdidas/atrasadas.
**Sem rádio simulado**: modela-se só o efeito observável por mensagem.

### O modelo (`src/net/netmodel.ts` — puro e determinístico)

- Por mensagem, `decideFate(params, rng)` decide: **DROP** (probabilidade
  `1 − pdr/100`) ou **DELIVER** após `slot_latency_ms` + jitter uniforme
  opcional em `[0, jitter_ms]`. RNG **mulberry32 com seed injetável** —
  mesma seed + mesma sequência de mensagens ⇒ mesmos drops/atrasos.
- `NetChannel` agenda as entregas atrasadas em **tempo simulado** (nunca
  wall-clock): `send(msg, nowS, params)` decide na hora com os params
  vivos; `advanceTo(nowS)` entrega o que venceu, em ordem de tempo de
  entrega (desempate FIFO). Chamado a cada tick do `step()` do gateway —
  coerente com o loop determinístico dele.
- Config no `sim` do cenário: `pdr_percent` e `slot_latency_ms` (existiam
  reservados desde a Fase 1 — agora **ativos**) + os **opcionais**
  `net_enabled` (kill-switch; ausente = true) e `jitter_ms` (default 0).
  Cenários antigos continuam válidos.

### Onde a degradação é aplicada (uplink E downlink)

No `SimGateway` (`src/net/gateway.ts`), na fronteira com o `FleetLink` —
como no rádio real, os dois sentidos perdem/atrasam:

- **uplink**: todo `publishUplink` (advertise, keep-alive, NODE_JOINED/
  LEFT, GATEWAY_INFO) atravessa um `NetChannel` antes de chegar no link;
- **downlink**: todo comando recebido do link atravessa outro `NetChannel`
  antes do roteamento/aplicação no robô (os alvos são resolvidos **no
  momento da entrega** — robô que caiu durante o atraso não recebe).

**Regressão garantida:** com PDR=100% e latência 0 (o default do
`exemplo.json`) — ou com `net_enabled: false` — o caminho é **passthrough
síncrono, sem consumir RNG**: comportamento idêntico ao das Fases 1–6
(os 164 testes anteriores e a integração MQTT rodam intactos).
`SimGateway` aceita `netSeed` (default fixo) e expõe `netStats`
(sent/delivered/dropped/pending por sentido).

### Menu "Configurações de rede" (modo Simular)

Botão **"Configurações de rede"** na barra do modo Simular abre um painel
(`src/ui/NetConfigPanel.tsx`) com: checkbox liga/desliga, sliders de
**PDR (%)**, **latência (ms)** e **jitter (ms)**. As mudanças editam o
`world.sim` **ao vivo** (via `setNetConfig` do `useWorld`) — o
`SimGateway` lê os params por mensagem, então o efeito é imediato em
qualquer gateway pendurado no World. Valores iniciais vêm do `sim` do
cenário; **Reset** volta pra eles. O botão mostra um resumo quando a
degradação está ativa; `npm run gateway` loga a config de rede do cenário.

### Testes novos (Vitest, determinísticos com seed)

- `src/net/__tests__/netmodel.test.ts` — RNG reprodutível; PDR=0 → tudo
  cai / PDR=100 → nada cai; fração de drops com seed fixa dentro do
  esperado; atraso base + faixa do jitter (63+87 → [63, 150) ms); entrega
  só após o atraso em tempo simulado, em ordem (desempate FIFO); params
  mudando ao vivo; kill-switch.
- `src/net/__tests__/gateway-net.test.ts` — degradação aplicada no
  gateway: PDR=0 silencia uplink E descarta downlink; PDR=50 com seed →
  fração esperada e contagem reprodutível; latência segura o ciclo
  inicial/advertise/comando até vencer no `step()`; ordem por tempo
  simulado; **regressão** PDR=100/lat=0 ≡ `net_enabled=false` (mesma
  sequência de uplinks, downlink síncrono, mesmas poses finais).

## Fase 6 — comportamento de frota + ciclo de vida

Construída em cima da Fase 5 (gateway MQTT), sem quebrar nada.

### Ciclo de vida / liveness (o gatilho do envelhecimento no backend)

Um robô fica **OFFLINE** por (a) bateria chegar a 0 (decaimento já existente)
ou (b) **injeção de falha** manual. API do núcleo (`src/core/Robot.ts`):

- `robot.online: boolean` — true quando bateria > 0 E sem falha injetada;
- `robot.setOnline(bool)` — derruba/religa (religar **não** ressuscita
  bateria zerada: sem energia não há rádio);
- `robot.status` — espelho local coerente no snapshot (`Active` na rede,
  `Inactive` fora); o snapshot também expõe `online`.

No `SimGateway` (`src/net/gateway.ts`), a cada tick as transições
online⇄offline são detectadas e:

- ao cair: o gateway **para** de emitir advertise/keep-alive do robô e
  emite **`NODE_LEFT` exatamente uma vez**;
- ao voltar: re-emite **`NODE_JOINED`** e retoma advertise/keep-alive;
- robô offline **não recebe downlink** (nem broadcast) — fora da rede Mari
  não há rádio (`resolveTargets` filtra por `online`).

**Fronteira com o backend (seção 4.5 do PLANO):** os timers de
envelhecimento `ACTIVE → INACTIVE (5 s) → LOST (60 s)` vivem no
controller/backend. O simulador só modela o **gatilho** de rede (NODE_LEFT
+ silêncio de telemetria) que dispara esses timers — eles não existem aqui.

### Múltiplos robôs + cenário de enxame

- Novo cenário [`scenarios/enxame.json`](./scenarios/enxame.json): **6
  robôs** (2 AUTO em loop, 2 AUTO sem loop, 2 MANUAL) + 3 barreiras em
  arena 4000×4000 mm. Disponível no seletor de cenários da UI e no gateway
  headless (`npm run gateway -- scenarios/enxame.json`).
- `SimGateway` ganhou **`staggerAdvertise`** (opcional; ligado no
  `npm run gateway`): o robô i ganha offset de fase `i/N` do intervalo de
  advertise, então N robôs não publicam N mensagens no mesmo tick — a taxa
  por robô continua `advertise_hz`.

### Modo AUTO — rota em LOOP

- Campo **opcional** `robots[*].loop` no cenário (retrocompatível: default
  false = para no fim, como nas fases 1–5; só é emitido no JSON salvo
  quando true). Também editável na UI (checkbox "rota em loop" no painel
  do robô, modo Editar).
- Com `loop: true`, ao alcançar o último waypoint o `waypoint_idx` volta a
  0 e a rota recomeça (cicla — visível no `DOTBOT_ADVERTISEMENT`).
- Chegada **estável**: o controlador consome no mesmo tick os waypoints já
  dentro do threshold (retarget imediato, sem 1 tick de deriva com o PWM
  antigo) e, concluída a rota sem loop, zera os PWMs e a pose não muda mais
  (sem jitter). Loop degenerado (todos os waypoints dentro do raio) para de
  forma estável em vez de iterar infinito.

### UI (mínima, funcional)

- **Inspector**: cada robô mostra `ONLINE`/`OFFLINE`, modo
  (`AUTO`/`AUTO (loop)`/`MANUAL`), bateria, `wp_idx`, e um botão
  **"Derrubar (falha)" / "Religar"** pra injetar falha durante a simulação
  (desabilitado quando a bateria zerou — religar não ressuscita).
- **Mapa**: robô offline aparece **apagado/cinza** (translúcido, rótulo
  "(off)"); rota em loop desenha o circuito fechado.

### Testes novos (Vitest)

- `src/core/__tests__/lifecycle.test.ts` — bateria→0 derruba, setOnline
  alterna, religar sem bateria não ressuscita, snapshot coerente;
- `src/core/__tests__/waypoints-loop.test.ts` — `waypoint_idx` cicla em
  loop, para no fim sem loop, chegada sem jitter, loop degenerado estável;
- `src/core/__tests__/scenario-loop.test.ts` — campo `loop`
  (retrocompatibilidade + round-trip) e validação do `enxame.json` (6
  robôs, 10 s de simulação sem sair da arena);
- `src/net/__tests__/gateway-lifecycle.test.ts` — NODE_LEFT exatamente 1×
  (bateria e falha), advertise pausa/retoma com NODE_JOINED re-emitido,
  robô offline não recebe comando (nem broadcast), N=6 robôs todos
  advertisam e roteamento por address atinge só o alvo, stagger espalha os
  advertises mantendo a taxa.

## Fase 5 (simulador) — gateway simulado na fronteira MQTT

O simulador agora se comporta como **gateway + frota reais** nos tópicos
MQTT do marilib — um backend cloud conectado ao broker não distingue de
hardware. Lado do backend (adaptador MQTT no NestJS) é a Parte B, em outro
repo.

- **`src/link/FleetLink.ts`** — interface de transporte (espelha o
  `dotbot/adapter.py`): `start()/stop()`, `onCommand(cb)` com comandos já
  decodificados num tipo neutro (`move-raw`, `rgb`, `control-mode`,
  `waypoints`) e `publishUplink(...)` com uplinks neutros (`gateway-info`,
  `node-joined/left/keep-alive`, `node-data`+payload DotBot). Permite
  implementação fake nos testes.
- **`src/link/MqttLink.ts`** — implementação MQTT (lib `mqtt`, funciona em
  node por TCP e no browser por WebSocket): assina `/mari/{NETID}/to_edge`,
  decodifica `base64 → [EdgeEvent] + frame Mari` e entrega comandos
  `DOTBOT_APP` via `onCommand`; publica os uplinks enquadrados em
  `/mari/{NETID}/to_cloud`. O enquadramento é puro e exportado
  (`encodeUplink`/`decodeDownlink`) — testável sem broker.
- **`src/net/gateway.ts`** — `SimGateway`, o runtime que amarra
  `World` + `FleetLink` (contrato da seção 4.4 do PLANO): ao iniciar
  publica `GATEWAY_INFO` + um `NODE_JOINED` por robô; loop periódico com
  `NODE_KEEP_ALIVE` por robô (~1 s, com `GATEWAY_INFO` reemitido pra
  descoberta tardia) e `NODE_DATA`+`DOTBOT_ADVERTISEMENT` por robô a cada
  `1/advertise_hz` (~500 ms) com a pose/estado atuais; comandos descendo
  são roteados por `destination` (address exato ou broadcast
  `FFFF…F`) → `applyMoveRaw`/`setWaypoints`/`setMode`/`setRgb`. O tempo
  avança em ticks fixos de `1/tick_hz`, headless (sem rAF): `step(s)`
  determinístico pros testes + driver `setInterval` opcional (`autoTick`).

### Subir o broker (Mosquitto via docker compose)

```bash
docker compose up -d    # broker MQTT local
```

Expõe **1883** (MQTT/TCP — gateway headless e backend) e **9001**
(MQTT/WebSocket — pro simulador rodando no browser). Config em
[`mosquitto/mosquitto.conf`](./mosquitto/mosquitto.conf)
(`allow_anonymous true`, só pra dev).

### Rodar o gateway simulado (headless)

```bash
npm run gateway                        # scenarios/exemplo.json, mqtt://localhost:1883
npm run gateway -- meu-cenario.json    # outro cenário
MQTT_URL=mqtt://outro-host:1883 npm run gateway
MQTT_PROTOCOL_VERSION=4 npm run gateway   # p/ brokers sem MQTT 5 (default 5)
```

O processo conecta no broker, loga conexão/eventos e passa a viver o ciclo
de vida do gateway real: `NETID` sai do `network.id` do cenário (4 hex
maiúsculos → tópicos `/mari/1200/to_edge|to_cloud` no exemplo). Pra ver o
tráfego: `docker exec rss-mosquitto mosquitto_sub -t '/mari/#' -v`.

### Conversões core → wire (decisões)

- `direction` = `theta` do núcleo em graus inteiros `[0, 360)`;
- `pos_x/pos_y/encoders` = mm arredondados (u32/i32);
- `battery` % → mV numa rampa 3000–4200 mV (parece uma LiPo real; o
  controller do PyDotBot divide por 1000 pra exibir volts);
- `calibrated = 0x02` (LH2) — a posição "vem do Lighthouse" no mundo real;
- `waypoint_x/y/idx` = alvo corrente da rota (ou 0 sem rota);
- `asn`/`timer` do `GATEWAY_INFO` derivados do relógio simulado (slots de
  10 ms — só precisam ser monotônicos).

### O que o teste de integração cobre

`src/link/__tests__/mqtt-integration.test.ts` sobe um **broker MQTT em
processo** (`aedes`, devDependency) numa porta TCP efêmera — CI não precisa
de docker — e conecta o `MqttLink`/`SimGateway` REAIS mais um cliente
`mqtt` fazendo o papel do backend cloud:

- o gateway publica `GATEWAY_INFO`, `NODE_JOINED` (por robô), keep-alives e
  `NODE_DATA`+`DOTBOT_ADVERTISEMENT` em `to_cloud`, tudo **decodificável de
  volta com o codec da Fase 4** e com pose coerente com o `World`;
- um `CMD_MOVE_RAW` publicado em `to_edge` (enquadrado byte a byte como o
  backend fará) move o robô alvo — e só ele — após ticks, e a telemetria
  seguinte reflete a pose nova;
- `LH2_WAYPOINTS` via `to_edge` põe o robô em AUTO com a rota carregada e
  ele passa a se aproximar do 1º waypoint.

Unitários novos: conversão core↔payload e roteamento por address
(`src/net/__tests__/gateway.test.ts`), enquadramento uplink/downlink puro
(`src/link/__tests__/mqttlink-codec.test.ts`).

Obs.: o broker de teste (`aedes`) fala MQTT 3.1.1, então o `MqttLink`
aceita `protocolVersion: 4 | 5` (default **5**, como o marilib usa contra
o Mosquitto).

## Fase 4 — protocolo + codec binário

`src/protocol/` implementa o encode/decode **byte a byte** do contrato de
gateway do ecossistema DotBots — headless, sem React e sem I/O (o MQTT em si
é a Fase 5). Cada layout foi confirmado contra as bibliotecas Python REAIS
que o backend/cloud vai usar (versões pinadas pelo PyDotBot 0.29.1):

- **`dotbot.ts`** — payloads da aplicação DotBot (`CMD_MOVE_RAW` 0x00,
  `CMD_RGB_LED` 0x01, `ADVERTISEMENT` 0x04, `DOTBOT_ADVERTISEMENT` 0x06,
  `CONTROL_MODE` 0x07, `LH2_WAYPOINTS` 0x08, `DOTBOT_SIMULATOR_DATA` 0xFA)
  com `encodeDotBotPayload`/`decodeDotBotPayload`. Formato do
  `pydotbot-utils` 0.3.0: `[1 B payload_type] + campos`. Fonte:
  `dotbot/protocol.py` (PyDotBot) + `dotbot_utils/protocol.py`.
- **`mari.ts`** — frame Mari **v3** (`marilib-pkg` 0.9.0): header de **21 B**
  (`version=3:1, type:1, network_id:2, destination:8, source:8,
  next_proto:1`) + payload. O demux de protocolo superior (`NextProto`:
  `DOTBOT_APP=0x11`, `SWARMIT_TESTBED=0x10`) vive DENTRO do header; o byte
  de `rssi` do v2 **não existe mais** no frame. Enums `EdgeEvent` e
  `NextProto`, helpers de address hex⇄u64.
- **`edge.ts`** — wire do gateway: `[1 B EdgeEvent] + evento`
  (`encodeEdgeMessage`/`decodeEdgeMessage`), payloads de ciclo de vida
  (`NodeInfoCloud` 16 B, `GatewayInfo` 55 B), tópicos
  `/mari/{NETID}/to_edge|to_cloud` e **base64** puro sobre `Uint8Array`
  (browser e node, sem `Buffer`) — o formato exato do payload MQTT.

**Endianness: tudo little-endian** (`byteorder="little"` no
`protocol.py` de ambos os pacotes Python).

Os testes (`src/protocol/__tests__/`) cobrem round-trip de todos os
payloads e **vetores golden**: bytes hex gerados executando o
PyDotBot/marilib reais em Python e comparados 1:1 com a saída do codec TS
(incl. int8 negativos, u64 LE, base64 do Python).

```bash
npm test   # 50 testes das Fases 1–3 + os do protocolo
```

## Fase 3 — editor de cenário

A UI agora tem dois modos, alternados no topo da tela:

- **Simular** — a visualização da Fase 2 (mapa 2D + telemetria), rodando o
  cenário atual em tempo real;
- **Editar** — monta o cenário no mapa (barreiras, robôs, rotas) e
  salva/carrega como arquivo `.json`. No modo Editar a simulação fica
  **pausada**: edita-se o estado INICIAL do cenário, não o simulado.

```bash
npm install
npm run dev     # abre a UI em http://localhost:5173
```

### Como usar o editor

Ferramentas (barra do topo, dentro do modo Editar):

- **Selecionar** — clique num robô/barreira pra selecionar; arraste pra
  mover. A barreira selecionada ganha **alças** nos cantos/bordas pra
  redimensionar; o robô selecionado ganha um **ponto azul** na ponta da seta
  pra girar o heading (snap de 15° com o snap ligado).
- **+ Barreira** — arraste no mapa pra desenhar um retângulo (mínimo
  20×20 mm).
- **+ Robô** — clique no mapa pra posicionar um robô novo (address hex de
  16 chars gerado automaticamente, MANUAL, bateria 100%).
- **+ Waypoint** — com um robô selecionado, cada clique no mapa acrescenta
  um waypoint à rota dele (o robô entra em AUTO, espelhando o efeito do
  payload `LH2_WAYPOINTS`).
- **snap ao grid** — liga/desliga o snap de posições/tamanhos ao
  `arena.grid_mm`.
- **Delete** (tecla ou botão) — apaga o item selecionado.

O painel lateral edita as propriedades do item selecionado: barreira
(`id`, x/y/largura/altura em mm) e robô (`address` com validação de 16
dígitos hex, `application`, `mode` Manual/Auto, `battery`, posição/theta e —
em AUTO — a lista de waypoints com remoção ponto a ponto e o
`waypoint_threshold_mm`).

### Salvar / carregar JSON

- **Salvar JSON** — serializa o cenário atual (via `serializeScenario` do
  core) e baixa um `.json` no schema da seção 7 do PLANO, **incluindo**
  `mode`/`waypoints` por robô.
- **Carregar JSON** — upload de um `.json`; o arquivo é validado pela MESMA
  validação do core (`loadScenario`) e, se ok, abre no editor. Arquivo
  inválido mostra uma mensagem de erro amigável sem derrubar a UI.
- O schema ganhou os campos **opcionais** `robots[*].waypoints`
  (`[{x_mm,y_mm}]`) e `robots[*].waypoint_threshold_mm` (default 50).
  Cenários antigos, sem os campos, continuam carregando (retrocompatível) —
  e cenários sem rota são salvos sem os campos, idênticos ao formato antigo.

Ao alternar **Editar → Simular**, a simulação roda exatamente o cenário
editado — robôs em AUTO já partem seguindo os waypoints persistidos no JSON
(isso eliminou a gambiarra da Fase 2 que injetava a rota na carga; o
`exemplo.json` agora declara o 1º robô em AUTO com a rota completa).

Peças da fase:

- **`src/ui/editorGeometry.ts`** — geometria pura do editor (snap, retângulo
  de arrasto, alças de resize, hit-test, contenção na arena). Testada.
- **`src/ui/editorModel.ts`** — operações puras sobre o cenário (gerar/validar
  address, criar/mover/apagar barreira/robô, waypoints, validação de arquivo
  carregado). Testada.
- **`src/ui/ScenarioEditor.tsx`** — canvas do editor (eventos de mouse +
  desenho, mesmas convenções de eixos do MapView).
- **`src/ui/EditorPanel.tsx`** — painel de propriedades do item selecionado.
- **`src/ui/SimView.tsx`** — o modo Simular (a Fase 2 empacotada como
  componente); **`src/ui/fileio.ts`** — download do `.json`.
- Core: `loadScenario`/`serializeScenario` estendidos de forma
  retrocompatível pra persistir `waypoints`/`waypoint_threshold_mm`.

## Fase 2 — mapa 2D read-only

UI React minimalista (`src/ui/`) que carrega um cenário JSON, roda o `World`
em tempo real e desenha a vista de topo.

O que a tela mostra:

- **Mapa 2D de topo** (Canvas 2D): grid conforme `arena.grid_mm`, borda da
  arena, obstáculos como retângulos cinza, robôs como círculos (no raio real
  de colisão) com uma seta indicando o heading (theta) e o sufixo do address.
  Cor do robô vem do RGB do LED se definido; senão, uma paleta padrão.
  Robôs em AUTO mostram a rota (tracejada) com os waypoints numerados e o
  alvo atual destacado; cada robô deixa uma trilha curta do caminho recente.
  **Convenção de eixos**: origem no canto inferior-esquerdo, Y cresce pra
  cima (o canvas espelha o Y no desenho — ver `MapView.tsx`).
- **Painel lateral** (read-only): address, pos x/y (mm), theta (graus), modo,
  bateria, pwm L/R e `wp_idx`.
- **Controles**: Play/Pause, Reset (recarrega o cenário), seletor de cenário
  e um botão "Move-raw teste" que injeta `CMD_MOVE_RAW(0,80,0,80)` no 1º robô
  em MANUAL (só pra demonstrar movimento — sem UI de joystick ainda).

No `exemplo.json`, o 1º robô está em AUTO com a rota persistida no próprio
JSON (desde a Fase 3) — ele contorna a barreira e para no último waypoint.
O 2º robô fica parado até você clicar em "Move-raw teste" (ele anda reto e
fica bloqueado pela barreira, sem atravessar).

Peças da fase:

- **`src/ui/simLoop.ts`** — lógica pura do loop: dt real do
  `requestAnimationFrame` → ticks fixos de `1/tick_hz` via acumulador, com
  clamp de dt (aba em background) e teto de ticks por frame. Testada.
- **`src/ui/useWorld.ts`** — hook que instancia o `World` via
  `loadScenario`, roda o loop, grava trilhas e expõe snapshots + controles.
- **`src/ui/MapView.tsx`** — desenho do mapa (Canvas 2D), escala mundo(mm)→
  tela(px) com fit ao contêiner mantendo a proporção.
- **`src/ui/Inspector.tsx`** — telemetria por robô.
- **`src/ui/scenarios.ts`** — registro de cenários embutidos no bundle.

## Fase 1 — núcleo headless

Núcleo de simulação puro em TypeScript (`src/core/`), **sem React e sem
transporte/MQTT** (fases futuras). O que existe:

- **`types.ts`** — tipos base (Vec2, RobotState, Obstacle, Scenario) e enums
  idênticos ao backend (`ApplicationType`, `ControlModeType`, `RobotStatus`).
  Unidades em **mm**; ângulos em radianos internamente (o JSON usa graus).
- **`Robot.ts`** — estado do robô + cinemática **simples** de tração
  diferencial (pwm → velocidade de roda → integração de x/y/theta), encoders
  acumulados e decaimento linear de bateria. Comandos: `applyMoveRaw`
  (MANUAL), `setWaypoints` (AUTO), `setRgb`, `setMode`.
- **`waypoints.ts`** — controlador de rota do modo AUTO (gira → avança →
  incrementa `waypoint_idx` dentro do `threshold` → para no fim).
- **`physics.ts`** — colisão robô (círculo) × obstáculo (AABB); movimento
  bloqueado no tick; contenção nas bordas da arena.
- **`World.ts`** — arena + obstáculos + robôs + `tick(dt)` /
  `step(realtimeSeconds)` em ticks fixos de `1/tick_hz`.
- **`scenario.ts`** — `loadScenario(json)` / `serializeScenario(world)`
  seguindo o schema da seção 7 do PLANO (conversão `theta_deg` ⇄ rad).

`src/protocol/` foi preenchido na Fase 4; `src/link/` e `src/net/` na
Fase 5.

## Como usar (headless)

```bash
npm install     # instala dependências
npm test        # roda os testes (Vitest)
npm run demo    # demo headless: carrega scenarios/exemplo.json e imprime poses
npm run typecheck  # tsc --noEmit
```

O demo (`src/demo.ts`) carrega [`scenarios/exemplo.json`](./scenarios/exemplo.json)
(2 robôs + 1 barreira), põe um robô em rota AUTO e outro em MANUAL dirigindo
contra a barreira, roda 10 s simulados e imprime as poses a cada segundo.

## Testes cobertos

- move-raw: robô avança na direção do heading após N ticks;
- AUTO: robô alcança waypoints (`waypoint_idx` avança) e para no fim da rota;
- colisão: robô **não atravessa** obstáculo retangular nem as bordas da arena;
- bateria: decai monotonicamente e satura em 0 (robô para sem bateria);
- cenário: load/serialize round-trip batendo com o schema do PLANO;
- cenário (Fase 3): waypoints/mode persistidos, threshold default,
  retrocompatibilidade com cenários antigos e rejeição de rota malformada;
- editor (Fase 3): snap ao grid, retângulo de arrasto, resize por alça com
  tamanho mínimo, contenção na arena, geração/validação de address e
  validação do arquivo carregado;
- loop da UI (`simLoop`): acumulador de passo fixo sem drift, clamp de dt e
  teto de ticks por frame;
- protocolo (Fase 4): round-trip de todos os payloads DotBot, frame Mari e
  mensagens de edge; vetores golden gerados com o PyDotBot/marilib reais;
  tamanhos/offsets (`DOTBOT_ADVERTISEMENT` = 34 B, header Mari = 21 B);
  endianness (`network_id=0x1200` → `00 12`); int8 com sinal em
  `CMD_MOVE_RAW`; base64 idêntico ao `base64.b64encode` do Python.

## Próximas fases

Ver roadmap na seção 8 do [`PLANO.md`](./PLANO.md): Parte B da Fase 5 é o
**adaptador MQTT no backend NestJS** (repo TCC_Swarm_Robots) — assinar
`/mari/{NETID}/to_cloud`, publicar em `/mari/{NETID}/to_edge` com o mesmo
enquadramento `base64([EdgeEvent]+frame)`. No simulador, falta a Peça 2 da
Fase 7: a camada **swarmit** (state machine + OTA chunk/ack).
