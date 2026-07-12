// Fase 5 — SimGateway: o runtime do gateway simulado (World ⇄ FleetLink).
//
// Implementa o CONTRATO da seção 4.4 do PLANO (ciclo de vida do wire):
//   - ao iniciar: GATEWAY_INFO + um NODE_JOINED por robô (1×);
//   - loop: NODE_KEEP_ALIVE por robô (~1 s) + GATEWAY_INFO periódico
//     (pra backend que conecta tarde redescobrir a frota — nota da
//     seção 4.1: NODE_JOINED não é retido no MQTT) e
//     NODE_DATA+DOTBOT_ADVERTISEMENT por robô a cada 1/advertise_hz
//     (~500 ms com o advertise_hz=2 do cenário);
//   - rx: comandos descendo são roteados por destination (address 16 hex
//     ou broadcast FFFF…F) e aplicados no robô certo.
//
// O tempo avança em TICKS FIXOS de 1/tick_hz, desacoplado de fps/rAF:
//   - step(realtimeSeconds) avança N ticks e emite o que venceu — é a
//     API determinística usada nos testes;
//   - start() com autoTick (default) instala um setInterval que chama
//     step() com o tempo real decorrido (headless, sem rAF).

import { Robot } from '../core/Robot';
import { World } from '../core/World';
import { ControlModeType } from '../core/types';
import { RAD_TO_DEG } from '../core/scenario';
import { DotBotAdvertisementPayload, PayloadType } from '../protocol';
import { BROADCAST_DEST, FleetCommand, FleetLink } from '../link/FleetLink';

// ---------------------------------------------------------------------------
// Conversão core → campos do DOTBOT_ADVERTISEMENT (puro, testável)
// ---------------------------------------------------------------------------

/** theta (rad, núcleo) → direction (graus inteiros em [0, 360)). */
export function directionFromTheta(thetaRad: number): number {
  const deg = Math.round(thetaRad * RAD_TO_DEG);
  return ((deg % 360) + 360) % 360;
}

/** Bateria % → mV (u16). Rampa linear 0% = 3000 mV … 100% = 4200 mV
 *  (faixa útil de uma célula LiPo — o controller divide por 1000 pra
 *  exibir volts, então o número precisa PARECER uma tensão real). */
export function batteryToMillivolts(percent: number): number {
  const p = Math.min(100, Math.max(0, percent));
  return Math.round(3000 + (p / 100) * 1200);
}

function clampU32(v: number): number {
  return Math.min(0xffffffff, Math.max(0, Math.round(v)));
}

function clampI32(v: number): number {
  return Math.min(0x7fffffff, Math.max(-0x80000000, Math.round(v)));
}

/** Snapshot do robô → payload DOTBOT_ADVERTISEMENT (unidades do wire). */
export function robotToAdvertisement(robot: Robot): DotBotAdvertisementPayload {
  // waypoint corrente: o alvo sendo perseguido; concluída a rota, fica o
  // último (o firmware também não "esquece" o alvo ao chegar).
  const target =
    robot.waypoints.length > 0
      ? robot.waypoints[Math.min(robot.waypoint_idx, robot.waypoints.length - 1)]
      : undefined;
  return {
    type: PayloadType.DOTBOT_ADVERTISEMENT,
    // posição vem "do LH2" no mundo real; o simulador se declara calibrado
    // no LH2 (bit 0x02) pra o controller confiar em pos_x/pos_y.
    calibrated: 0x02,
    direction: directionFromTheta(robot.theta),
    pos_x: clampU32(robot.pos_x),
    pos_y: clampU32(robot.pos_y),
    battery: batteryToMillivolts(robot.battery),
    pwm_left: robot.pwm_left,
    pwm_right: robot.pwm_right,
    mode: robot.mode,
    encoder_left: clampI32(robot.encoder_left),
    encoder_right: clampI32(robot.encoder_right),
    waypoint_x: target ? clampU32(target.x) : 0,
    waypoint_y: target ? clampU32(target.y) : 0,
    waypoint_idx: Math.min(0xff, robot.waypoint_idx),
  };
}

// ---------------------------------------------------------------------------
// Roteamento de comando (puro, testável)
// ---------------------------------------------------------------------------

/** Resolve os robôs-alvo de um destination (address exato ou broadcast). */
export function resolveTargets(world: World, destination: string): Robot[] {
  if (destination.toUpperCase() === BROADCAST_DEST) return [...world.robots];
  const robot = world.getRobot(destination.toUpperCase());
  return robot ? [robot] : [];
}

/** Aplica um comando neutro num robô (o "rx" da seção 4.4). */
export function applyCommand(robot: Robot, cmd: FleetCommand): void {
  switch (cmd.kind) {
    case 'move-raw':
      robot.applyMoveRaw(cmd.left_x, cmd.left_y, cmd.right_x, cmd.right_y);
      break;
    case 'rgb':
      robot.setRgb(cmd.red, cmd.green, cmd.blue);
      break;
    case 'control-mode':
      robot.setMode(cmd.mode as ControlModeType);
      break;
    case 'waypoints':
      robot.setWaypoints(cmd.waypoints, cmd.threshold);
      break;
  }
}

