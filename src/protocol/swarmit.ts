// Fase 7 — Peça 2: payloads da orquestração swarmit (o que viaja dentro de
// frames Mari NODE_DATA com next_proto=SWARMIT_TESTBED = 0x10).
//
// FONTE AUTORITATIVA (layouts confirmados byte a byte em 2026-07-13):
//   repo DotBots/swarmit, arquivo swarmit/testbed/protocol.py
//   https://raw.githubusercontent.com/DotBots/swarmit/main/swarmit/testbed/protocol.py
//   (PayloadType 0x80–0xA2, StatusType, DeviceType e os campos/tamanhos de
//   cada dataclass Payload — ver cada encoder abaixo.)
//
// SERIALIZAÇÃO: a mesma do dotbot.ts — o swarmit usa o MESMO
// dotbot_utils.protocol (Payload/Packet/register_parser) do PyDotBot:
//   packet = [1 B payload_type] + campos na ordem do metadata,
//   inteiros LITTLE-ENDIAN; campos `bytes` com length fixa ocupam a length;
//   campos `bytes` variáveis (length=0 no metadata) são precedidos por um
//   `count` u8 com o tamanho (mesma convenção do LH2_WAYPOINTS da Fase 4).
//
// ENDIANNESS: todos os inteiros multi-byte são LITTLE-ENDIAN
// (dotbot_utils/protocol.py, byteorder="little").
//
// PAPÉIS (fronteira decidida no projeto): o BACKEND é o control plane que
// ORQUESTRA (envia STATUS/START/STOP/RESET/OTA_*/MESSAGE descendo); o
// robô/gateway (o que o simulador emula) é o RESPONDEDOR — devolve
// OTA_START_ACK/OTA_CHUNK_ACK, heartbeat SWARMIT_STATUS e eventos de log.
// Este arquivo é só o codec (puro, sem I/O); a máquina de estados do lado
// dispositivo vive em src/net/swarmitDevice.ts.

/** Tipos de payload swarmit (swarmit/testbed/protocol.py, PayloadType).
 *  0x80–0x89 = requests/acks; 0xA0–0xA2 = mensagens custom/calibração.
 *  (METRICS_PROBE do marilib fica fora — não é 0x80–0xA2.) */
export enum SwarmitPayloadType {
  SWARMIT_STATUS = 0x80,
  SWARMIT_START = 0x81,
  SWARMIT_STOP = 0x82,
  SWARMIT_RESET = 0x83,
  SWARMIT_OTA_START = 0x84,
  SWARMIT_OTA_CHUNK = 0x85,
  SWARMIT_OTA_START_ACK = 0x86,
  SWARMIT_OTA_CHUNK_ACK = 0x87,
  SWARMIT_EVENT_GPIO = 0x88,
  SWARMIT_EVENT_LOG = 0x89,
  SWARMIT_MESSAGE = 0xa0,
  SWARMIT_LH2_CALIBRATION = 0xa1,
  SWARMIT_LH2_CAPTURE = 0xa2,
}

/** Estados do dispositivo (protocol.py, StatusType). */
export enum SwarmitStatusType {
  Bootloader = 0,
  Running = 1,
  Stopping = 2,
  Resetting = 3,
  Programming = 4,
}

/** Tipos de dispositivo (protocol.py, DeviceType). */
export enum SwarmitDeviceType {
  Unknown = 0,
  DotBotV3 = 1,
  DotBotV2 = 2,
  nRF5340DK = 3,
  nRF52840DK = 4,
}

/** Primeiro byte de um sample de captura LH2 crua dentro de um
 *  SWARMIT_EVENT_LOG (protocol.py, LH2_CALIB_TAG — espelha
 *  SWRMT_LH2_CALIB_TAG do bootloader). */
export const LH2_CALIB_TAG = 0xca;

/** Tamanho de chunk usado pelo fluxo de flash do swarmit (PLANO §4.7:
 *  chunks de 128 B com ACK por índice). Informativo — o codec aceita
 *  qualquer chunk de até 255 B (count é u8). */
export const SWARMIT_OTA_CHUNK_MAX_SIZE = 128;

// ---------------------------------------------------------------------------
// Tipos TS dos payloads (união discriminada por `type`).
// ---------------------------------------------------------------------------

/** SWARMIT_STATUS 0x80 — descendo é REQUEST (o backend pede status);
 *  subindo é o heartbeat de status do dispositivo.
 *  PayloadStatus: device u8 + status u8 + battery u16 + pos_x i32 (signed)
 *  + pos_y i32 (signed) = 12 B de campos. */
