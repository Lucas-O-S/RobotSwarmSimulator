// Fase 4 — codec dos payloads DotBot.
//
// Os vetores "golden" (hex) foram gerados executando as bibliotecas Python
// REAIS do ecossistema (Packet.from_payload(...).to_bytes()):
//   pydotbot-utils 0.3.0 (dotbot_utils/protocol.py) +
//   PyDotBot 0.29.1 (dotbot/protocol.py), ambos do PyPI.
// Se estes testes passam, os bytes batem com o que o PyDotBot produz/consome.

import { describe, expect, it } from 'vitest';

import { ApplicationType, ControlModeType } from '../../core/types';
import {
  decodeDotBotPayload,
  DotBotPayload,
  encodeDotBotPayload,
  PayloadType,
} from '../dotbot';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe('protocol/dotbot — vetores golden (bytes do PyDotBot real)', () => {
  const vectors: Array<{ name: string; payload: DotBotPayload; goldenHex: string }> = [
    {
      name: 'ADVERTISEMENT',
      payload: { type: PayloadType.ADVERTISEMENT, application: ApplicationType.DotBot },
      goldenHex: '0400',
    },
    {
      name: 'CMD_MOVE_RAW (com int8 negativo)',
      payload: { type: PayloadType.CMD_MOVE_RAW, left_x: 0, left_y: -100, right_x: 0, right_y: 100 },
      goldenHex: '00009c0064',
    },
    {
      name: 'CMD_RGB_LED',
      payload: { type: PayloadType.CMD_RGB_LED, red: 255, green: 0, blue: 16 },
      goldenHex: '01ff0010',
    },
    {
      name: 'CONTROL_MODE',
      payload: { type: PayloadType.CONTROL_MODE, mode: ControlModeType.Auto },
      goldenHex: '0701',
    },
    {
      name: 'DOTBOT_ADVERTISEMENT',
      payload: {
        type: PayloadType.DOTBOT_ADVERTISEMENT,
        calibrated: 0x01,
        direction: -90,
        pos_x: 1500,
        pos_y: 300,
        battery: 4100,
        pwm_left: -50,
        pwm_right: 100,
        mode: ControlModeType.Auto,
        encoder_left: -12345,
        encoder_right: 67890,
        waypoint_x: 1500,
        waypoint_y: 1700,
        waypoint_idx: 2,
      },
      goldenHex:
        '0601a6ffdc0500002c0100000410ce6401c7cfffff32090100dc050000a406000002',
    },
    {
      name: 'LH2_WAYPOINTS',
      payload: {
        type: PayloadType.LH2_WAYPOINTS,
        threshold: 50,
        waypoints: [
          { pos_x: 1500, pos_y: 300 },
          { pos_x: 1500, pos_y: 1700 },
        ],
      },
      goldenHex: '08320002dc0500002c010000dc050000a4060000',
    },
    {
      name: 'DOTBOT_SIMULATOR_DATA',
      payload: { type: PayloadType.DOTBOT_SIMULATOR_DATA, theta: 90, pos_x: 250, pos_y: 730 },
      goldenHex: 'fa5a00fa000000da020000',
    },
  ];

  for (const { name, payload, goldenHex } of vectors) {
    it(`${name}: encode bate byte a byte com o PyDotBot`, () => {
      expect(hex(encodeDotBotPayload(payload))).toBe(goldenHex);
    });

    it(`${name}: round-trip encode→decode devolve o mesmo objeto`, () => {
      expect(decodeDotBotPayload(encodeDotBotPayload(payload))).toEqual(payload);
    });

    it(`${name}: decode dos bytes golden devolve o objeto`, () => {
      expect(decodeDotBotPayload(fromHex(goldenHex))).toEqual(payload);
    });
  }
});

