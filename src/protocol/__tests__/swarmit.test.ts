// Fase 7 (Peça 2) — round-trip do codec swarmit (src/protocol/swarmit.ts).
// Cada payload: encode → decode devolve o mesmo objeto; + checagens de
// tamanho/offset e endianness little-endian, contra o layout confirmado no
// swarmit/testbed/protocol.py.

import { describe, expect, it } from 'vitest';
import {
  decodeSwarmitPayload,
  encodeSwarmitPayload,
  SwarmitDeviceType,
  SwarmitPayload,
  SwarmitPayloadType,
  SwarmitStatusType,
  SWARMIT_LH2_HOMOGRAPHY_SIZE,
  SWARMIT_OTA_SHA_SIZE,
} from '../swarmit';

function roundtrip(p: SwarmitPayload): SwarmitPayload {
  return decodeSwarmitPayload(encodeSwarmitPayload(p));
}

describe('codec swarmit — round-trip', () => {
  it('SWARMIT_STATUS (device/status/battery/pos) — 13 bytes', () => {
    const p: SwarmitPayload = {
      type: SwarmitPayloadType.SWARMIT_STATUS,
      device: SwarmitDeviceType.DotBotV3,
      status: SwarmitStatusType.Running,
      battery: 4200,
      pos_x: -1234,
      pos_y: 5678,
    };
    const bytes = encodeSwarmitPayload(p);
    expect(bytes.length).toBe(1 + 12); // type + device+status+u16+i32+i32
    expect(roundtrip(p)).toEqual(p);
  });

  it('pos_x/pos_y são i32 com sinal', () => {
    const p: SwarmitPayload = {
      type: SwarmitPayloadType.SWARMIT_STATUS,
      device: SwarmitDeviceType.DotBotV3,
      status: SwarmitStatusType.Bootloader,
      battery: 0,
      pos_x: -2000000000,
      pos_y: -1,
    };
    expect(roundtrip(p)).toEqual(p);
  });

  it('payloads vazios (START/STOP/OTA_START_ACK/LH2_CAPTURE) — 1 byte', () => {
    for (const type of [
      SwarmitPayloadType.SWARMIT_START,
      SwarmitPayloadType.SWARMIT_STOP,
      SwarmitPayloadType.SWARMIT_OTA_START_ACK,
      SwarmitPayloadType.SWARMIT_LH2_CAPTURE,
    ] as const) {
      const bytes = encodeSwarmitPayload({ type });
      expect(bytes.length).toBe(1);
      expect(bytes[0]).toBe(type);
      expect(roundtrip({ type })).toEqual({ type });
    }
  });

  it('SWARMIT_RESET (pos_x/pos_y u32)', () => {
    const p: SwarmitPayload = {
      type: SwarmitPayloadType.SWARMIT_RESET,
      pos_x: 1000,
      pos_y: 2000,
    };
    expect(encodeSwarmitPayload(p).length).toBe(1 + 8);
    expect(roundtrip(p)).toEqual(p);
  });

  it('SWARMIT_OTA_START (fw_length/fw_chunk_count u32, LE)', () => {
    const p: SwarmitPayload = {
      type: SwarmitPayloadType.SWARMIT_OTA_START,
      fw_length: 0x11223344,
      fw_chunk_count: 7,
    };
    const bytes = encodeSwarmitPayload(p);
    expect(bytes.length).toBe(1 + 8);
    // little-endian: fw_length começa no offset 1
    expect([bytes[1], bytes[2], bytes[3], bytes[4]]).toEqual([0x44, 0x33, 0x22, 0x11]);
    expect(roundtrip(p)).toEqual(p);
  });

  it('SWARMIT_OTA_CHUNK (index u32 + count u8 + sha[8] + chunk[count])', () => {
    const chunk = new Uint8Array(128).map((_, i) => i & 0xff);
    const sha = new Uint8Array(SWARMIT_OTA_SHA_SIZE).map((_, i) => 0xa0 + i);
    const p: SwarmitPayload = {
      type: SwarmitPayloadType.SWARMIT_OTA_CHUNK,
      index: 3,
      sha,
      chunk,
    };
    const bytes = encodeSwarmitPayload(p);
    expect(bytes.length).toBe(1 + 4 + 1 + SWARMIT_OTA_SHA_SIZE + chunk.length);
    const out = roundtrip(p);
    expect(out).toEqual(p);
  });

  it('SWARMIT_OTA_CHUNK_ACK (index u32)', () => {
    const p: SwarmitPayload = { type: SwarmitPayloadType.SWARMIT_OTA_CHUNK_ACK, index: 42 };
    expect(encodeSwarmitPayload(p).length).toBe(1 + 4);
    expect(roundtrip(p)).toEqual(p);
  });

  it('SWARMIT_EVENT_LOG (timestamp u32 + count u8 + data[count])', () => {
    const data = new TextEncoder().encode('hello log');
    const p: SwarmitPayload = {
      type: SwarmitPayloadType.SWARMIT_EVENT_LOG,
      timestamp: 123456,
      data,
    };
    expect(roundtrip(p)).toEqual(p);
  });

  it('SWARMIT_MESSAGE (count u8 + message[count])', () => {
    const message = new TextEncoder().encode('oi robô');
    const p: SwarmitPayload = { type: SwarmitPayloadType.SWARMIT_MESSAGE, message };
    expect(roundtrip(p)).toEqual(p);
  });

  it('SWARMIT_LH2_CALIBRATION (u32 + u32 + homography[36])', () => {
    const homography = new Uint8Array(SWARMIT_LH2_HOMOGRAPHY_SIZE).map((_, i) => i);
    const p: SwarmitPayload = {
      type: SwarmitPayloadType.SWARMIT_LH2_CALIBRATION,
      homography_count: 2,
      homography_index: 1,
      homography,
    };
    expect(encodeSwarmitPayload(p).length).toBe(1 + 4 + 4 + SWARMIT_LH2_HOMOGRAPHY_SIZE);
    expect(roundtrip(p)).toEqual(p);
  });

  it('chunk > 255 bytes é rejeitado (count é u8)', () => {
    const p: SwarmitPayload = {
      type: SwarmitPayloadType.SWARMIT_OTA_CHUNK,
      index: 0,
      sha: new Uint8Array(SWARMIT_OTA_SHA_SIZE),
      chunk: new Uint8Array(256),
    };
    expect(() => encodeSwarmitPayload(p)).toThrow();
  });

  it('payload_type não suportado (ex.: 0x88 EVENT_GPIO) lança erro', () => {
    expect(() => decodeSwarmitPayload(new Uint8Array([0x88]))).toThrow();
  });

  it('packet vazio lança erro', () => {
    expect(() => decodeSwarmitPayload(new Uint8Array([]))).toThrow();
  });
});
