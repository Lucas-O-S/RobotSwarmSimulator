import { Robot, ROBOT_RADIUS_MM } from './Robot';
import { applyWaypointController } from './waypoints';
import { resolveMovement, separateRobots } from './physics';
import {
  ArenaConfig,
  ControlModeType,
  NetworkConfig,
  Obstacle,
  SimConfig,
} from './types';

export interface WorldInit {
  arena: ArenaConfig;
  network: NetworkConfig;
  sim: SimConfig;
  obstacles?: Obstacle[];
  robots?: Robot[];
}

/** Mundo da simulação: arena + obstáculos + robôs + relógio de ticks. */
export class World {
  arena: ArenaConfig;
  network: NetworkConfig;
  sim: SimConfig;
  obstacles: Obstacle[];
  robots: Robot[];

  /** Tempo simulado acumulado, em segundos. */
  time = 0;

  constructor(init: WorldInit) {
    this.arena = { ...init.arena };
    this.network = { ...init.network };
    this.sim = { ...init.sim };
    this.obstacles = (init.obstacles ?? []).map((o) => ({ ...o }));
    this.robots = init.robots ?? [];
  }

  /** Duração de um tick fixo, em segundos (1 / tick_hz). */
  get tickDt(): number {
    return 1 / this.sim.tick_hz;
  }

  addRobot(robot: Robot): void {
    this.robots.push(robot);
  }

  addObstacle(obstacle: Obstacle): void {
    this.obstacles.push({ ...obstacle });
  }

  getRobot(address: string): Robot | undefined {
    return this.robots.find((r) => r.address === address);
  }

  /** Um passo de simulação:
   *  1. controlador AUTO (quando aplicável) define os PWMs;
   *  2. cada robô integra o movimento;
   *  3. colisão AABB bloqueia o movimento do tick (obstáculos + bordas);
   *  4. colisão robô × robô: separa os que se sobrepõem (não se atravessam);
   *  5. bateria decai (dentro do step do robô). */
  tick(dt: number = this.tickDt): void {
    for (const robot of this.robots) {
      if (robot.mode === ControlModeType.Auto) {
        applyWaypointController(robot);
      }

      const prev = { x: robot.pos_x, y: robot.pos_y };
      robot.step(dt, this.sim.battery_drain_per_min);

      const resolved = resolveMovement(
        prev,
        { x: robot.pos_x, y: robot.pos_y },
        ROBOT_RADIUS_MM,
        this.obstacles,
        this.arena,
      );
      robot.pos_x = resolved.x;
      robot.pos_y = resolved.y;
    }

    // Colisão robô × robô: todos os robôs são corpos físicos (inclusive os
    // offline — sem energia/rádio, mas ainda ocupam espaço no chão). Separa
    // sobreposições respeitando arena e obstáculos.
    const bodies = this.robots.map((r) => ({ x: r.pos_x, y: r.pos_y }));
    separateRobots(bodies, ROBOT_RADIUS_MM, this.obstacles, this.arena);
    this.robots.forEach((r, i) => {
      r.pos_x = bodies[i].x;
      r.pos_y = bodies[i].y;
    });

    this.time += dt;
  }

  /** Avança `realtimeSeconds` de tempo simulado em ticks fixos de
   *  1/tick_hz. Retorna quantos ticks foram executados. */
  step(realtimeSeconds: number): number {
    const n = Math.max(0, Math.round(realtimeSeconds * this.sim.tick_hz));
    for (let i = 0; i < n; i++) this.tick();
    return n;
  }
}