export interface SwarmitStatusPayload {
  type: SwarmitPayloadType.SWARMIT_STATUS;
  device: SwarmitDeviceType; // u8
  status: SwarmitStatusType; // u8
  battery: number; // u16
  pos_x: number; // i32 (signed=True no metadata)
  pos_y: number; // i32 (signed=True no metadata)
}

/** SWARMIT_START 0x81 — PayloadStart (vazio). */
export interface SwarmitStartPayload {
  type: SwarmitPayloadType.SWARMIT_START;
}

/** SWARMIT_STOP 0x82 — PayloadStop (vazio). */
export interface SwarmitStopPayload {
  type: SwarmitPayloadType.SWARMIT_STOP;
}

/** SWARMIT_RESET 0x83 — PayloadReset: pos_x u32 + pos_y u32 (SEM signed
 *  no metadata, diferente do STATUS). */
export interface SwarmitResetPayload {
  type: SwarmitPayloadType.SWARMIT_RESET;
  pos_x: number; // u32
  pos_y: number; // u32
}

/** SWARMIT_OTA_START 0x84 — PayloadOTAStart: fw_length u32 +
 *  fw_chunk_count u32. (Nota: NÃO carrega SHA — o SHA de 8 B vai por
 *  CHUNK, ver SwarmitOtaChunkPayload; o PLANO §4.7 original dizia
 *  "OTA_START (SHA-256…)", corrigido.) */
export interface SwarmitOtaStartPayload {
  type: SwarmitPayloadType.SWARMIT_OTA_START;
  fw_length: number; // u32
  fw_chunk_count: number; // u32
}

/** SWARMIT_OTA_CHUNK 0x85 — PayloadOTAChunk: index u32 + count u8 +
 *  sha bytes[8] + chunk bytes[count] (variável). `count` = chunk.length
 *  (derivado no encode, como o `count` do LH2_WAYPOINTS). */
export interface SwarmitOtaChunkPayload {
  type: SwarmitPayloadType.SWARMIT_OTA_CHUNK;
  index: number; // u32
  sha: Uint8Array; // 8 B (prefixo do SHA-256 do fw)
  chunk: Uint8Array; // até 255 B (count é u8); swarmit usa 128 B
}

/** SWARMIT_OTA_START_ACK 0x86 — PayloadOTAStartAck (vazio). */
export interface SwarmitOtaStartAckPayload {
  type: SwarmitPayloadType.SWARMIT_OTA_START_ACK;
}

/** SWARMIT_OTA_CHUNK_ACK 0x87 — PayloadOTAChunkAck: index u32
 *  (o ACK por índice do ARQ pare-e-espere). */
export interface SwarmitOtaChunkAckPayload {
  type: SwarmitPayloadType.SWARMIT_OTA_CHUNK_ACK;
  index: number; // u32
}

/** SWARMIT_EVENT_LOG 0x89 — PayloadEvent: timestamp u32 + count u8 +
 *  data bytes[count]. (0x88 EVENT_GPIO existe no enum mas o protocol.py
 *  NÃO registra parser pra ele — aqui também fica sem codec.) */
export interface SwarmitEventPayload {
  type: SwarmitPayloadType.SWARMIT_EVENT_LOG;
  timestamp: number; // u32
  data: Uint8Array; // até 255 B (count é u8)
}

/** SWARMIT_MESSAGE 0xA0 — PayloadMessage: count u8 + message bytes[count]. */
export interface SwarmitMessagePayload {
  type: SwarmitPayloadType.SWARMIT_MESSAGE;
  message: Uint8Array; // até 255 B (count é u8)
}

/** SWARMIT_LH2_CALIBRATION 0xA1 — PayloadCalibrationData:
 *  homography_count u32 + homography_index u32 + homography bytes[36]
 *  (matriz 3×3 de floats de 4 B, crua). */
export interface SwarmitLh2CalibrationPayload {
  type: SwarmitPayloadType.SWARMIT_LH2_CALIBRATION;
  homography_count: number; // u32
  homography_index: number; // u32
  homography: Uint8Array; // 36 B fixos (3*3*4)
}

/** SWARMIT_LH2_CAPTURE 0xA2 — PayloadLH2Capture (vazio; host→node,
 *  dispara uma captura LH2 crua em modo READY). */
export interface SwarmitLh2CapturePayload {
  type: SwarmitPayloadType.SWARMIT_LH2_CAPTURE;
}

