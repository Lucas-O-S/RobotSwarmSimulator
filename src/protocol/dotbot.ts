// Fase 4 — Payloads da aplicação DotBot (o que viaja dentro de frames Mari
// NODE_DATA com next_proto=DOTBOT_APP).
//
// FONTES AUTORITATIVAS (layouts confirmados byte a byte em 2026-07-10):
//   - PayloadType + campos/tamanhos/sinal de cada payload:
//     https://raw.githubusercontent.com/DotBots/PyDotBot/main/dotbot/protocol.py
//   - Serialização (Packet = [1 B payload_type] + campos; inteiros
//     little-endian; listas concatenadas; `count` precede bytes/list):
//     pydotbot-utils 0.3.0 (PyPI) == DotBots/pydotbot-utils@main,
//     dotbot_utils/protocol.py (Payload.to_bytes/from_bytes com
//     byteorder="little"; Packet.to_bytes prefixa payload_type em 1 byte).
//
// ENDIANNESS: todos os inteiros multi-byte são LITTLE-ENDIAN.
//
// O "packet" DotBot que entra como payload do frame Mari é:
//   [0]    payload_type u8
//   [1..]  campos do payload na ordem do metadata (ver cada encoder abaixo)

import { ApplicationType, ControlModeType } from '../core/types';

/** Tipos de payload DotBot (dotbot/protocol.py, PayloadType). */
export enum PayloadType {
  CMD_MOVE_RAW = 0x00,
  CMD_RGB_LED = 0x01,
  ADVERTISEMENT = 0x04,
  GPS_POSITION = 0x05,
  DOTBOT_ADVERTISEMENT = 0x06,
  CONTROL_MODE = 0x07,
  LH2_WAYPOINTS = 0x08,
  GPS_WAYPOINTS = 0x09,
  SAILBOT_DATA = 0x0a,
  CMD_XGO_ACTION = 0x0b,
  LH2_PROCESSED_DATA = 0x0c,
  LH2_CALIBRATION_HOMOGRAPHY = 0x0e,
  RAW_DATA = 0x10,
  DOTBOT_SIMULATOR_DATA = 0xfa,
  // 0x80–0xA2: payloads swarmit (SWARMIT_STATUS etc.) — vivem em outro
  // next_proto (SWARMIT_TESTBED) e ficam pra Fase 7 (swarmit.ts).
}

// ---------------------------------------------------------------------------
// Tipos TS dos payloads (união discriminada por `type`).
// ---------------------------------------------------------------------------

/** CMD_MOVE_RAW 0x00 — joystick MANUAL. 4× int8 (dotbot/protocol.py). */
export interface CmdMoveRawPayload {
  type: PayloadType.CMD_MOVE_RAW;
  left_x: number; // i8
  left_y: number; // i8
  right_x: number; // i8
  right_y: number; // i8
}

/** CMD_RGB_LED 0x01 — 3× uint8. */
export interface CmdRgbLedPayload {
  type: PayloadType.CMD_RGB_LED;
  red: number; // u8
  green: number; // u8
  blue: number; // u8
}

/** ADVERTISEMENT 0x04 — robô se anunciando (1× uint8: application). */
export interface AdvertisementPayload {
  type: PayloadType.ADVERTISEMENT;
  application: ApplicationType; // u8
}

/**
 * DOTBOT_ADVERTISEMENT 0x06 — telemetria (~500 ms).
 * 33 bytes de payload (34 com o payload_type). Offsets DENTRO do payload:
 *   [0]      calibrated    u8  (bitmask: LH1=0x01, LH2=0x02)
 *   [1..2]   direction     i16 (0xFFFF = desconhecida)
 *   [3..6]   pos_x         u32 (mm; 0xFFFFFFFF = desconhecida)
 *   [7..10]  pos_y         u32
 *   [11..12] battery       u16 (mV — o controller divide por 1000)
 *   [13]     pwm_left      i8
 *   [14]     pwm_right     i8
 *   [15]     mode          u8  (ControlModeType)
 *   [16..19] encoder_left  i32
 *   [20..23] encoder_right i32
 *   [24..27] waypoint_x    u32
 *   [28..31] waypoint_y    u32
 *   [32]     waypoint_idx  u8
 */
