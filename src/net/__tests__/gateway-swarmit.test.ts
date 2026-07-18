// Fase 7 (Peça 2) — integração swarmit no SimGateway (link fake, sem broker):
//   - comando swarmit descendo → respondedor reage e o ack/status SOBE;
//   - roteamento por kind: swarmit não mexe no núcleo, dotbot não vira swarmit;
//   - heartbeat SWARMIT_STATUS periódico enquanto a camada está ligada;
//   - camada desligada ⇒ nenhum uplink swarmit.

import { describe, expect, it } from 'vitest';
import { loadScenario } from '../../core/scenario';
import { ControlModeType, Scenario } from '../../core/types';
import {
  FleetCommand,
  FleetLink,
  FleetUplink,
  SwarmitDataUplink,
} from '../../link/FleetLink';
import { SwarmitPayloadType, SwarmitStatusType, SWARMIT_OTA_SHA_SIZE } from '../../protocol';
import { SimGateway } from '../gateway';

const ROBOT = 'BDF2B04BC00D2725';

const SCENARIO: Scenario = {
  version: 1,
  network: { id: '1200', gateway_addr: '0000000000000001' },
  arena: { width_mm: 4000, height_mm: 4000, grid_mm: 100 },
  obstacles: [],
  robots: [
    { address: ROBOT, application: 0, mode: 0, start: { x_mm: 500, y_mm: 500, theta_deg: 0 }, battery: 100 },
  ],
  sim: { tick_hz: 50, advertise_hz: 2, battery_drain_per_min: 0, pdr_percent: 100, slot_latency_ms: 0 },
};

class FakeLink implements FleetLink {
  private cb?: (cmd: FleetCommand) => void;
  readonly uplinks: FleetUplink[] = [];
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onCommand(cb: (cmd: FleetCommand) => void): void {
    this.cb = cb;
  }
  publishUplink(u: FleetUplink): void {
    this.uplinks.push(u);
  }
  /** simula um comando descendo do backend (já decodificado). */
  inject(cmd: FleetCommand): void {
    this.cb?.(cmd);
  }
  swarmit(): SwarmitDataUplink[] {
    return this.uplinks.filter((u): u is SwarmitDataUplink => u.kind === 'swarmit-data');
  }
}

async function makeGateway(swarmitEnabled: boolean) {
  const world = loadScenario(SCENARIO);
  const link = new FakeLink();
  const gateway = new SimGateway({ world, link, autoTick: false, swarmitEnabled });
  await gateway.start();
  return { world, link, gateway };
}

describe('SimGateway — camada swarmit (Peça 2)', () => {
  it('OTA_START desce e o OTA_START_ACK sobe (respondedor reage)', async () => {
    const { link } = await makeGateway(true);
    link.uplinks.length = 0;
    link.inject({
      kind: 'swarmit',
      destination: ROBOT,
      payload: { type: SwarmitPayloadType.SWARMIT_OTA_START, fw_length: 256, fw_chunk_count: 2 },
    });
    const acks = link.swarmit().map((u) => u.payload.type);
    expect(acks).toContain(SwarmitPayloadType.SWARMIT_OTA_START_ACK);
  });

  it('cada OTA_CHUNK sobe um OTA_CHUNK_ACK com o índice certo', async () => {
    const { link } = await makeGateway(true);
    link.inject({
      kind: 'swarmit',
      destination: ROBOT,
      payload: { type: SwarmitPayloadType.SWARMIT_OTA_START, fw_length: 256, fw_chunk_count: 2 },
    });
    link.uplinks.length = 0;
    link.inject({
      kind: 'swarmit',
      destination: ROBOT,
      payload: {
        type: SwarmitPayloadType.SWARMIT_OTA_CHUNK,
        index: 1,
        sha: new Uint8Array(SWARMIT_OTA_SHA_SIZE),
        chunk: new Uint8Array(128),
      },
    });
    const acks = link.swarmit();
    expect(acks).toHaveLength(1);
    const ack = acks[0].payload;
    if (ack.type !== SwarmitPayloadType.SWARMIT_OTA_CHUNK_ACK) throw new Error('esperava CHUNK_ACK');
    expect(ack.index).toBe(1);
  });

  it('heartbeat SWARMIT_STATUS sobe periodicamente com a camada ligada', async () => {
    const { link, gateway } = await makeGateway(true);
    link.uplinks.length = 0;
    gateway.step(1.1); // > 1 s → ao menos 1 heartbeat
    const statuses = link.swarmit().filter((u) => u.payload.type === SwarmitPayloadType.SWARMIT_STATUS);
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    const st = statuses[0].payload;
    if (st.type !== SwarmitPayloadType.SWARMIT_STATUS) throw new Error('esperava STATUS');
    expect(st.status).toBe(SwarmitStatusType.Bootloader);
    expect(st.pos_x).toBe(500);
  });

  it('START pelo swarmit não mexe no núcleo (robô não anda)', async () => {
    const { world, link } = await makeGateway(true);
    const r = world.getRobot(ROBOT)!;
    const x0 = r.pos_x;
    link.inject({ kind: 'swarmit', destination: ROBOT, payload: { type: SwarmitPayloadType.SWARMIT_START } });
    // sem move-raw, o robô continua parado mesmo com o device em Running
    expect(r.pos_x).toBe(x0);
    expect(r.mode).toBe(ControlModeType.Manual);
  });

  it('camada DESLIGADA: comando swarmit é ignorado (nenhum uplink swarmit)', async () => {
    const { link, gateway } = await makeGateway(false);
    link.uplinks.length = 0;
    link.inject({ kind: 'swarmit', destination: ROBOT, payload: { type: SwarmitPayloadType.SWARMIT_START } });
    gateway.step(2.0);
    expect(link.swarmit()).toHaveLength(0);
  });
});