export type SwarmitPayload =
  | SwarmitStatusPayload
  | SwarmitStartPayload
  | SwarmitStopPayload
  | SwarmitResetPayload
  | SwarmitOtaStartPayload
  | SwarmitOtaChunkPayload
  | SwarmitOtaStartAckPayload
  | SwarmitOtaChunkAckPayload
  | SwarmitEventPayload
  | SwarmitMessagePayload
  | SwarmitLh2CalibrationPayload
  | SwarmitLh2CapturePayload;

export const SWARMIT_LH2_HOMOGRAPHY_SIZE = 3 * 3 * 4; // 36 B
export const SWARMIT_OTA_SHA_SIZE = 8;

// ---------------------------------------------------------------------------
// Helpers de (de)serialização little-endian (mesmo estilo do dotbot.ts,
// com suporte a campos bytes).
// ---------------------------------------------------------------------------

class Writer {
  private view: DataView;
  private pos = 0;
  readonly buf: Uint8Array;

  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  u8(name: string, v: number): void {
    this.check(name, v, 0, 0xff);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }

  u16(name: string, v: number): void {
    this.check(name, v, 0, 0xffff);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  u32(name: string, v: number): void {
    this.check(name, v, 0, 0xffffffff);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }

  i32(name: string, v: number): void {
    this.check(name, v, -0x80000000, 0x7fffffff);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
  }

  bytes(name: string, v: Uint8Array, fixedLen?: number): void {
    if (fixedLen !== undefined && v.length !== fixedLen) {
      throw new RangeError(`${name} deve ter ${fixedLen} bytes, tem ${v.length}`);
    }
    this.buf.set(v, this.pos);
    this.pos += v.length;
  }

  private check(name: string, v: number, min: number, max: number): void {
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new RangeError(`${name}=${v} fora da faixa [${min}, ${max}]`);
    }
  }
}

class Reader {
  private view: DataView;
  private pos: number;

  constructor(
    private data: Uint8Array,
    start: number,
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = start;
  }

