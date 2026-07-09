# RobotSwarmSimulator

Simulador para testes de robot swarm — impersona **gateway + frota de robôs**
do ecossistema [DotBots](https://github.com/DotBots) para o backend
[TCC_Swarm_Robots](https://github.com/Lucas-O-S/TCC_Swarm_Robots) (NestJS),
sem hardware. Arquitetura e roadmap completos em [`PLANO.md`](./PLANO.md).

## Estado atual: Fase 1 — núcleo headless

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

O scaffold Vite + React existe só como casa para as próximas fases
(`npm run dev` mostra um placeholder). `src/net/`, `src/protocol/`,
`src/link/` e `src/ui/` são placeholders vazios.

## Como usar

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
- cenário: load/serialize round-trip batendo com o schema do PLANO.

## Próximas fases

Ver roadmap na seção 8 do [`PLANO.md`](./PLANO.md): mapa 2D read-only (2),
editor de cenário (3), `protocol/` + codec binário (4), `MqttLink` +
Mosquitto (5), envelhecimento de estado (6), PDR/latência e swarmit (7).
