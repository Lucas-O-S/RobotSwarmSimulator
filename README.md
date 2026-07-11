# RobotSwarmSimulator

Simulador para testes de robot swarm — impersona **gateway + frota de robôs**
do ecossistema [DotBots](https://github.com/DotBots) para o backend
[TCC_Swarm_Robots](https://github.com/Lucas-O-S/TCC_Swarm_Robots) (NestJS),
sem hardware. Arquitetura e roadmap completos em [`PLANO.md`](./PLANO.md).

## Estado atual: Fase 4 — protocolo + codec binário

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

`src/net/` e `src/link/` seguem como placeholders vazios (Fase 5+);
`src/protocol/` foi preenchido na Fase 4.

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

Ver roadmap na seção 8 do [`PLANO.md`](./PLANO.md): `MqttLink` + Mosquitto
(5), envelhecimento de estado (6), PDR/latência e swarmit (7).