describe('protocol/dotbot — tamanhos e offsets', () => {
  it('DOTBOT_ADVERTISEMENT tem 34 bytes (1 de tipo + 33 de campos)', () => {
    const bytes = encodeDotBotPayload({
      type: PayloadType.DOTBOT_ADVERTISEMENT,
      calibrated: 0,
      direction: 0,
      pos_x: 0,
      pos_y: 0,
      battery: 0,
      pwm_left: 0,
      pwm_right: 0,
      mode: ControlModeType.Manual,
      encoder_left: 0,
      encoder_right: 0,
      waypoint_x: 0,
      waypoint_y: 0,
      waypoint_idx: 0,
    });
    expect(bytes.length).toBe(34);
    expect(bytes[0]).toBe(0x06);
  });

  it('pos_x/pos_y são u32 LE de 4 bytes nos offsets 4..7 / 8..11', () => {
    const bytes = encodeDotBotPayload({
      type: PayloadType.DOTBOT_ADVERTISEMENT,
      calibrated: 0,
      direction: 0,
      pos_x: 0x11223344,
      pos_y: 0xdeadbeef,
      battery: 0,
      pwm_left: 0,
      pwm_right: 0,
      mode: ControlModeType.Manual,
      encoder_left: 0,
      encoder_right: 0,
      waypoint_x: 0,
      waypoint_y: 0,
      waypoint_idx: 0,
    });
    // [0]=tipo, [1]=calibrated, [2..3]=direction → pos_x começa no offset 4
    expect(Array.from(bytes.slice(4, 8))).toEqual([0x44, 0x33, 0x22, 0x11]);
    expect(Array.from(bytes.slice(8, 12))).toEqual([0xef, 0xbe, 0xad, 0xde]);
  });

  it('direction é i16 LE com sinal nos offsets 2..3 (-90 → a6 ff)', () => {
    const bytes = encodeDotBotPayload({
      type: PayloadType.DOTBOT_ADVERTISEMENT,
      calibrated: 0,
      direction: -90,
      pos_x: 0,
      pos_y: 0,
      battery: 0,
      pwm_left: 0,
      pwm_right: 0,
      mode: ControlModeType.Manual,
      encoder_left: 0,
      encoder_right: 0,
      waypoint_x: 0,
      waypoint_y: 0,
      waypoint_idx: 0,
    });
    expect(Array.from(bytes.slice(2, 4))).toEqual([0xa6, 0xff]);
  });

  it('CMD_MOVE_RAW tem 5 bytes; CMD_RGB_LED 4; ADVERTISEMENT 2; CONTROL_MODE 2', () => {
    expect(
      encodeDotBotPayload({ type: PayloadType.CMD_MOVE_RAW, left_x: 0, left_y: 0, right_x: 0, right_y: 0 }).length,
    ).toBe(5);
    expect(encodeDotBotPayload({ type: PayloadType.CMD_RGB_LED, red: 0, green: 0, blue: 0 }).length).toBe(4);
    expect(
      encodeDotBotPayload({ type: PayloadType.ADVERTISEMENT, application: ApplicationType.DotBot }).length,
    ).toBe(2);
    expect(encodeDotBotPayload({ type: PayloadType.CONTROL_MODE, mode: ControlModeType.Manual }).length).toBe(2);
  });

  it('LH2_WAYPOINTS = 4 bytes fixos + 8 por waypoint; count derivado da lista', () => {
    const enc = (n: number) =>
      encodeDotBotPayload({
        type: PayloadType.LH2_WAYPOINTS,
        threshold: 50,
        waypoints: Array.from({ length: n }, (_, i) => ({ pos_x: i, pos_y: i })),
      });
    expect(enc(0).length).toBe(4);
    expect(enc(3).length).toBe(4 + 3 * 8);
    expect(enc(3)[3]).toBe(3); // count no offset 3 (tipo + threshold u16)
  });
});

describe('protocol/dotbot — int8 com sinal (CMD_MOVE_RAW)', () => {
  it('round-trip dos extremos -128..127', () => {
    const payload: DotBotPayload = {
      type: PayloadType.CMD_MOVE_RAW,
      left_x: -128,
      left_y: 127,
      right_x: -1,
      right_y: 1,
    };
    const bytes = encodeDotBotPayload(payload);
    expect(Array.from(bytes)).toEqual([0x00, 0x80, 0x7f, 0xff, 0x01]);
    expect(decodeDotBotPayload(bytes)).toEqual(payload);
  });

  it('byte 0x9c decodifica como -100 (complemento de dois), não 156', () => {
    const decoded = decodeDotBotPayload(fromHex('00009c0064'));
    expect(decoded).toEqual({
      type: PayloadType.CMD_MOVE_RAW,
      left_x: 0,
      left_y: -100,
      right_x: 0,
      right_y: 100,
    });
  });

  it('rejeita valores fora de i8 (>127 ou <-128), igual ao int.to_bytes(signed=True)', () => {
    const base = { type: PayloadType.CMD_MOVE_RAW as const, left_x: 0, left_y: 0, right_x: 0, right_y: 0 };
    expect(() => encodeDotBotPayload({ ...base, left_x: 200 })).toThrow(RangeError);
    expect(() => encodeDotBotPayload({ ...base, right_y: -129 })).toThrow(RangeError);
  });
});

describe('protocol/dotbot — erros', () => {
  it('decode de tipo desconhecido lança erro claro', () => {
    expect(() => decodeDotBotPayload(fromHex('ff0102'))).toThrow(/não suportado/);
  });

  it('decode de payload truncado lança erro', () => {
    expect(() => decodeDotBotPayload(fromHex('0601'))).toThrow(/truncado/);
    expect(() => decodeDotBotPayload(new Uint8Array(0))).toThrow(/vazio/);
  });

  it('decode funciona em Uint8Array com byteOffset != 0 (subarray de buffer maior)', () => {
    const golden = fromHex('00009c0064');
    const buf = new Uint8Array(3 + golden.length);
    buf.set(golden, 3);
    const view = buf.subarray(3); // byteOffset = 3 no mesmo ArrayBuffer
    expect(decodeDotBotPayload(view)).toEqual({
      type: PayloadType.CMD_MOVE_RAW,
      left_x: 0,
      left_y: -100,
      right_x: 0,
      right_y: 100,
    });
  });
});
