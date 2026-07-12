// Fase 5 — testes unitários do SimGateway (com FleetLink fake, sem MQTT):
// ciclo de vida (GATEWAY_INFO/NODE_JOINED/KEEP_ALIVE/advertise), conversão
// core → DOTBOT_ADVERTISEMENT e roteamento de comandos por destination.

import { describe, expect, it } from 'vitest';

import { Robot } from '../../core/Robot';
import { World } from '../../core/World';
import { ControlModeType } from '../../core/types';
import { PayloadType } from '../../protocol';
import {
  BROADCAST_DEST,
  FleetCommand,
  FleetLink,
  FleetUplink,
  NodeDataUplink,
} from '../../link/FleetLink';
import {
  batteryToMillivolts,
  directionFromTheta,
  resolveTargets,
  robotToAdvertisement,
  SimGateway,
} from '../gateway';

const ADDR_1 = 'BDF2B04BC00D2725';
const ADDR_2 = 'A1B2C3D4E5F60708';

class FakeLink implements FleetLink {
  uplinks: FleetUplink[] = [];
  startCount = 0;
  stopCount = 0;
  private cb?: (cmd: FleetCommand) => void;

  async start(): Promise<void> {
    this.startCount++;
  }
  async stop(): Promise<void> {
    this.stopCount++;
  }
  onCommand(cb: (cmd: FleetCommand) => void): void {
    this.cb = cb;
  }
  publishUplink(uplink: FleetUplink): void {
    this.uplinks.push(uplink);
  }
  /** Injeta um comando como se tivesse descido do broker. */
  inject(cmd: FleetCommand): void {
    this.cb?.(cmd);
  }
  ofKind(kind: FleetUplink['kind']): FleetUplink[] {
    return this.uplinks.filter((u) => u.kind === kind);
  }
}

function makeWorld(): World {
  const world = new World({
    arena: { width: 4000, height: 4000, grid: 100 },
    network: { id: '1200', gateway_addr: '0000000000000001' },
    sim: {
      tick_hz: 50,
      advertise_hz: 2, // → advertise a cada 500 ms
      battery_drain_per_min: 0,
      pdr_percent: 100,
      slot_latency_ms: 0,
    },
  });
  world.addRobot(new Robot({ address: ADDR_1, x: 500, y: 500, theta: 0 }));
  world.addRobot(new Robot({ address: ADDR_2, x: 1000, y: 1000, theta: Math.PI / 2 }));
  return world;
}

async function makeStarted(): Promise<{ world: World; link: FakeLink; gw: SimGateway }> {
  const world = makeWorld();
  const link = new FakeLink();
  const gw = new SimGateway({ world, link, autoTick: false });
  await gw.start();
  return { world, link, gw };
}

