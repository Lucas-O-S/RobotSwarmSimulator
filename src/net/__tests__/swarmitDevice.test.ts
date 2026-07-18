// Fase 7 (Peça 2) — máquina de estados do respondedor swarmit (lado
// dispositivo). O backend orquestra; aqui testamos só a REAÇÃO do robô.

import { describe, expect, it } from 'vitest';
import { Robot } from '../../core/Robot';
import {
  SwarmitDeviceType,
  SwarmitPayload,
  SwarmitPayloadType,
  SwarmitStatusType,
  SWARMIT_OTA_SHA_SIZE,
} from '../../protocol';
import { SwarmitDevice } from '../swarmitDevice';

function makeRobot(): Robot {
  return new Robot({ address: 'BDF2B04BC00D2725', x: 300, y: 400, theta: 0, battery: 100 });
}

function chunk(index: number): SwarmitPayload {
  return {
    type: SwarmitPayloadType.SWARMIT_OTA_CHUNK,
    index,
    sha: new Uint8Array(SWARMIT_OTA_SHA_SIZE),
    chunk: new Uint8Array(128),
  };
}

describe('SwarmitDevice — respondedor de dispositivo', () => {
  it('começa em Bootloader e o heartbeat reflete estado/pose/bateria', () => {
    const dev = new SwarmitDevice(makeRobot());
    expect(dev.status).toBe(SwarmitStatusType.Bootloader);
    const hb = dev.heartbeat();
    if (hb.type !== SwarmitPayloadType.SWARMIT_STATUS) throw new Error('esperava STATUS');
    expect(hb.device).toBe(SwarmitDeviceType.DotBotV3);
    expect(hb.status).toBe(SwarmitStatusType.Bootloader);
    expect(hb.pos_x).toBe(300);
    expect(hb.pos_y).toBe(400);
    expect(hb.battery).toBe(4200); // 100% → 4200 mV
  });

  it('SWARMIT_STATUS (request) devolve o status atual', () => {
    const dev = new SwarmitDevice(makeRobot());
    const out = dev.onCommand({
      type: SwarmitPayloadType.SWARMIT_STATUS,
      device: SwarmitDeviceType.Unknown,
      status: SwarmitStatusType.Bootloader,
      battery: 0,
      pos_x: 0,
      pos_y: 0,
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe(SwarmitPayloadType.SWARMIT_STATUS);
  });

  it('flash: OTA_START → Programming + OTA_START_ACK', () => {
    const dev = new SwarmitDevice(makeRobot());
    const out = dev.onCommand({
      type: SwarmitPayloadType.SWARMIT_OTA_START,
      fw_length: 384,
      fw_chunk_count: 3,
    });
    expect(dev.status).toBe(SwarmitStatusType.Programming);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe(SwarmitPayloadType.SWARMIT_OTA_START_ACK);
    expect(dev.allChunksReceived).toBe(false);
  });

  it('flash: cada chunk é ACKado por índice e o flash completa', () => {
    const dev = new SwarmitDevice(makeRobot());
    dev.onCommand({ type: SwarmitPayloadType.SWARMIT_OTA_START, fw_length: 384, fw_chunk_count: 3 });
    for (const i of [0, 1, 2]) {
      const out = dev.onCommand(chunk(i));
      expect(out).toHaveLength(1);
      const ack = out[0];
      if (ack.type !== SwarmitPayloadType.SWARMIT_OTA_CHUNK_ACK) throw new Error('esperava CHUNK_ACK');
      expect(ack.index).toBe(i);
    }
    expect(dev.allChunksReceived).toBe(true);
    expect(dev.flashProgress).toBe(1);
  });

  it('flash: reenvio do mesmo índice re-ACKa sem duplicar (ARQ idempotente)', () => {
    const dev = new SwarmitDevice(makeRobot());
    dev.onCommand({ type: SwarmitPayloadType.SWARMIT_OTA_START, fw_length: 256, fw_chunk_count: 2 });
    dev.onCommand(chunk(0));
    dev.onCommand(chunk(0)); // duplicado
    expect(dev.allChunksReceived).toBe(false); // só 1 dos 2 índices distintos
    dev.onCommand(chunk(1));
    expect(dev.allChunksReceived).toBe(true);
  });

  it('START → Running; STOP → Bootloader', () => {
    const dev = new SwarmitDevice(makeRobot());
    dev.onCommand({ type: SwarmitPayloadType.SWARMIT_START });
    expect(dev.status).toBe(SwarmitStatusType.Running);
    dev.onCommand({ type: SwarmitPayloadType.SWARMIT_STOP });
    expect(dev.status).toBe(SwarmitStatusType.Bootloader);
  });

  it('RESET(x,y) teleporta a pose conhecida e volta ao Bootloader', () => {
    const robot = makeRobot();
    const dev = new SwarmitDevice(robot);
    dev.onCommand({ type: SwarmitPayloadType.SWARMIT_START });
    const out = dev.onCommand({ type: SwarmitPayloadType.SWARMIT_RESET, pos_x: 1111, pos_y: 2222 });
    expect(robot.pos_x).toBe(1111);
    expect(robot.pos_y).toBe(2222);
    expect(dev.status).toBe(SwarmitStatusType.Bootloader);
    expect(out[0].type).toBe(SwarmitPayloadType.SWARMIT_STATUS);
  });

  it('MESSAGE/LH2 são aceitos sem resposta obrigatória', () => {
    const dev = new SwarmitDevice(makeRobot());
    expect(
      dev.onCommand({ type: SwarmitPayloadType.SWARMIT_MESSAGE, message: new Uint8Array([1, 2]) }),
    ).toEqual([]);
    expect(dev.onCommand({ type: SwarmitPayloadType.SWARMIT_LH2_CAPTURE })).toEqual([]);
  });
});