export interface DotBotAdvertisementPayload {
  type: PayloadType.DOTBOT_ADVERTISEMENT;
  calibrated: number;
  direction: number;
  pos_x: number;
  pos_y: number;
  battery: number;
  pwm_left: number;
  pwm_right: number;
  mode: ControlModeType;
  encoder_left: number;
  encoder_right: number;
  waypoint_x: number;
  waypoint_y: number;
  waypoint_idx: number;
}

/** CONTROL_MODE 0x07 — 1× uint8 (ControlModeType). */
export interface ControlModePayload {
  type: PayloadType.CONTROL_MODE;
  mode: ControlModeType; // u8
}

/** Waypoint LH2 (PayloadLH2Location): pos_x u32 + pos_y u32 (8 B). */
export interface Lh2Waypoint {
  pos_x: number; // u32
  pos_y: number; // u32
}

/**
 * LH2_WAYPOINTS 0x08 — rota do modo AUTO.
 * threshold u16 + count u8 + count×(pos_x u32, pos_y u32).
 * `count` é derivado de waypoints.length no encode.
 */
export interface Lh2WaypointsPayload {
  type: PayloadType.LH2_WAYPOINTS;
  threshold: number; // u16 (mm)
  waypoints: Lh2Waypoint[];
}

/** DOTBOT_SIMULATOR_DATA 0xFA — pose enxuta: theta u16 + pos_x u32 + pos_y u32. */
export interface DotBotSimulatorDataPayload {
  type: PayloadType.DOTBOT_SIMULATOR_DATA;
  theta: number; // u16
  pos_x: number; // u32
  pos_y: number; // u32
}

export type DotBotPayload =
  | CmdMoveRawPayload
  | CmdRgbLedPayload
  | AdvertisementPayload
  | DotBotAdvertisementPayload
  | ControlModePayload
  | Lh2WaypointsPayload
  | DotBotSimulatorDataPayload;

// ---------------------------------------------------------------------------
// Helpers de (de)serialização little-endian com checagem de faixa.
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

  i8(name: string, v: number): void {
    this.check(name, v, -0x80, 0x7f);
    this.view.setInt8(this.pos, v);
    this.pos += 1;
  }

  u16(name: string, v: number): void {
    this.check(name, v, 0, 0xffff);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  i16(name: string, v: number): void {
    this.check(name, v, -0x8000, 0x7fff);
    this.view.setInt16(this.pos, v, true);
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
    private bytes: Uint8Array,
    start: number,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = start;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new Error(
        `payload truncado: precisava de ${n} bytes no offset ${this.pos}, tenho ${this.bytes.length}`,
      );
    }
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
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
}

// ---------------------------------------------------------------------------
// encode / decode
// ---------------------------------------------------------------------------

/**
 * Serializa um payload DotBot como o Packet do dotbot_utils:
 * `[1 B payload_type] + campos little-endian` — os MESMOS bytes que
 * `Packet.from_payload(payload).to_bytes()` produz no PyDotBot.
 */