  private need(n: number): void {
    if (this.pos + n > this.data.length) {
      throw new Error(
        `payload swarmit truncado: precisava de ${n} bytes no offset ${this.pos}, tenho ${this.data.length}`,
      );
    }
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

function checkVarBytes(name: string, v: Uint8Array): void {
  if (v.length > 0xff) {
    throw new RangeError(`${name}: no máximo 255 bytes (count é u8; tenho ${v.length})`);
  }
}

// ---------------------------------------------------------------------------
// encode / decode
// ---------------------------------------------------------------------------

/** Serializa um payload swarmit como o Packet do dotbot_utils:
 *  `[1 B payload_type] + campos little-endian` — os mesmos bytes que
 *  `Packet.from_payload(payload).to_bytes()` produz no swarmit (Python). */
export function encodeSwarmitPayload(payload: SwarmitPayload): Uint8Array {
  switch (payload.type) {
    case SwarmitPayloadType.SWARMIT_STATUS: {
      const w = new Writer(1 + 12);
      w.u8('payload_type', payload.type);
      w.u8('device', payload.device);
      w.u8('status', payload.status);
      w.u16('battery', payload.battery);
      w.i32('pos_x', payload.pos_x);
      w.i32('pos_y', payload.pos_y);
      return w.buf;
    }
    case SwarmitPayloadType.SWARMIT_START:
    case SwarmitPayloadType.SWARMIT_STOP:
    case SwarmitPayloadType.SWARMIT_OTA_START_ACK:
    case SwarmitPayloadType.SWARMIT_LH2_CAPTURE: {
      // payloads vazios: só o payload_type (PayloadEmpty no protocol.py)
      const w = new Writer(1);
      w.u8('payload_type', payload.type);
      return w.buf;
    }
    case SwarmitPayloadType.SWARMIT_RESET: {
      const w = new Writer(1 + 8);
      w.u8('payload_type', payload.type);
      w.u32('pos_x', payload.pos_x);
      w.u32('pos_y', payload.pos_y);
      return w.buf;
    }
    case SwarmitPayloadType.SWARMIT_OTA_START: {
      const w = new Writer(1 + 8);
      w.u8('payload_type', payload.type);
      w.u32('fw_length', payload.fw_length);
      w.u32('fw_chunk_count', payload.fw_chunk_count);
      return w.buf;
    }
    case SwarmitPayloadType.SWARMIT_OTA_CHUNK: {
      checkVarBytes('chunk', payload.chunk);
      const w = new Writer(1 + 4 + 1 + SWARMIT_OTA_SHA_SIZE + payload.chunk.length);
      w.u8('payload_type', payload.type);
      w.u32('index', payload.index);
      w.u8('count', payload.chunk.length);
      w.bytes('sha', payload.sha, SWARMIT_OTA_SHA_SIZE);
      w.bytes('chunk', payload.chunk);
      return w.buf;
    }
    case SwarmitPayloadType.SWARMIT_OTA_CHUNK_ACK: {
      const w = new Writer(1 + 4);
      w.u8('payload_type', payload.type);
      w.u32('index', payload.index);
      return w.buf;
    }
    case SwarmitPayloadType.SWARMIT_EVENT_LOG: {
      checkVarBytes('data', payload.data);
      const w = new Writer(1 + 4 + 1 + payload.data.length);
      w.u8('payload_type', payload.type);
      w.u32('timestamp', payload.timestamp);
      w.u8('count', payload.data.length);
      w.bytes('data', payload.data);
      return w.buf;
    }
    case SwarmitPayloadType.SWARMIT_MESSAGE: {
      checkVarBytes('message', payload.message);
      const w = new Writer(1 + 1 + payload.message.length);
      w.u8('payload_type', payload.type);
      w.u8('count', payload.message.length);
      w.bytes('message', payload.message);
      return w.buf;
    }
    case SwarmitPayloadType.SWARMIT_LH2_CALIBRATION: {
      const w = new Writer(1 + 4 + 4 + SWARMIT_LH2_HOMOGRAPHY_SIZE);
      w.u8('payload_type', payload.type);
      w.u32('homography_count', payload.homography_count);
      w.u32('homography_index', payload.homography_index);
      w.bytes('homography', payload.homography, SWARMIT_LH2_HOMOGRAPHY_SIZE);
      return w.buf;
    }
  }
}

/** Decodifica um Packet swarmit (`[payload_type] + campos`).
 *  Lança erro claro em tipo não suportado ou bytes truncados. */
export function decodeSwarmitPayload(data: Uint8Array): SwarmitPayload {
  if (data.length < 1) {
    throw new Error('packet swarmit vazio');
  }
  const type = data[0];
  const r = new Reader(data, 1);
  switch (type) {
    case SwarmitPayloadType.SWARMIT_STATUS:
      return {
        type,
        device: r.u8() as SwarmitDeviceType,
        status: r.u8() as SwarmitStatusType,
        battery: r.u16(),
        pos_x: r.i32(),
        pos_y: r.i32(),
      };
    case SwarmitPayloadType.SWARMIT_START:
    case SwarmitPayloadType.SWARMIT_STOP:
    case SwarmitPayloadType.SWARMIT_OTA_START_ACK:
    case SwarmitPayloadType.SWARMIT_LH2_CAPTURE:
      return { type };
    case SwarmitPayloadType.SWARMIT_RESET:
      return { type, pos_x: r.u32(), pos_y: r.u32() };
    case SwarmitPayloadType.SWARMIT_OTA_START:
      return { type, fw_length: r.u32(), fw_chunk_count: r.u32() };
    case SwarmitPayloadType.SWARMIT_OTA_CHUNK: {
      const index = r.u32();
      const count = r.u8();
      const sha = r.bytes(SWARMIT_OTA_SHA_SIZE);
      const chunk = r.bytes(count);
      return { type, index, sha, chunk };
    }
    case SwarmitPayloadType.SWARMIT_OTA_CHUNK_ACK:
      return { type, index: r.u32() };
    case SwarmitPayloadType.SWARMIT_EVENT_LOG: {
      const timestamp = r.u32();
      const count = r.u8();
      return { type, timestamp, data: r.bytes(count) };
    }
    case SwarmitPayloadType.SWARMIT_MESSAGE: {
      const count = r.u8();
      return { type, message: r.bytes(count) };
    }
    case SwarmitPayloadType.SWARMIT_LH2_CALIBRATION:
      return {
        type,
        homography_count: r.u32(),
        homography_index: r.u32(),
        homography: r.bytes(SWARMIT_LH2_HOMOGRAPHY_SIZE),
      };
    default:
      // inclui 0x88 EVENT_GPIO: existe no enum, mas o protocol.py do
      // swarmit não registra parser — sem layout confirmável, sem codec.
      throw new Error(
        `payload_type swarmit não suportado: 0x${type.toString(16).padStart(2, '0')}`,
      );
  }
}

/** Nome legível de um estado swarmit ("Bootloader", "Running", …). */
export function swarmitStatusName(status: SwarmitStatusType): string {
  return SwarmitStatusType[status] ?? `?${status}`;
}
