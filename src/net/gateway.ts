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
// Fase 6 — ciclo de vida / liveness da frota:
//   - robô OFFLINE (bateria 0 ou falha injetada via robot.setOnline(false))
//     sai da rede: o gateway PARA de emitir advertise/keep-alive dele e
//     emite NODE_LEFT exatamente uma vez; ao voltar, re-emite NODE_JOINED
//     e retoma o loop. Robô offline também NÃO recebe downlink (nem
//     broadcast) — fora da rede Mari não há rádio.
//   - FRONTEIRA COM O BACKEND (seção 4.5 do PLANO): o NODE_LEFT/silêncio de
//     telemetria daqui é só o GATILHO; os timers ACTIVE→INACTIVE(5 s)→
//     LOST(60 s) são do controller/backend e NÃO são implementados aqui.
//   - advertises podem ser escalonados (staggerAdvertise) pra uma frota de
//     N robôs não publicar N mensagens no mesmo tick.
//
// O tempo avança em TICKS FIXOS de 1/tick_hz, desacoplado de fps/rAF:
//   - step(realtimeSeconds) avança N ticks e emite o que venceu — é a
//     API determinística usada nos testes;
//   - start() com autoTick (default) instala um setInterval que chama
//     step() com o tempo real decorrido (headless, sem rAF).
//
// Fase 7 (Peça 1) — fidelidade de rede (PDR + latência, src/net/netmodel.ts):
//   - TODO uplink (advertise/keep-alive/lifecycle/gateway-info) e TODO
//     downlink (comandos do backend) atravessam um NetChannel que pode
//     DROPAR (prob. 1 − pdr/100) ou ATRASAR (slot_latency_ms + jitter) a
//     mensagem, em TEMPO SIMULADO (as entregas atrasadas vencem dentro do
//     step(), nunca por wall-clock);
//   - os parâmetros são lidos VIVOS de world.sim a cada mensagem — o menu
//     de configurações da UI muda world.sim e o efeito é imediato;
//   - com PDR=100 e latência 0 (default) ou net_enabled=false, o caminho é
//     passthrough SÍNCRONO: comportamento idêntico ao das Fases 1–6.

import { Robot } from '../core/Robot';
import { World } from '../core/World';
import { ControlModeType } from '../core/types';
import { RAD_TO_DEG } from '../core/scenario';
import { DotBotAdvertisementPayload, PayloadType } from '../protocol';
import {
  BROADCAST_DEST,
  FleetCommand,
  FleetLink,
  FleetUplink,
  SwarmitCommand,
} from '../link/FleetLink';
import { NetChannel, NetChannelStats, netParamsFromSim } from './netmodel';
import { SwarmitDevice } from './swarmitDevice';

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

/** Resolve os robôs-alvo de um destination (address exato ou broadcast).
 *  Robô OFFLINE está fora da rede Mari e NÃO recebe downlink — é filtrado
 *  inclusive do broadcast (Fase 6). */
export function resolveTargets(world: World, destination: string): Robot[] {
  if (destination.toUpperCase() === BROADCAST_DEST) {
    return world.robots.filter((r) => r.online);
  }
  const robot = world.getRobot(destination.toUpperCase());
  return robot && robot.online ? [robot] : [];
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
  /** Se true, escalona (stagger) o advertise dos robôs — o robô i ganha um
   *  offset de fase de i/N do intervalo, então uma frota de N robôs não
   *  publica N advertisements no mesmo tick. Default false (todos juntos,
   *  comportamento da Fase 5). A taxa POR ROBÔ continua advertise_hz. */
  staggerAdvertise?: boolean;
  /** Seed do RNG do modelo de rede (Fase 7) — mesma seed + mesma sequência
   *  de mensagens ⇒ mesmos drops/atrasos. Default fixo (determinístico). */
  netSeed?: number;
  /** Fase 7 (Peça 2): habilita o respondedor swarmit (máquina de estados +
   *  heartbeat SWARMIT_STATUS + acks de OTA). Default false — desligado, o
   *  gateway se comporta exatamente como nas fases 5–6. */
  swarmitEnabled?: boolean;
  /** Frequência do heartbeat SWARMIT_STATUS por robô, Hz. Default 1. */
  swarmitStatusHz?: number;
  log?: (msg: string) => void;
}

const EPS = 1e-9;

export class SimGateway {
  private readonly world: World;
  private readonly link: FleetLink;
  private readonly keepAliveIntervalS: number;
  private readonly autoTick: boolean;
  private readonly driverIntervalMs: number;
  private readonly staggerAdvertise: boolean;
  private readonly log: (msg: string) => void;

  private nextKeepAliveAt = 0;
  /** Próximo advertise POR ROBÔ (address → tempo simulado, s). Permite o
   *  stagger e mantém o relógio de cada robô mesmo enquanto ele está
   *  offline (ao religar, o advertise retoma no slot seguinte). */
  private nextAdvertiseAt = new Map<string, number>();
  /** Último estado de liveness visto por robô — a detecção de transição
   *  online⇄offline que dispara NODE_LEFT/NODE_JOINED exatamente 1×. */
  private wasOnline = new Map<string, boolean>();
  private driver?: ReturnType<typeof setInterval>;
  private lastDriverMs = 0;
  private started = false;

