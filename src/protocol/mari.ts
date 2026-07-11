// Fase 4 — Camada Mari (rede do gateway): frame binário + enums.
//
// FONTE AUTORITATIVA (layouts confirmados byte a byte em 2026-07-10):
//   marilib-pkg 0.9.0 (PyPI) — arquivos marilib/mari_protocol.py,
//   marilib/protocol.py e marilib/model.py. É a versão que o PyDotBot
//   0.29.1 pina em pyproject.toml ("marilib-pkg >= 0.9.0") e a que o
//   swarmit usa — logo é o que o backend (cloud) vai falar.
//
//   ⚠️ O GitHub DotBots/marilib@main ainda mostra o protocolo VERSÃO 2
//   (header de 20 B sem next_proto + 1 B de rssi/HeaderStats no uplink,
//   como descrevia o PLANO §4.1 original). A versão 3 (marilib-pkg 0.9.0)
//   moveu o demux pra dentro do header (next_proto, 1 B no fim) e REMOVEU
//   o byte de rssi do frame — rssi agora só existe dentro do payload de
//   métricas (METRICS_PROBE). Implementamos a v3 (a realidade do wire).
//
// ENDIANNESS: todos os inteiros multi-byte são LITTLE-ENDIAN
// (marilib/protocol.py, Packet.from_bytes/to_bytes: byteorder="little").
//
// Layout do header (21 bytes, offsets):
//   [0]      version     u8   = 3 (MARI_PROTOCOL_VERSION)
//   [1]      type_       u8   (MariPacketType; DATA=16)
//   [2..3]   network_id  u16  LE
//   [4..11]  destination u64  LE
//   [12..19] source      u64  LE
//   [20]     next_proto  u8   (NextProto)
// Frame = header (21 B) + payload (bytes crus da camada de cima).

export const MARI_PROTOCOL_VERSION = 3;
export const MARI_NET_ID_DEFAULT = 0x0001;
export const MARI_BROADCAST_ADDRESS = 0xffffffffffffffffn;
export const MARI_HEADER_SIZE = 21;

/** Tipos de pacote MAC (marilib/protocol.py, PacketType). */
export enum MariPacketType {
  BEACON = 1,
  JOIN_REQUEST = 2,
  JOIN_RESPONSE = 4,
  KEEP_ALIVE = 8,
  DATA = 16,
}

/**
 * Demux de protocolo superior dentro de frames DATA
 * (marilib-pkg 0.9.0, mari_protocol.py, NextProto — espelha
 * mr_next_proto_t do firmware mari).
 */
export enum NextProto {
  RESERVED = 0x00,
  MARI_INTERNAL = 0x01,
  SWARMIT_TESTBED = 0x10, // orquestração swarmit (Fase 7)
  DOTBOT_APP = 0x11, // aplicação DotBot (PyDotBot)
  IPV4 = 0xa0,
  IPV6 = 0xa1,
  EXPERIMENTAL = 0xfe,
  UNKNOWN = 0xff,
}

/**
 * Primeiro byte de cada mensagem no wire do gateway
 * (marilib-pkg 0.9.0, model.py, EdgeEvent).
 */
export enum EdgeEvent {
  NODE_JOINED = 1,
  NODE_LEFT = 2,
  NODE_DATA = 3,
  NODE_KEEP_ALIVE = 4,
  GATEWAY_INFO = 5,
  UNKNOWN = 255,
}

export interface MariHeader {
  version: number; // u8
  type_: MariPacketType; // u8
  network_id: number; // u16 LE
  destination: bigint; // u64 LE (endereço de 8 bytes)
  source: bigint; // u64 LE
  next_proto: NextProto; // u8
}

export interface MariFrame {
  header: MariHeader;
  payload: Uint8Array;
}

const U64_MAX = 0xffffffffffffffffn;

function checkU8(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 0xff) {
    throw new RangeError(`${name} fora de u8: ${v}`);
  }
}

function checkU16(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) {
    throw new RangeError(`${name} fora de u16: ${v}`);
  }
}

function checkU64(name: string, v: bigint): void {
  if (v < 0n || v > U64_MAX) {
    throw new RangeError(`${name} fora de u64: ${v}`);
  }
}

/** Converte address hex (até 16 chars, ex.: "BDF2B04BC00D2725") em u64. */
export function addressFromHex(hex: string): bigint {
  if (!/^[0-9a-fA-F]{1,16}$/.test(hex)) {
    throw new Error(`address hex inválido: "${hex}"`);
  }
  return BigInt(`0x${hex}`);
}

/** Converte address u64 em hex de 16 chars maiúsculos (formato do backend). */
export function addressToHex(addr: bigint): string {
  checkU64('address', addr);
  return addr.toString(16).toUpperCase().padStart(16, '0');
}

/** Cria um header com os defaults do marilib (Header() do mari_protocol.py). */
export function makeMariHeader(overrides: Partial<MariHeader> = {}): MariHeader {
  return {
    version: MARI_PROTOCOL_VERSION,
    type_: MariPacketType.DATA,
    network_id: MARI_NET_ID_DEFAULT,
    destination: MARI_BROADCAST_ADDRESS,
    source: 0n,
    next_proto: NextProto.MARI_INTERNAL,
    ...overrides,
  };
}

export function encodeMariHeader(h: MariHeader): Uint8Array {
  checkU8('version', h.version);
  checkU8('type_', h.type_);
  checkU16('network_id', h.network_id);
  checkU64('destination', h.destination);
  checkU64('source', h.source);
  checkU8('next_proto', h.next_proto);
  const out = new Uint8Array(MARI_HEADER_SIZE);
  const view = new DataView(out.buffer);
  view.setUint8(0, h.version);
  view.setUint8(1, h.type_);
  view.setUint16(2, h.network_id, true); // little-endian
  view.setBigUint64(4, h.destination, true);
  view.setBigUint64(12, h.source, true);
  view.setUint8(20, h.next_proto);
  return out;
}

export function decodeMariHeader(bytes: Uint8Array, offset = 0): MariHeader {
  if (bytes.length - offset < MARI_HEADER_SIZE) {
    throw new Error(
      `header Mari precisa de ${MARI_HEADER_SIZE} bytes, recebi ${bytes.length - offset}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, MARI_HEADER_SIZE);
  return {
    version: view.getUint8(0),
    type_: view.getUint8(1),
    network_id: view.getUint16(2, true),
    destination: view.getBigUint64(4, true),
    source: view.getBigUint64(12, true),
    next_proto: view.getUint8(20),
  };
}

/** Frame Mari = header (21 B) + payload cru (mari_protocol.py, Frame). */
export function encodeMariFrame(frame: MariFrame): Uint8Array {
  const header = encodeMariHeader(frame.header);
  const out = new Uint8Array(header.length + frame.payload.length);
  out.set(header, 0);
  out.set(frame.payload, header.length);
  return out;
}

export function decodeMariFrame(bytes: Uint8Array): MariFrame {
  const header = decodeMariHeader(bytes);
  return { header, payload: bytes.slice(MARI_HEADER_SIZE) };
}
