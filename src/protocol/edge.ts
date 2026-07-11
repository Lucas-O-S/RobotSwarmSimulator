// Fase 4 — Wire do gateway (o que trafega nos tópicos MQTT, Fase 5).
//
// FONTE AUTORITATIVA (confirmado byte a byte em 2026-07-11 no pacote
// marilib-pkg 0.9.0 do PyPI — o que o PyDotBot 0.29.1 pina):
//   - marilib/marilib_edge.py  (send_data_to_cloud):
//       uplink  = [1 B EdgeEvent] + event_data.to_bytes()
//   - marilib/marilib_cloud.py (send_frame):
//       downlink = [1 B EdgeEvent.NODE_DATA] + frame Mari
//   - marilib/communication_adapter.py (MQTTAdapter): o payload MQTT é
//       base64.b64encode(data) publicado em /mari/{NETID}/to_edge|to_cloud
//       com QoS 0 (NETID = network_id em 4 hex MAIÚSCULOS,
//       GatewayInfo.network_id_str do model.py).
//
// O `event_data` depende do EdgeEvent:
//   NODE_DATA                          → frame Mari completo (mari.ts)
//   NODE_JOINED/NODE_LEFT/KEEP_ALIVE   → NodeInfoCloud (16 B, model.py)
//   GATEWAY_INFO                       → GatewayInfo (55 B, model.py)
//
// ENDIANNESS: todos os inteiros multi-byte são LITTLE-ENDIAN
// (marilib/protocol.py, byteorder="little").

import { EdgeEvent } from './mari';

// ---------------------------------------------------------------------------
// Mensagem de edge: [1 byte EdgeEvent] + bytes do evento
// ---------------------------------------------------------------------------

export interface EdgeMessage {
  event: EdgeEvent;
  /** Bytes do evento: frame Mari (NODE_DATA), NodeInfoCloud, GatewayInfo… */
  data: Uint8Array;
}

/** `[1 B EdgeEvent] + data` — o stream exato da serial/MQTT do gateway. */
export function encodeEdgeMessage(event: EdgeEvent, data: Uint8Array): Uint8Array {
  if (!Number.isInteger(event) || event < 0 || event > 0xff) {
    throw new RangeError(`EdgeEvent fora de u8: ${event}`);
  }
  const out = new Uint8Array(1 + data.length);
  out[0] = event;
  out.set(data, 1);
  return out;
}

export function decodeEdgeMessage(bytes: Uint8Array): EdgeMessage {
  if (bytes.length < 1) {
    throw new Error('mensagem de edge vazia (precisa de pelo menos 1 byte de EdgeEvent)');
  }
  return { event: bytes[0] as EdgeEvent, data: bytes.slice(1) };
}

// ---------------------------------------------------------------------------
// Tópicos MQTT (communication_adapter.py). NETID em 4 hex maiúsculos.
// ---------------------------------------------------------------------------

/** Formata o network_id como o marilib (GatewayInfo.network_id_str): 4 hex maiúsculos. */
export function networkIdToTopicStr(networkId: number): string {
  if (!Number.isInteger(networkId) || networkId < 0 || networkId > 0xffff) {
    throw new RangeError(`network_id fora de u16: ${networkId}`);
  }
  return networkId.toString(16).toUpperCase().padStart(4, '0');
}

/** Tópico cloud→gateway (comandos descendo). */
export function toEdgeTopic(networkId: number): string {
  return `/mari/${networkIdToTopicStr(networkId)}/to_edge`;
}

/** Tópico gateway→cloud (eventos + telemetria subindo). */
export function toCloudTopic(networkId: number): string {
  return `/mari/${networkIdToTopicStr(networkId)}/to_cloud`;
}

// ---------------------------------------------------------------------------
// NodeInfoCloud — event_data de NODE_JOINED / NODE_LEFT / NODE_KEEP_ALIVE
// no uplink (marilib/model.py: address u64 LE + gateway_address u64 LE).
// ---------------------------------------------------------------------------

export const NODE_INFO_CLOUD_SIZE = 16;

export interface NodeInfoCloud {
  address: bigint; // u64 LE
  gateway_address: bigint; // u64 LE
}

export function encodeNodeInfoCloud(info: NodeInfoCloud): Uint8Array {
  const out = new Uint8Array(NODE_INFO_CLOUD_SIZE);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, checkU64('address', info.address), true);
  view.setBigUint64(8, checkU64('gateway_address', info.gateway_address), true);
  return out;
}