  /** Fase 7 (Peça 2) — respondedor swarmit por robô (address → device) e
   *  agenda do heartbeat de status. Vazio/inativo quando swarmit desligado. */
  private readonly swarmitEnabled: boolean;
  private readonly swarmitStatusIntervalS: number;
  private readonly swarmitDevices = new Map<string, SwarmitDevice>();
  private nextSwarmitStatusAt = 0;

  /** Fase 7 — canais de degradação de rede (drop/atraso por mensagem).
   *  Uplink e downlink têm RNGs próprios (seeds derivadas) pra a fração de
   *  drops de um sentido não depender do tráfego do outro. */
  private readonly uplinkNet: NetChannel<FleetUplink>;
  private readonly downlinkNet: NetChannel<FleetCommand>;

  constructor(opts: SimGatewayOptions) {
    this.world = opts.world;
    this.link = opts.link;
    this.keepAliveIntervalS = opts.keepAliveIntervalS ?? 1;
    this.autoTick = opts.autoTick ?? true;
    this.driverIntervalMs = opts.driverIntervalMs ?? 50;
    this.staggerAdvertise = opts.staggerAdvertise ?? false;
    this.swarmitEnabled = opts.swarmitEnabled ?? false;
    this.swarmitStatusIntervalS = 1 / (opts.swarmitStatusHz ?? 1);
    this.log = opts.log ?? (() => {});
    const seed = opts.netSeed ?? 0x5eed_c0de;
    this.uplinkNet = new NetChannel<FleetUplink>(seed, (u) => this.link.publishUplink(u));
    this.downlinkNet = new NetChannel<FleetCommand>(seed ^ 0x9e3779b9, (cmd) =>
      this.applyDownlink(cmd),
    );
  }

  /** Estatísticas do modelo de rede (Fase 7) — útil pra UI/depuração. */
  get netStats(): { uplink: NetChannelStats; downlink: NetChannelStats } {
    return { uplink: this.uplinkNet.stats, downlink: this.downlinkNet.stats };
  }

