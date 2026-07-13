// Fase 6 — ciclo de vida / liveness no SimGateway (FleetLink fake, sem MQTT):
//   - robô offline (bateria 0 ou falha injetada) → NODE_LEFT exatamente 1×,
//     advertise/keep-alive param; ao religar → NODE_JOINED e retoma;
//   - robô offline não recebe downlink (nem broadcast);
//   - frota com N robôs: todos advertisam, roteamento atinge só o alvo;
//   - staggerAdvertise espalha os advertises sem mudar a taxa por robô.
//
// FRONTEIRA: o NODE_LEFT daqui é só o GATILHO do envelhecimento — os timers
// ACTIVE→INACTIVE(5 s)→LOST(60 s) da seção 4.5 vivem no controller/backend.

import { describe, expect, it } from 'vitest';

import { Robot } from '../../core/Robot';
import { World } from '../../core/World';
import {
  FleetCommand,
  FleetLink,
  FleetUplink,
  BROADCAST_DEST,
  NodeDataUplink,
} from '../../link/FleetLink';
import { SimGateway } from '../gateway';

const ADDR_A = 'BDF2B04BC00D2725';
const ADDR_B = 'A1B2C3D4E5F60708';

class FakeLink implements FleetLink {
  uplinks: FleetUplink[] = [];
  private cb?: (cmd: FleetCommand) => void;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onCommand(cb: (cmd: FleetCommand) => void): void {
    this.cb = cb;
  }
  publishUplink(uplink: FleetUplink): void {
    this.uplinks.push(uplink);
  }
  inject(cmd: FleetCommand): void {
    this.cb?.(cmd);
  }
  ofKind(kind: FleetUplink['kind']): FleetUplink[] {
    return this.uplinks.filter((u) => u.kind === kind);
  }
  /** node-left/joined/keep-alive de um address específico. */
  lifecycleOf(kind: 'node-joined' | 'node-left' | 'node-keep-alive', address: string) {
    return this.uplinks.filter((u) => u.kind === kind && u.address === address);
  }
  /** advertisements (node-data) de um address específico. */
  advsOf(address: string): NodeDataUplink[] {
    return this.uplinks.filter(
      (u): u is NodeDataUplink => u.kind === 'node-data' && u.source === address,
    );
  }
}

function makeWorld(robots: Robot[], drainPerMin = 0): World {
  return new World({
    arena: { width: 4000, height: 4000, grid: 100 },
    network: { id: '1200', gateway_addr: '0000000000000001' },
    sim: {
      tick_hz: 50,
      advertise_hz: 2, // → 500 ms
      battery_drain_per_min: drainPerMin,
      pdr_percent: 100,
      slot_latency_ms: 0,
    },
    robots,
  });
}

describe('SimGateway — bateria → 0 (Fase 6)', () => {
  it('emite NODE_LEFT exatamente 1× e para de anunciar o robô morto', async () => {
    // drain 60 %/min = 1 %/s = 0.02 %/tick: A (0.01%) morre no 1º tick
    const a = new Robot({ address: ADDR_A, x: 500, y: 500, theta: 0, battery: 0.01 });
    const b = new Robot({ address: ADDR_B, x: 1000, y: 1000, theta: 0, battery: 100 });
    const world = makeWorld([a, b], 60);
    const link = new FakeLink();
    const gw = new SimGateway({ world, link, autoTick: false });
    await gw.start();
    link.uplinks = [];

    gw.step(2.0);

    expect(a.online).toBe(false);
    // NODE_LEFT do A exatamente uma vez, mesmo após 100 ticks offline
    expect(link.lifecycleOf('node-left', ADDR_A)).toHaveLength(1);
    expect(link.lifecycleOf('node-left', ADDR_B)).toHaveLength(0);
    // A morreu antes do 1º advertise/keep-alive: silêncio total
    expect(link.advsOf(ADDR_A)).toHaveLength(0);
    expect(link.lifecycleOf('node-keep-alive', ADDR_A)).toHaveLength(0);
    // B segue normal: 4 advertises (2 Hz × 2 s) e 2 keep-alives
    expect(link.advsOf(ADDR_B)).toHaveLength(4);
    expect(link.lifecycleOf('node-keep-alive', ADDR_B)).toHaveLength(2);
  });

  it('robô que JÁ parte sem bateria não gera NODE_JOINED no start', async () => {
    const dead = new Robot({ address: ADDR_A, x: 500, y: 500, theta: 0, battery: 0 });
    const live = new Robot({ address: ADDR_B, x: 1000, y: 1000, theta: 0 });
    const world = makeWorld([dead, live]);
    const link = new FakeLink();
    const gw = new SimGateway({ world, link, autoTick: false });
    await gw.start();

    expect(link.lifecycleOf('node-joined', ADDR_A)).toHaveLength(0);
    expect(link.lifecycleOf('node-joined', ADDR_B)).toHaveLength(1);

    gw.step(2.0);
    expect(link.advsOf(ADDR_A)).toHaveLength(0);
    expect(link.lifecycleOf('node-left', ADDR_A)).toHaveLength(0); // nunca entrou
  });
});