export function decodeNodeInfoCloud(bytes: Uint8Array): NodeInfoCloud {
  if (bytes.length < NODE_INFO_CLOUD_SIZE) {
    throw new Error(`NodeInfoCloud precisa de ${NODE_INFO_CLOUD_SIZE} bytes, recebi ${bytes.length}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    address: view.getBigUint64(0, true),
    gateway_address: view.getBigUint64(8, true),
  };
}

// ---------------------------------------------------------------------------
// GatewayInfo — event_data de GATEWAY_INFO no uplink (marilib/model.py):
//   address u64 + network_id u16 + schedule_id u8 +
//   schedule_stats 32 B crus (4× uint64 do firmware) + asn u64 + timer u32
// = 55 bytes, tudo LE.
// ---------------------------------------------------------------------------

export const GATEWAY_INFO_SIZE = 55;
export const GATEWAY_INFO_SCHEDULE_STATS_SIZE = 32;

export interface GatewayInfo {
  address: bigint; // u64 LE
  network_id: number; // u16 LE
  schedule_id: number; // u8
  schedule_stats: Uint8Array; // 32 B crus (bitmap de uso dos slots)
  asn: bigint; // u64 LE
  timer: number; // u32 LE
}

export function encodeGatewayInfo(info: GatewayInfo): Uint8Array {
  if (info.schedule_stats.length !== GATEWAY_INFO_SCHEDULE_STATS_SIZE) {
    throw new RangeError(
      `schedule_stats deve ter ${GATEWAY_INFO_SCHEDULE_STATS_SIZE} bytes, tem ${info.schedule_stats.length}`,
    );
  }
  if (!Number.isInteger(info.network_id) || info.network_id < 0 || info.network_id > 0xffff) {
    throw new RangeError(`network_id fora de u16: ${info.network_id}`);
  }
  if (!Number.isInteger(info.schedule_id) || info.schedule_id < 0 || info.schedule_id > 0xff) {
    throw new RangeError(`schedule_id fora de u8: ${info.schedule_id}`);
  }
  if (!Number.isInteger(info.timer) || info.timer < 0 || info.timer > 0xffffffff) {
    throw new RangeError(`timer fora de u32: ${info.timer}`);
  }
  const out = new Uint8Array(GATEWAY_INFO_SIZE);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, checkU64('address', info.address), true);
  view.setUint16(8, info.network_id, true);
  view.setUint8(10, info.schedule_id);
  out.set(info.schedule_stats, 11);
  view.setBigUint64(43, checkU64('asn', info.asn), true);
  view.setUint32(51, info.timer, true);
  return out;
}

export function decodeGatewayInfo(bytes: Uint8Array): GatewayInfo {
  if (bytes.length < GATEWAY_INFO_SIZE) {
    throw new Error(`GatewayInfo precisa de ${GATEWAY_INFO_SIZE} bytes, recebi ${bytes.length}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    address: view.getBigUint64(0, true),
    network_id: view.getUint16(8, true),
    schedule_id: view.getUint8(10),
    schedule_stats: bytes.slice(11, 43),
    asn: view.getBigUint64(43, true),
    timer: view.getUint32(51, true),
  };
}

function checkU64(name: string, v: bigint): bigint {
  if (v < 0n || v > 0xffffffffffffffffn) {
    throw new RangeError(`${name} fora de u64: ${v}`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// base64 — implementação própria sobre Uint8Array (funciona em browser E
// node, sem Buffer global nem atob/btoa). Alfabeto padrão RFC 4648 com
// padding '=', igual ao base64.b64encode do Python usado pelo marilib.
// ---------------------------------------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_LOOKUP: Int16Array = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    t[B64_ALPHABET.charCodeAt(i)] = i;
  }
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_ALPHABET[(n >> 18) & 63] +
      B64_ALPHABET[(n >> 12) & 63] +
      B64_ALPHABET[(n >> 6) & 63] +
      B64_ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  // remove whitespace (brokers/logs às vezes quebram linha) e valida forma
  const s = b64.replace(/[\r\n\s]/g, '');
  if (s.length % 4 !== 0) {
    throw new Error(`base64 inválido: comprimento ${s.length} não é múltiplo de 4`);
  }
  let padding = 0;
  if (s.endsWith('==')) padding = 2;
  else if (s.endsWith('=')) padding = 1;
  const chars = s.length - padding;
  const outLen = (s.length / 4) * 3 - padding;
  const out = new Uint8Array(outLen);
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < chars; i++) {
    const code = s.charCodeAt(i);
    const v = code < 128 ? B64_LOOKUP[code] : -1;
    if (v < 0) {
      throw new Error(`base64 inválido: caractere "${s[i]}" na posição ${i}`);
    }
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

/** Atalho: bytes prontos pro publish MQTT (base64 do wire do gateway). */
export function encodeEdgeMessageBase64(event: EdgeEvent, data: Uint8Array): string {
  return bytesToBase64(encodeEdgeMessage(event, data));
}

/** Atalho: decodifica um payload MQTT (base64) numa mensagem de edge. */
export function decodeEdgeMessageBase64(b64: string): EdgeMessage {
  return decodeEdgeMessage(base64ToBytes(b64));
}