export function encodeDotBotPayload(payload: DotBotPayload): Uint8Array {
  switch (payload.type) {
    case PayloadType.CMD_MOVE_RAW: {
      const w = new Writer(1 + 4);
      w.u8('payload_type', payload.type);
      w.i8('left_x', payload.left_x);
      w.i8('left_y', payload.left_y);
      w.i8('right_x', payload.right_x);
      w.i8('right_y', payload.right_y);
      return w.buf;
    }
    case PayloadType.CMD_RGB_LED: {
      const w = new Writer(1 + 3);
      w.u8('payload_type', payload.type);
      w.u8('red', payload.red);
      w.u8('green', payload.green);
      w.u8('blue', payload.blue);
      return w.buf;
    }
    case PayloadType.ADVERTISEMENT: {
      const w = new Writer(1 + 1);
      w.u8('payload_type', payload.type);
      w.u8('application', payload.application);
      return w.buf;
    }
    case PayloadType.DOTBOT_ADVERTISEMENT: {
      const w = new Writer(1 + 33);
      w.u8('payload_type', payload.type);
      w.u8('calibrated', payload.calibrated);
      w.i16('direction', payload.direction);
      w.u32('pos_x', payload.pos_x);
      w.u32('pos_y', payload.pos_y);
      w.u16('battery', payload.battery);
      w.i8('pwm_left', payload.pwm_left);
      w.i8('pwm_right', payload.pwm_right);
      w.u8('mode', payload.mode);
      w.i32('encoder_left', payload.encoder_left);
      w.i32('encoder_right', payload.encoder_right);
      w.u32('waypoint_x', payload.waypoint_x);
      w.u32('waypoint_y', payload.waypoint_y);
      w.u8('waypoint_idx', payload.waypoint_idx);
      return w.buf;
    }
    case PayloadType.CONTROL_MODE: {
      const w = new Writer(1 + 1);
      w.u8('payload_type', payload.type);
      w.u8('mode', payload.mode);
      return w.buf;
    }
    case PayloadType.LH2_WAYPOINTS: {
      const count = payload.waypoints.length;
      if (count > 0xff) {
        throw new RangeError(`LH2_WAYPOINTS: no máximo 255 waypoints (tenho ${count})`);
      }
      const w = new Writer(1 + 2 + 1 + count * 8);
      w.u8('payload_type', payload.type);
      w.u16('threshold', payload.threshold);
      w.u8('count', count);
      for (const [i, wp] of payload.waypoints.entries()) {
        w.u32(`waypoints[${i}].pos_x`, wp.pos_x);
        w.u32(`waypoints[${i}].pos_y`, wp.pos_y);
      }
      return w.buf;
    }
    case PayloadType.DOTBOT_SIMULATOR_DATA: {
      const w = new Writer(1 + 10);
      w.u8('payload_type', payload.type);
      w.u16('theta', payload.theta);
      w.u32('pos_x', payload.pos_x);
      w.u32('pos_y', payload.pos_y);
      return w.buf;
    }
  }
}

/**
 * Decodifica um Packet DotBot (`[payload_type] + campos`).
 * Lança erro claro em tipo não suportado ou bytes truncados.
 */
export function decodeDotBotPayload(bytes: Uint8Array): DotBotPayload {
  if (bytes.length < 1) {
    throw new Error('packet DotBot vazio');
  }
  const type = bytes[0];
  const r = new Reader(bytes, 1);
  switch (type) {
    case PayloadType.CMD_MOVE_RAW:
      return {
        type,
        left_x: r.i8(),
        left_y: r.i8(),
        right_x: r.i8(),
        right_y: r.i8(),
      };
    case PayloadType.CMD_RGB_LED:
      return { type, red: r.u8(), green: r.u8(), blue: r.u8() };
    case PayloadType.ADVERTISEMENT:
      return { type, application: r.u8() as ApplicationType };
    case PayloadType.DOTBOT_ADVERTISEMENT:
      return {
        type,
        calibrated: r.u8(),
        direction: r.i16(),
        pos_x: r.u32(),
        pos_y: r.u32(),
        battery: r.u16(),
        pwm_left: r.i8(),
        pwm_right: r.i8(),
        mode: r.u8() as ControlModeType,
        encoder_left: r.i32(),
        encoder_right: r.i32(),
        waypoint_x: r.u32(),
        waypoint_y: r.u32(),
        waypoint_idx: r.u8(),
      };
    case PayloadType.CONTROL_MODE:
      return { type, mode: r.u8() as ControlModeType };
    case PayloadType.LH2_WAYPOINTS: {
      const threshold = r.u16();
      const count = r.u8();
      const waypoints: Lh2Waypoint[] = [];
      for (let i = 0; i < count; i++) {
        waypoints.push({ pos_x: r.u32(), pos_y: r.u32() });
      }
      return { type, threshold, waypoints };
    }
    case PayloadType.DOTBOT_SIMULATOR_DATA:
      return { type, theta: r.u16(), pos_x: r.u32(), pos_y: r.u32() };
    default:
      throw new Error(
        `payload_type DotBot não suportado: 0x${type.toString(16).padStart(2, '0')}`,
      );
  }
}
