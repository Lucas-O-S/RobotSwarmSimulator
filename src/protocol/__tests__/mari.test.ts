// Fase 4 — codec do frame Mari (protocolo v3, marilib-pkg 0.9.0).
//
// O vetor golden foi gerado executando o marilib REAL
// (marilib-pkg 0.9.0 do PyPI, o que o PyDotBot 0.29.1 pina):
//   Frame(Header(network_id=0x1200, destination=0xBDF2B04BC00D2725,
//                source=0x1, next_proto=NextProto.DOTBOT_APP),
//         payload=<CMD_MOVE_RAW 00009c0064>).to_bytes().hex()
//   == '0310001225270dc04bb0f2bd01000000000000001100009c0064'
//
// NOTA: no protocolo v3 NÃO existe byte de rssi no frame (o HeaderStats do
// v2 foi removido; rssi agora só aparece dentro do payload METRICS_PROBE).

import { describe, expect, it } from 'vitest';

import {
  addressFromHex,
  addressToHex,
  decodeMariFrame,
  decodeMariHeader,
  encodeMariFrame,
  encodeMariHeader,
  makeMariHeader,
  MARI_BROADCAST_ADDRESS,
  MARI_HEADER_SIZE,
  MARI_PROTOCOL_VERSION,
  MariFrame,
  MariPacketType,
  EdgeEvent,
  NextProto,
} from '../mari';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const GOLDEN_FRAME_HEX = '0310001225270dc04bb0f2bd01000000000000001100009c0064';

function goldenFrame(): MariFrame {
  return {
    header: makeMariHeader({
      network_id: 0x1200,
      destination: addressFromHex('BDF2B04BC00D2725'),
      source: 1n,
      next_proto: NextProto.DOTBOT_APP,
    }),
    payload: fromHex('00009c0064'), // CMD_MOVE_RAW
  };
}

describe('protocol/mari — vetor golden (bytes do marilib real)', () => {
  it('encode bate byte a byte com o marilib-pkg 0.9.0', () => {
    expect(hex(encodeMariFrame(goldenFrame()))).toBe(GOLDEN_FRAME_HEX);
  });

  it('decode dos bytes golden devolve header + payload', () => {
    const frame = decodeMariFrame(fromHex(GOLDEN_FRAME_HEX));
    expect(frame.header.version).toBe(3);
    expect(frame.header.type_).toBe(MariPacketType.DATA);
    expect(frame.header.network_id).toBe(0x1200);
    expect(addressToHex(frame.header.destination)).toBe('BDF2B04BC00D2725');
    expect(frame.header.source).toBe(1n);
    expect(frame.header.next_proto).toBe(NextProto.DOTBOT_APP);
    expect(hex(frame.payload)).toBe('00009c0064');
  });

  it('round-trip encode→decode devolve o mesmo frame', () => {
    const frame = goldenFrame();
    expect(decodeMariFrame(encodeMariFrame(frame))).toEqual(frame);
  });

  it('round-trip com payload vazio (frame só de header, 21 bytes)', () => {
    const frame: MariFrame = { header: makeMariHeader(), payload: new Uint8Array(0) };
    const bytes = encodeMariFrame(frame);
    expect(bytes.length).toBe(MARI_HEADER_SIZE);
    expect(decodeMariFrame(bytes)).toEqual(frame);
  });
});