  /** Envia um uplink ATRAVÉS do modelo de rede (drop/atraso). Com os
   *  defaults (PDR=100, latência 0) é um passthrough síncrono. */
  private sendUplink(uplink: FleetUplink): void {
    this.uplinkNet.send(uplink, this.world.time, netParamsFromSim(this.world.sim));
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

    // ciclo de vida inicial (seção 4.4): gateway se descreve e "junta" a
    // frota — só os robôs ONLINE entram na rede (Fase 6); um robô que já
    // parte sem bateria/derrubado nunca emite NODE_JOINED até religar.
    this.publishGatewayInfo();
    for (const robot of this.world.robots) {
      this.wasOnline.set(robot.address, robot.online);
      if (!robot.online) continue;
      this.sendUplink({ kind: 'node-joined', address: robot.address });
      this.log(`[gw] ⇧ NODE_JOINED ${robot.address}`);
    }

    this.nextKeepAliveAt = this.world.time + this.keepAliveIntervalS;
    const interval = this.advertiseIntervalS;
    const n = this.world.robots.length;
    this.world.robots.forEach((robot, i) => {
      // stagger opcional: offset de fase i/N do intervalo por robô
      const offset = this.staggerAdvertise && n > 1 ? (interval * i) / n : 0;
      this.nextAdvertiseAt.set(robot.address, this.world.time + interval + offset);
    });

    // Fase 7 (Peça 2): um respondedor swarmit por robô (a orquestração é do
    // backend; aqui só a máquina de estados + heartbeat de status).
    if (this.swarmitEnabled) {
      for (const robot of this.world.robots) {
        this.swarmitDevices.set(robot.address, new SwarmitDevice(robot));
      }
      this.nextSwarmitStatusAt = this.world.time + this.swarmitStatusIntervalS;
      this.log('[gw] camada swarmit LIGADA (respondedor de dispositivo)');
    }

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
      this.emitLifecycleTransitions();
      this.emitDue();
      // Fase 7: vence as entregas atrasadas no TEMPO SIMULADO deste tick
      this.uplinkNet.advanceTo(this.world.time);
      this.downlinkNet.advanceTo(this.world.time);
    }
    return n;
  }

  /** Detecta transições online⇄offline (bateria zerada ou falha injetada)
   *  e emite NODE_LEFT / NODE_JOINED exatamente 1× por transição (Fase 6).
   *  Os timers INACTIVE/LOST decorrentes são responsabilidade do backend. */
  private emitLifecycleTransitions(): void {
    for (const robot of this.world.robots) {
      const was = this.wasOnline.get(robot.address) ?? false;
      if (robot.online === was) continue;
      this.wasOnline.set(robot.address, robot.online);
      if (robot.online) {
        this.sendUplink({ kind: 'node-joined', address: robot.address });
        this.log(`[gw] ⇧ NODE_JOINED ${robot.address} (voltou à rede)`);
      } else {
        this.sendUplink({ kind: 'node-left', address: robot.address });
        this.log(`[gw] ⇧ NODE_LEFT ${robot.address} (bateria zerada ou falha injetada)`);
      }
    }
  }

  private emitDue(): void {
    const t = this.world.time + EPS;
    const interval = this.advertiseIntervalS;
    for (const robot of this.world.robots) {
      // robô sem agenda (ex.: adicionado depois do start) entra no próximo slot
      let next = this.nextAdvertiseAt.get(robot.address) ?? this.world.time + interval;
      while (t >= next) {
        // offline: o slot passa em silêncio, mas o relógio avança — ao
        // religar, o advertise retoma na cadência normal
        if (robot.online) {
          this.sendUplink({
            kind: 'node-data',
            source: robot.address,
            payload: robotToAdvertisement(robot),
          });
        }
        next += interval;
      }
      this.nextAdvertiseAt.set(robot.address, next);
    }
    while (t >= this.nextKeepAliveAt) {
      for (const robot of this.world.robots) {
        if (!robot.online) continue; // fora da rede não há keep-alive
        this.sendUplink({ kind: 'node-keep-alive', address: robot.address });
      }
      // GATEWAY_INFO periódico junto do keep-alive: deixa um cloud que
      // conectou tarde redescobrir gateway + frota (nada é retido no MQTT).
      this.publishGatewayInfo();
      this.nextKeepAliveAt += this.keepAliveIntervalS;
    }

    // Fase 7 (Peça 2): heartbeat SWARMIT_STATUS por robô online (o backend
    // acompanha device/status/bateria/pose por aqui). Robô offline não fala.
    if (this.swarmitEnabled) {
      while (t >= this.nextSwarmitStatusAt) {
        for (const robot of this.world.robots) {
          if (!robot.online) continue;
          const device = this.swarmitDevices.get(robot.address);
          if (!device) continue;
          this.sendUplink({
            kind: 'swarmit-data',
            source: robot.address,
            payload: device.heartbeat(),
          });
        }
        this.nextSwarmitStatusAt += this.swarmitStatusIntervalS;
      }
    }
  }

  private publishGatewayInfo(): void {
    this.sendUplink({
      kind: 'gateway-info',
      // asn = nº do slot TSCH — sem rádio real, derivamos do relógio
      // simulado assumindo slots de 10 ms (só precisa ser monotônico).
      asn: BigInt(Math.round(this.world.time * 100)),
      timer: Math.min(0xffffffff, Math.round(this.world.time * 1000)),
    });
  }

  /** rx do link: o comando desce ATRAVÉS do modelo de rede (Fase 7) — pode
   *  ser dropado ou atrasado antes de chegar em applyDownlink. Com os
   *  defaults (PDR=100, latência 0) a aplicação é síncrona, como antes. */
  private handleCommand(cmd: FleetCommand): void {
    this.downlinkNet.send(cmd, this.world.time, netParamsFromSim(this.world.sim));
  }

  /** Entrega efetiva do downlink no(s) robô(s) — o "rx" da seção 4.4.
   *  Os alvos são resolvidos NO MOMENTO DA ENTREGA (um robô que caiu
   *  enquanto o comando estava atrasado não recebe). */
  private applyDownlink(cmd: FleetCommand): void {
    // Fase 7 (Peça 2): comando swarmit vai pro respondedor, não pro núcleo.
    if (cmd.kind === 'swarmit') {
      this.applySwarmitDownlink(cmd);
      return;
    }
    const targets = resolveTargets(this.world, cmd.destination);
    if (targets.length === 0) {
      this.log(`[gw] comando ${cmd.kind} sem alvo online pra destination ${cmd.destination}`);
      return;
    }
    for (const robot of targets) {
      applyCommand(robot, cmd);
      this.log(`[gw] ⇩ ${cmd.kind} aplicado em ${robot.address}`);
    }
  }

  /** Entrega um comando swarmit ao(s) respondedor(es) do(s) robô(s)-alvo e
   *  faz SUBIR as respostas (OTA acks / status). A ORQUESTRAÇÃO é do backend;
   *  aqui só a reação do dispositivo. Camada desligada ⇒ ignora. */
  private applySwarmitDownlink(cmd: SwarmitCommand): void {
    if (!this.swarmitEnabled) {
      this.log('[gw] comando swarmit ignorado (camada swarmit desligada)');
      return;
    }
    const targets = resolveTargets(this.world, cmd.destination);
    if (targets.length === 0) {
      this.log(`[gw] swarmit sem alvo online pra destination ${cmd.destination}`);
      return;
    }
    for (const robot of targets) {
      const device = this.swarmitDevices.get(robot.address);
      if (!device) continue;
      for (const payload of device.onCommand(cmd.payload)) {
        this.sendUplink({ kind: 'swarmit-data', source: robot.address, payload });
      }
    }
  }
}