// ---------------------------------------------------------------------------
// O gateway simulado
// ---------------------------------------------------------------------------

export interface SimGatewayOptions {
  world: World;
  link: FleetLink;
  /** Intervalo do NODE_KEEP_ALIVE (+ GATEWAY_INFO periódico), s. Default 1. */
  keepAliveIntervalS?: number;
  /** Se true (default), start() instala um setInterval que dirige step()
   *  com o tempo real. Passe false nos testes e chame step() na mão. */
  autoTick?: boolean;
  /** Período do driver real-time do autoTick, ms. Default 50. */
  driverIntervalMs?: number;
  log?: (msg: string) => void;
}

const EPS = 1e-9;

export class SimGateway {
  private readonly world: World;
  private readonly link: FleetLink;
  private readonly keepAliveIntervalS: number;
  private readonly autoTick: boolean;
  private readonly driverIntervalMs: number;
  private readonly log: (msg: string) => void;

  private nextKeepAliveAt = 0;
  private nextAdvertiseAt = 0;
  private driver?: ReturnType<typeof setInterval>;
  private lastDriverMs = 0;
  private started = false;

  constructor(opts: SimGatewayOptions) {
    this.world = opts.world;
    this.link = opts.link;
    this.keepAliveIntervalS = opts.keepAliveIntervalS ?? 1;
    this.autoTick = opts.autoTick ?? true;
    this.driverIntervalMs = opts.driverIntervalMs ?? 50;
    this.log = opts.log ?? (() => {});
  }

  /** Intervalo do advertisement, em s (1/advertise_hz do cenário). */
  get advertiseIntervalS(): number {
    const hz = this.world.sim.advertise_hz;
    return hz > 0 ? 1 / hz : 0.5;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.link.onCommand((cmd) => this.handleCommand(cmd));
    await this.link.start();
    this.started = true;

    // ciclo de vida inicial (seção 4.4): gateway se descreve e "junta" a frota
    this.publishGatewayInfo();
    for (const robot of this.world.robots) {
      this.link.publishUplink({ kind: 'node-joined', address: robot.address });
      this.log(`[gw] ⇧ NODE_JOINED ${robot.address}`);
    }

    this.nextKeepAliveAt = this.world.time + this.keepAliveIntervalS;
    this.nextAdvertiseAt = this.world.time + this.advertiseIntervalS;

    if (this.autoTick) {
      this.lastDriverMs = Date.now();
      this.driver = setInterval(() => {
        const now = Date.now();
        // clamp igual ao simLoop: processo suspenso não tenta "recuperar"
        const dt = Math.min((now - this.lastDriverMs) / 1000, 0.25);
        this.lastDriverMs = now;
        this.step(dt);
      }, this.driverIntervalMs);
    }
    this.log('[gw] gateway simulado iniciado');
  }

  async stop(): Promise<void> {
    if (this.driver !== undefined) clearInterval(this.driver);
    this.driver = undefined;
    this.started = false;
    await this.link.stop();
    this.log('[gw] gateway simulado parado');
  }

  /** Avança `realtimeSeconds` em ticks fixos de 1/tick_hz, emitindo os
   *  uplinks periódicos que venceram. Retorna os ticks executados. */
  step(realtimeSeconds: number): number {
    const n = Math.max(0, Math.round(realtimeSeconds * this.world.sim.tick_hz));
    for (let i = 0; i < n; i++) {
      this.world.tick();
      this.emitDue();
    }
    return n;
  }

  private emitDue(): void {
    const t = this.world.time + EPS;
    while (t >= this.nextAdvertiseAt) {
      for (const robot of this.world.robots) {
        this.link.publishUplink({
          kind: 'node-data',
          source: robot.address,
          payload: robotToAdvertisement(robot),
        });
      }
      this.nextAdvertiseAt += this.advertiseIntervalS;
    }
    while (t >= this.nextKeepAliveAt) {
      for (const robot of this.world.robots) {
        this.link.publishUplink({ kind: 'node-keep-alive', address: robot.address });
      }
      // GATEWAY_INFO periódico junto do keep-alive: deixa um cloud que
      // conectou tarde redescobrir gateway + frota (nada é retido no MQTT).
      this.publishGatewayInfo();
      this.nextKeepAliveAt += this.keepAliveIntervalS;
    }
  }

  private publishGatewayInfo(): void {
    this.link.publishUplink({
      kind: 'gateway-info',
      // asn = nº do slot TSCH — sem rádio real, derivamos do relógio
      // simulado assumindo slots de 10 ms (só precisa ser monotônico).
      asn: BigInt(Math.round(this.world.time * 100)),
      timer: Math.min(0xffffffff, Math.round(this.world.time * 1000)),
    });
  }

  private handleCommand(cmd: FleetCommand): void {
    const targets = resolveTargets(this.world, cmd.destination);
    if (targets.length === 0) {
      this.log(`[gw] comando ${cmd.kind} pra destination desconhecido ${cmd.destination}`);
      return;
    }
    for (const robot of targets) {
      applyCommand(robot, cmd);
      this.log(`[gw] ⇩ ${cmd.kind} aplicado em ${robot.address}`);
    }
  }
}