describe('net/gateway — conversões puras', () => {
  it('directionFromTheta: rad → graus em [0, 360)', () => {
    expect(directionFromTheta(0)).toBe(0);
    expect(directionFromTheta(Math.PI / 2)).toBe(90);
    expect(directionFromTheta(Math.PI)).toBe(180);
    expect(directionFromTheta(-Math.PI / 2)).toBe(270);
    expect(directionFromTheta(2 * Math.PI + 0.001)).toBe(0);
  });

  it('batteryToMillivolts: rampa 0% = 3000 mV … 100% = 4200 mV, com clamp', () => {
    expect(batteryToMillivolts(100)).toBe(4200);
    expect(batteryToMillivolts(0)).toBe(3000);
    expect(batteryToMillivolts(50)).toBe(3600);
    expect(batteryToMillivolts(150)).toBe(4200);
    expect(batteryToMillivolts(-5)).toBe(3000);
  });

  it('robotToAdvertisement mapeia pose/estado pros campos do payload', () => {
    const robot = new Robot({ address: ADDR_1, x: 1234.6, y: 55.4, theta: Math.PI / 2 });
    robot.pwm_left = -20;
    robot.pwm_right = 100;
    robot.encoder_left = -12.7;
    robot.encoder_right = 88.2;
    robot.setWaypoints(
      [
        { x: 1500, y: 300 },
        { x: 1500, y: 1700 },
      ],
      50,
    );
    const adv = robotToAdvertisement(robot);
    expect(adv.type).toBe(PayloadType.DOTBOT_ADVERTISEMENT);
    expect(adv.calibrated).toBe(0x02); // "calibrado no LH2"
    expect(adv.direction).toBe(90);
    expect(adv.pos_x).toBe(1235); // arredondado pra u32
    expect(adv.pos_y).toBe(55);
    expect(adv.battery).toBe(4200);
    expect(adv.pwm_left).toBe(-20);
    expect(adv.pwm_right).toBe(100);
    expect(adv.mode).toBe(ControlModeType.Auto);
    expect(adv.encoder_left).toBe(-13);
    expect(adv.encoder_right).toBe(88);
    expect(adv.waypoint_x).toBe(1500); // alvo corrente (idx 0)
    expect(adv.waypoint_y).toBe(300);
    expect(adv.waypoint_idx).toBe(0);
  });

  it('robotToAdvertisement sem rota: waypoint_x/y = 0, idx = 0, Manual', () => {
    const robot = new Robot({ address: ADDR_1, x: 10, y: 20, theta: 0 });
    const adv = robotToAdvertisement(robot);
    expect(adv.mode).toBe(ControlModeType.Manual);
    expect(adv.waypoint_x).toBe(0);
    expect(adv.waypoint_y).toBe(0);
    expect(adv.waypoint_idx).toBe(0);
  });

  it('robotToAdvertisement com rota concluída mantém o último alvo', () => {
    const robot = new Robot({ address: ADDR_1, x: 0, y: 0, theta: 0 });
    robot.setWaypoints([{ x: 100, y: 200 }], 50);
    robot.waypoint_idx = 1; // rota concluída (idx == length)
    const adv = robotToAdvertisement(robot);
    expect(adv.waypoint_x).toBe(100);
    expect(adv.waypoint_y).toBe(200);
    expect(adv.waypoint_idx).toBe(1);
  });
});

describe('net/gateway — roteamento por destination', () => {
  it('address exato resolve um robô; broadcast resolve todos; alheio, nenhum', () => {
    const world = makeWorld();
    expect(resolveTargets(world, ADDR_1).map((r) => r.address)).toEqual([ADDR_1]);
    expect(resolveTargets(world, BROADCAST_DEST)).toHaveLength(2);
    expect(resolveTargets(world, '0000000000000099')).toHaveLength(0);
  });

  it('move-raw só afeta o robô destinatário', async () => {
    const { world, link } = await makeStarted();
    link.inject({
      kind: 'move-raw',
      destination: ADDR_1,
      left_x: 0,
      left_y: 80,
      right_x: 0,
      right_y: 80,
    });
    expect(world.getRobot(ADDR_1)!.pwm_left).toBe(80);
    expect(world.getRobot(ADDR_1)!.mode).toBe(ControlModeType.Manual);
    expect(world.getRobot(ADDR_2)!.pwm_left).toBe(0);
  });

  it('rgb em broadcast afeta a frota inteira', async () => {
    const { world, link } = await makeStarted();
    link.inject({ kind: 'rgb', destination: BROADCAST_DEST, red: 10, green: 20, blue: 30 });
    for (const r of world.robots) {
      expect(r.rgb).toEqual({ r: 10, g: 20, b: 30 });
    }
  });

  it('waypoints carrega a rota e entra em AUTO; control-mode alterna', async () => {
    const { world, link } = await makeStarted();
    link.inject({
      kind: 'waypoints',
      destination: ADDR_2,
      threshold: 60,
      waypoints: [{ x: 1500, y: 300 }],
    });
    const r2 = world.getRobot(ADDR_2)!;
    expect(r2.mode).toBe(ControlModeType.Auto);
    expect(r2.waypoints).toEqual([{ x: 1500, y: 300 }]);
    expect(r2.waypoint_threshold).toBe(60);

    link.inject({ kind: 'control-mode', destination: ADDR_2, mode: ControlModeType.Manual });
    expect(r2.mode).toBe(ControlModeType.Manual);
    expect(r2.pwm_left).toBe(0);
  });

  it('destination desconhecido não explode (só ignora)', async () => {
    const { link } = await makeStarted();
    expect(() =>
      link.inject({
        kind: 'move-raw',
        destination: '00000000000000AA',
        left_x: 0,
        left_y: 10,
        right_x: 0,
        right_y: 10,
      }),
    ).not.toThrow();
  });
});