describe('SimGateway — injeção de falha setOnline (Fase 6)', () => {
  it('setOnline(false) → NODE_LEFT 1× e advertise pausa; setOnline(true) → NODE_JOINED e retoma', async () => {
    const a = new Robot({ address: ADDR_A, x: 500, y: 500, theta: 0 });
    const b = new Robot({ address: ADDR_B, x: 1000, y: 1000, theta: 0 });
    const world = makeWorld([a, b]);
    const link = new FakeLink();
    const gw = new SimGateway({ world, link, autoTick: false });
    await gw.start();
    link.uplinks = [];

    // online: 1 s → 2 advertises + 1 keep-alive do A
    gw.step(1.0);
    expect(link.advsOf(ADDR_A)).toHaveLength(2);
    expect(link.lifecycleOf('node-keep-alive', ADDR_A)).toHaveLength(1);

    // derruba: NODE_LEFT 1× e silêncio (B continua)
    link.uplinks = [];
    a.setOnline(false);
    gw.step(2.0);
    expect(link.lifecycleOf('node-left', ADDR_A)).toHaveLength(1);
    expect(link.advsOf(ADDR_A)).toHaveLength(0);
    expect(link.lifecycleOf('node-keep-alive', ADDR_A)).toHaveLength(0);
    expect(link.advsOf(ADDR_B)).toHaveLength(4);

    // religa: NODE_JOINED re-emitido e advertise/keep-alive retomam
    link.uplinks = [];
    a.setOnline(true);
    gw.step(1.0);
    expect(link.lifecycleOf('node-joined', ADDR_A)).toHaveLength(1);
    expect(link.lifecycleOf('node-left', ADDR_A)).toHaveLength(0);
    expect(link.advsOf(ADDR_A).length).toBeGreaterThanOrEqual(1);
    expect(link.lifecycleOf('node-keep-alive', ADDR_A)).toHaveLength(1);
  });

  it('robô offline não recebe downlink — nem por address, nem por broadcast', async () => {
    const a = new Robot({ address: ADDR_A, x: 500, y: 500, theta: 0 });
    const b = new Robot({ address: ADDR_B, x: 1000, y: 1000, theta: 0 });
    const world = makeWorld([a, b]);
    const link = new FakeLink();
    const gw = new SimGateway({ world, link, autoTick: false });
    await gw.start();

    a.setOnline(false);
    link.inject({
      kind: 'move-raw',
      destination: ADDR_A,
      left_x: 0,
      left_y: 100,
      right_x: 0,
      right_y: 100,
    });
    expect(a.pwm_left).toBe(0); // fora da rede, não há rádio

    link.inject({ kind: 'rgb', destination: BROADCAST_DEST, red: 9, green: 8, blue: 7 });
    expect(a.rgb).toEqual({ r: 0, g: 0, b: 0 }); // broadcast também não chega
    expect(b.rgb).toEqual({ r: 9, g: 8, b: 7 });

    // religado, volta a receber
    a.setOnline(true);
    link.inject({ kind: 'rgb', destination: BROADCAST_DEST, red: 1, green: 2, blue: 3 });
    expect(a.rgb).toEqual({ r: 1, g: 2, b: 3 });
  });
});

describe('SimGateway — frota com N robôs (Fase 6)', () => {
  const N = 6;

  function makeFleet() {
    const robots = Array.from(
      { length: N },
      (_, i) =>
        new Robot({
          address: `0A11CE000000000${i + 1}`,
          x: 300 + 400 * i,
          y: 300,
          theta: 0,
        }),
    );
    return { robots, world: makeWorld(robots) };
  }

  it('todos os N robôs entram (NODE_JOINED) e geram advertise', async () => {
    const { robots, world } = makeFleet();
    const link = new FakeLink();
    const gw = new SimGateway({ world, link, autoTick: false });
    await gw.start();

    for (const r of robots) {
      expect(link.lifecycleOf('node-joined', r.address)).toHaveLength(1);
    }

    link.uplinks = [];
    gw.step(1.0);
    for (const r of robots) {
      expect(link.advsOf(r.address)).toHaveLength(2); // 2 Hz × 1 s
      expect(link.lifecycleOf('node-keep-alive', r.address)).toHaveLength(1);
    }
  });

  it('comando por address atinge SÓ o alvo entre N robôs', async () => {
    const { robots, world } = makeFleet();
    const link = new FakeLink();
    const gw = new SimGateway({ world, link, autoTick: false });
    await gw.start();

    const target = robots[3];
    link.inject({
      kind: 'move-raw',
      destination: target.address,
      left_x: 0,
      left_y: 90,
      right_x: 0,
      right_y: 90,
    });
    for (const r of robots) {
      expect(r.pwm_left).toBe(r === target ? 90 : 0);
      expect(r.pwm_right).toBe(r === target ? 90 : 0);
    }
  });

  it('staggerAdvertise espalha os advertises por ticks distintos mantendo a taxa por robô', async () => {
    const robots = Array.from(
      { length: 4 },
      (_, i) => new Robot({ address: `0A11CE000000000${i + 1}`, x: 300, y: 300, theta: 0 }),
    );
    const world = makeWorld(robots);
    const link = new FakeLink();
    const gw = new SimGateway({ world, link, autoTick: false, staggerAdvertise: true });
    await gw.start();
    link.uplinks = [];

    // avança tick a tick por 2 s, medindo quantos advertises saem por tick
    let maxPerTick = 0;
    for (let i = 0; i < 100; i++) {
      const before = link.ofKind('node-data').length;
      gw.step(world.tickDt);
      maxPerTick = Math.max(maxPerTick, link.ofKind('node-data').length - before);
    }

    // escalonado: nunca a frota inteira no mesmo tick (aqui, 1 por tick)
    expect(maxPerTick).toBe(1);
    // e a taxa por robô continua ~advertise_hz (2 Hz): 3–4 em 2 s
    for (const r of robots) {
      const n = link.advsOf(r.address).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(4);
    }
  });
});