describe('protocol/mari — layout do header (21 B, little-endian)', () => {
  it('header tem exatamente 21 bytes com next_proto no offset 20', () => {
    const bytes = encodeMariHeader(makeMariHeader({ next_proto: NextProto.SWARMIT_TESTBED }));
    expect(bytes.length).toBe(21);
    expect(MARI_HEADER_SIZE).toBe(21);
    expect(bytes[20]).toBe(0x10); // SWARMIT_TESTBED
  });

  it('network_id=0x1200 serializa como [0x00, 0x12] (LE) nos offsets 2..3', () => {
    const bytes = encodeMariHeader(makeMariHeader({ network_id: 0x1200 }));
    expect(bytes[2]).toBe(0x00);
    expect(bytes[3]).toBe(0x12);
  });

  it('destination u64 LE: byte menos significativo primeiro (offset 4)', () => {
    const bytes = encodeMariHeader(
      makeMariHeader({ destination: addressFromHex('BDF2B04BC00D2725') }),
    );
    expect(Array.from(bytes.slice(4, 12))).toEqual([
      0x25, 0x27, 0x0d, 0xc0, 0x4b, 0xb0, 0xf2, 0xbd,
    ]);
  });

  it('broadcast address = 0xFFFFFFFFFFFFFFFF vira 8 bytes 0xff', () => {
    const bytes = encodeMariHeader(makeMariHeader({ destination: MARI_BROADCAST_ADDRESS }));
    expect(Array.from(bytes.slice(4, 12))).toEqual(Array(8).fill(0xff));
  });

  it('defaults do makeMariHeader espelham o Header() do marilib', () => {
    const h = makeMariHeader();
    expect(h.version).toBe(MARI_PROTOCOL_VERSION);
    expect(MARI_PROTOCOL_VERSION).toBe(3);
    expect(h.type_).toBe(MariPacketType.DATA);
    expect(h.network_id).toBe(0x0001);
    expect(h.destination).toBe(MARI_BROADCAST_ADDRESS);
    expect(h.source).toBe(0n);
    expect(h.next_proto).toBe(NextProto.MARI_INTERNAL);
  });

  it('decode com offset e em subarray (byteOffset != 0) funciona', () => {
    const golden = fromHex(GOLDEN_FRAME_HEX);
    const buf = new Uint8Array(5 + golden.length);
    buf.set(golden, 5);
    const header = decodeMariHeader(buf.subarray(5));
    expect(header.network_id).toBe(0x1200);
    const header2 = decodeMariHeader(buf, 5);
    expect(header2).toEqual(header);
  });

  it('header truncado lança erro', () => {
    expect(() => decodeMariHeader(new Uint8Array(20))).toThrow(/21 bytes/);
  });
});

describe('protocol/mari — enums do contrato', () => {
  it('EdgeEvent tem os valores do marilib/model.py', () => {
    expect(EdgeEvent.NODE_JOINED).toBe(1);
    expect(EdgeEvent.NODE_LEFT).toBe(2);
    expect(EdgeEvent.NODE_DATA).toBe(3);
    expect(EdgeEvent.NODE_KEEP_ALIVE).toBe(4);
    expect(EdgeEvent.GATEWAY_INFO).toBe(5);
    expect(EdgeEvent.UNKNOWN).toBe(255);
  });

  it('NextProto tem os valores do mari_protocol.py (v3)', () => {
    expect(NextProto.RESERVED).toBe(0x00);
    expect(NextProto.MARI_INTERNAL).toBe(0x01);
    expect(NextProto.SWARMIT_TESTBED).toBe(0x10);
    expect(NextProto.DOTBOT_APP).toBe(0x11);
    expect(NextProto.UNKNOWN).toBe(0xff);
  });
});

describe('protocol/mari — addresses hex', () => {
  it('addressFromHex/addressToHex round-trip com 16 chars maiúsculos', () => {
    expect(addressToHex(addressFromHex('bdf2b04bc00d2725'))).toBe('BDF2B04BC00D2725');
    expect(addressToHex(1n)).toBe('0000000000000001');
    expect(addressToHex(MARI_BROADCAST_ADDRESS)).toBe('FFFFFFFFFFFFFFFF');
  });

  it('rejeita hex inválido', () => {
    expect(() => addressFromHex('xyz')).toThrow();
    expect(() => addressFromHex('')).toThrow();
    expect(() => addressFromHex('0'.repeat(17))).toThrow();
  });
});
