// Fase 7 — Peça 1: degradação de rede APLICADA no SimGateway (FleetLink
// fake, sem MQTT). Determinístico: seed fixa (netSeed) + tempo simulado
// via step(); nada de wall-clock.
//
// Cobre: PDR=0 (tudo cai, uplink E downlink), PDR=100 (nada cai), PDR
// intermediário com seed (fração dentro do esperado), latência (entrega só
// após o atraso no tempo simulado, ordem preservada), mudança de params ao
// vivo e a REGRESSÃO: PDR=100/latência=0 (default do exemplo.json) roda
// idêntico ao baseline (net_enabled=false), com downlink síncrono.

import { describe, expect, it } from 'vitest';

import { Robot } from '../../core/Robot';
import { World } from '../../core/World';
import { SimConfig } from '../../core/types';
import { FleetCommand, FleetLink, FleetUplink } from '../../link/FleetLink';
import { SimGateway } from '../gateway';

const ADDR_1 = 'BDF2B04BC00D2725';
const ADDR_2 = 'A1B2C3D4E5F60708';

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
}

function makeWorld(simOver: Partial<SimConfig> = {}): World {
  const world = new World({
    arena: { width: 4000, height: 4000, grid: 100 },
    network: { id: '1200', gateway_addr: '0000000000000001' },
    sim: {
      tick_hz: 50,
      advertise_hz: 2, // → advertise a cada 500 ms
      battery_drain_per_min: 0,
      pdr_percent: 100,
      slot_latency_ms: 0,
      ...simOver,
    },
  });
  world.addRobot(new Robot({ address: ADDR_1, x: 500, y: 500, theta: 0 }));
  world.addRobot(new Robot({ address: ADDR_2, x: 1000, y: 1000, theta: 0 }));
  return world;
}

async function makeStarted(simOver: Partial<SimConfig> = {}, netSeed = 1234) {
  const world = makeWorld(simOver);
  const link = new FakeLink();
  const gw = new SimGateway({ world, link, autoTick: false, netSeed });
  await gw.start();
  return { world, link, gw };
}

const MOVE: FleetCommand = {
  kind: 'move-raw',
  destination: ADDR_1,
  left_x: 0,
  left_y: 80,
  right_x: 0,
  right_y: 80,
};

describe('SimGateway + netmodel — PDR (perda de pacote)', () => {
  it('PDR=0: NENHUM uplink chega (nem o ciclo inicial) e o downlink é descartado', async () => {
    const { world, link, gw } = await makeStarted({ pdr_percent: 0 });
    expect(link.uplinks).toHaveLength(0); // até o NODE_JOINED inicial caiu

    gw.step(2.0);
    expect(link.uplinks).toHaveLength(0); // advertise/keep-alive/gw-info: tudo cai

    link.inject(MOVE);
    gw.step(1.0);
    expect(world.getRobot(ADDR_1)!.pwm_left).toBe(0); // comando perdido no "rádio"
    expect(gw.netStats.downlink.dropped).toBe(1);
    expect(gw.netStats.uplink.delivered).toBe(0);
    expect(gw.netStats.uplink.dropped).toBeGreaterThan(0);
  });

  it('PDR=100: NENHUMA mensagem cai (uplink e downlink completos)', async () => {
    const { world, link, gw } = await makeStarted({ pdr_percent: 100 });
    gw.step(2.0);
    // 2 robôs: 2 joined + 4 advertises/robô? → 2 Hz × 2 s × 2 = 8 node-data
    expect(link.ofKind('node-joined')).toHaveLength(2);
    expect(link.ofKind('node-data')).toHaveLength(8);
    expect(link.ofKind('node-keep-alive')).toHaveLength(4); // 1 Hz × 2 s × 2
    expect(gw.netStats.uplink.dropped).toBe(0);

    link.inject(MOVE);
    expect(world.getRobot(ADDR_1)!.pwm_left).toBe(80); // síncrono, como sempre
    expect(gw.netStats.downlink.dropped).toBe(0);
  });

  it('PDR=50 com seed fixa: fração de drops de uplink dentro do esperado', async () => {
    const { link, gw } = await makeStarted({ pdr_percent: 50 });
    link.uplinks = [];
    gw.step(25.0); // 2 Hz × 25 s × 2 robôs = 100 advertises tentados
    const delivered = link.ofKind('node-data').length;
    // esperado ~50; tolerância larga (±4σ, σ = √(100·0,25) = 5)
    expect(delivered).toBeGreaterThan(30);
    expect(delivered).toBeLessThan(70);
    // e é reprodutível: mesma seed → mesma contagem exata
    const again = await makeStarted({ pdr_percent: 50 });
    again.link.uplinks = [];
    again.gw.step(25.0);
    expect(again.link.ofKind('node-data')).toHaveLength(delivered);
  });
});

