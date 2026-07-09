# RobotSwarmSimulator

Simulador para testes de robot swarm — impersona **gateway + frota de robôs**
do ecossistema [DotBots](https://github.com/DotBots) para o backend
[TCC_Swarm_Robots](https://github.com/Lucas-O-S/TCC_Swarm_Robots) (NestJS),
sem hardware. Arquitetura e roadmap completos em [`PLANO.md`](./PLANO.md).

## Estado atual: Fase 2 — mapa 2D read-only

UI React minimalista (`src/ui/`) que carrega um cenário JSON, roda o `World`
em tempo real e desenha a vista de topo. **Somente visualização** — edição de
cenário é a Fase 3; MQTT/protocolo, Fases 4–5.

```bash
npm install
npm run dev     # abre a UI em http://localhost:5173
```

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

Como o `exemplo.json` declara os robôs em MANUAL parados, ao carregar o
cenário a UI injeta (via API do core) a mesma rota AUTO do demo headless no
1º robô — ele contorna a barreira e para no último waypoint. O 2º robô fica
parado até você clicar em "Move-raw teste" (ele anda reto e fica bloqueado
pela barreira, sem atravessar).

Peças da fase (nenhuma mudança no núcleo):

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

`src/net/`, `src/protocol/` e `src/link/` seguem como placeholders vazios
(Fases 4–5).

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
- loop da UI (`simLoop`): acumulador de passo fixo sem drift, clamp de dt e
  teto de ticks por frame.

## Próximas fases

Ver roadmap na seção 8 do [`PLANO.md`](./PLANO.md): editor de cenário (3),
`protocol/` + codec binário (4), `MqttLink` + Mosquitto (5), envelhecimento
de estado (6), PDR/latência e swarmit (7).