describe('net/gateway — ciclo de vida e loop (seção 4.4)', () => {
  it('start(): GATEWAY_INFO primeiro, depois um NODE_JOINED por robô', async () => {
    const { link } = await makeStarted();
    expect(link.startCount).toBe(1);
    expect(link.uplinks[0].kind).toBe('gateway-info');
    const joined = link.ofKind('node-joined');
    expect(joined).toHaveLength(2);
    expect(joined.map((u) => (u.kind === 'node-joined' ? u.address : ''))).toEqual([
      ADDR_1,
      ADDR_2,
    ]);
  });

  it('step(1 s): 2 rodadas de advertise (2 Hz) e 1 de keep-alive por robô', async () => {
    const { link, gw } = await makeStarted();
    link.uplinks = []; // descarta o ciclo inicial
    const ticks = gw.step(1.0);
    expect(ticks).toBe(50); // tick_hz = 50

    const advs = link.ofKind('node-data');
    expect(advs).toHaveLength(2 * 2); // 2 rodadas × 2 robôs
    const keepAlives = link.ofKind('node-keep-alive');
    expect(keepAlives).toHaveLength(2); // 1 rodada × 2 robôs
    // GATEWAY_INFO reemitido junto do keep-alive (descoberta tardia)
    expect(link.ofKind('gateway-info')).toHaveLength(1);
  });

  it('advertise carrega a pose ATUAL (robô andando aparece andando)', async () => {
    const { world, link, gw } = await makeStarted();
    const r1 = world.getRobot(ADDR_1)!;
    const x0 = r1.pos_x;
    link.inject({
      kind: 'move-raw',
      destination: ADDR_1,
      left_x: 0,
      left_y: 100,
      right_x: 0,
      right_y: 100,
    });
    link.uplinks = [];
    gw.step(1.0);

    const advs = link
      .ofKind('node-data')
      .filter((u): u is NodeDataUplink => u.kind === 'node-data' && u.source === ADDR_1);
    expect(advs.length).toBeGreaterThanOrEqual(2);
    const first = advs[0].payload;
    const last = advs[advs.length - 1].payload;
    if (
      first.type !== PayloadType.DOTBOT_ADVERTISEMENT ||
      last.type !== PayloadType.DOTBOT_ADVERTISEMENT
    ) {
      throw new Error('esperava DOTBOT_ADVERTISEMENT');
    }
    // theta=0 → anda em +x; cada advertise reflete a pose do momento
    expect(first.pos_x).toBeGreaterThan(x0);
    expect(last.pos_x).toBeGreaterThan(first.pos_x);
    expect(Math.abs(last.pos_x - r1.pos_x)).toBeLessThanOrEqual(1);
    expect(last.pwm_left).toBe(100);
  });

  it('intervalos respeitam advertise_hz do cenário (4 Hz → 4 rodadas/s)', async () => {
    const world = makeWorld();
    world.sim.advertise_hz = 4;
    const link = new FakeLink();
    const gw = new SimGateway({ world, link, autoTick: false });
    await gw.start();
    link.uplinks = [];
    gw.step(1.0);
    expect(link.ofKind('node-data')).toHaveLength(4 * 2);
  });

  it('stop() para o link', async () => {
    const { link, gw } = await makeStarted();
    await gw.stop();
    expect(link.stopCount).toBe(1);
  });
});