describe('SimGateway + netmodel — latência (tempo simulado)', () => {
  it('uplink só é entregue após o atraso no tempo simulado', async () => {
    const { link, gw } = await makeStarted({ slot_latency_ms: 200 });
    // ciclo inicial (t=0) fica agendado pra t=0,2 — nada sai no start()
    expect(link.uplinks).toHaveLength(0);

    gw.step(0.1); // t = 0,1 < 0,2
    expect(link.uplinks).toHaveLength(0);

    gw.step(0.1); // t = 0,2 → GATEWAY_INFO + 2 NODE_JOINED vencem
    expect(link.ofKind('gateway-info')).toHaveLength(1);
    expect(link.ofKind('node-joined')).toHaveLength(2);

    // advertises são emitidos em t=0,5 → só chegam em t=0,7
    gw.step(0.4); // t = 0,6
    expect(link.ofKind('node-data')).toHaveLength(0);
    gw.step(0.12); // t = 0,72 ≥ 0,7
    expect(link.ofKind('node-data')).toHaveLength(2);
  });

  it('downlink só aplica o comando após o atraso no tempo simulado', async () => {
    const { world, link, gw } = await makeStarted({ slot_latency_ms: 100 });
    const r1 = world.getRobot(ADDR_1)!;

    link.inject(MOVE); // enviado em t=0 → vence em t=0,1
    expect(r1.pwm_left).toBe(0); // NÃO aplicou na hora

    gw.step(0.06); // t = 0,06 < 0,1
    expect(r1.pwm_left).toBe(0);

    gw.step(0.06); // t = 0,12 ≥ 0,1 → aplicado
    expect(r1.pwm_left).toBe(80);
    expect(gw.netStats.downlink.delivered).toBe(1);
  });

  it('mensagens atrasadas chegam em ORDEM de tempo simulado', async () => {
    const { link, gw } = await makeStarted({ slot_latency_ms: 200 });
    gw.step(2.0);
    // advertise emitido em t=0,5 tem que chegar antes do keep-alive de t=1,0
    const kinds = link.uplinks.map((u) => u.kind);
    const firstData = kinds.indexOf('node-data');
    const firstKeepAlive = kinds.indexOf('node-keep-alive');
    expect(firstData).toBeGreaterThanOrEqual(0);
    expect(firstKeepAlive).toBeGreaterThan(firstData);
    // e o robô 1 sempre antes do robô 2 dentro da mesma rodada (FIFO no empate)
    const dataSources = link.uplinks
      .filter((u): u is Extract<FleetUplink, { kind: 'node-data' }> => u.kind === 'node-data')
      .map((u) => u.source);
    expect(dataSources[0]).toBe(ADDR_1);
    expect(dataSources[1]).toBe(ADDR_2);
  });

  it('parâmetros mudam AO VIVO (o menu da UI edita world.sim)', async () => {
    const { world, link, gw } = await makeStarted();
    link.uplinks = [];
    gw.step(1.0);
    expect(link.ofKind('node-data')).toHaveLength(4); // rede perfeita

    world.sim.pdr_percent = 0; // usuário derruba a rede no menu
    link.uplinks = [];
    gw.step(1.0);
    expect(link.uplinks).toHaveLength(0);

    world.sim.net_enabled = false; // kill-switch ignora o PDR=0
    link.uplinks = [];
    gw.step(1.0);
    expect(link.ofKind('node-data')).toHaveLength(4);
  });
});

describe('SimGateway + netmodel — regressão (baseline preservado)', () => {
  it('PDR=100/latência=0 (default) roda IDÊNTICO ao baseline (net_enabled=false)', async () => {
    // A: defaults do exemplo.json (pdr 100, lat 0, net_enabled ausente)
    // B: degradação explicitamente DESLIGADA (o caminho baseline puro)
    const a = await makeStarted({});
    const b = await makeStarted({ net_enabled: false });

    const script = (s: { world: World; link: FakeLink; gw: SimGateway }) => {
      s.gw.step(1.5);
      s.link.inject(MOVE);
      // downlink SÍNCRONO: aplicado antes de qualquer step (como nas Fases 1–6)
      expect(s.world.getRobot(ADDR_1)!.pwm_left).toBe(80);
      s.gw.step(1.5);
      s.world.getRobot(ADDR_2)!.setOnline(false);
      s.gw.step(1.0);
    };
    script(a);
    script(b);

    // sequências de uplink byte-a-byte iguais (mesmos eventos, mesma ordem,
    // mesmas poses) e nenhuma perda/pendência em nenhum dos dois
    expect(a.link.uplinks).toEqual(b.link.uplinks);
    for (const s of [a, b]) {
      expect(s.gw.netStats.uplink.dropped).toBe(0);
      expect(s.gw.netStats.uplink.pending).toBe(0);
      expect(s.gw.netStats.downlink.dropped).toBe(0);
      expect(s.gw.netStats.downlink.pending).toBe(0);
    }
    // e as poses finais dos mundos são idênticas
    expect(a.world.robots.map((r) => [r.pos_x, r.pos_y, r.theta])).toEqual(
      b.world.robots.map((r) => [r.pos_x, r.pos_y, r.theta]),
    );
  });
});
