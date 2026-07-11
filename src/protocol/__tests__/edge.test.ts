// Fase 4 — wire do gateway ([EdgeEvent] + evento) e base64 do MQTT.
//
// Vetores golden gerados executando o marilib REAL (marilib-pkg 0.9.0):
//   EdgeEvent.to_bytes(NODE_DATA) + frame.to_bytes()   → downlink/uplink DATA
//   EdgeEvent.to_bytes(NODE_JOINED) + NodeInfoCloud(...).to_bytes()
//   EdgeEvent.to_bytes(GATEWAY_INFO) + GatewayInfo(...).to_bytes()
//   base64.b64encode(...) do Python pro payload MQTT.

import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  bytesToBase64,
  decodeEdgeMessage,
  decodeEdgeMessageBase64,
  decodeGatewayInfo,
  decodeNodeInfoCloud,
  encodeEdgeMessage,
  encodeEdgeMessageBase64,
  encodeGatewayInfo,
  encodeNodeInfoCloud,
  GATEWAY_INFO_SIZE,
  GatewayInfo,
  NODE_INFO_CLOUD_SIZE,
  networkIdToTopicStr,
  toCloudTopic,
  toEdgeTopic,
} from '../edge';
import { addressFromHex, EdgeEvent } from '../mari';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// frame Mari golden do mari.test.ts (CMD_MOVE_RAW dentro de NODE_DATA)
const FRAME_HEX = '0310001225270dc04bb0f2bd01000000000000001100009c0064';
const EDGE_NODE_DATA_HEX = '03' + FRAME_HEX;
const EDGE_NODE_DATA_B64 = 'AwMQABIlJw3AS7DyvQEAAAAAAAAAEQAAnABk';

describe('protocol/edge — mensagem [1 B EdgeEvent] + dados', () => {
  it('NODE_DATA + frame bate byte a byte com o marilib', () => {
    const msg = encodeEdgeMessage(EdgeEvent.NODE_DATA, fromHex(FRAME_HEX));
    expect(hex(msg)).toBe(EDGE_NODE_DATA_HEX);
    expect(msg[0]).toBe(3);
  });

  it('round-trip encode→decode (com payload)', () => {
    const data = fromHex(FRAME_HEX);
    const decoded = decodeEdgeMessage(encodeEdgeMessage(EdgeEvent.NODE_DATA, data));
    expect(decoded.event).toBe(EdgeEvent.NODE_DATA);
    expect(hex(decoded.data)).toBe(FRAME_HEX);
  });

  it('round-trip com dados vazios (mensagem de 1 byte)', () => {
    const msg = encodeEdgeMessage(EdgeEvent.NODE_KEEP_ALIVE, new Uint8Array(0));
    expect(msg.length).toBe(1);
    const decoded = decodeEdgeMessage(msg);
    expect(decoded.event).toBe(EdgeEvent.NODE_KEEP_ALIVE);
    expect(decoded.data.length).toBe(0);
  });

  it('mensagem vazia lança erro', () => {
    expect(() => decodeEdgeMessage(new Uint8Array(0))).toThrow(/vazia/);
  });
});

describe('protocol/edge — NodeInfoCloud (NODE_JOINED/LEFT/KEEP_ALIVE)', () => {
  it('vetor golden: address + gateway_address em u64 LE (16 B)', () => {
    const info = {
      address: addressFromHex('BDF2B04BC00D2725'),
      gateway_address: 1n,
    };
    const bytes = encodeNodeInfoCloud(info);
    expect(bytes.length).toBe(NODE_INFO_CLOUD_SIZE);
    expect(hex(bytes)).toBe('25270dc04bb0f2bd0100000000000000');
    // mensagem completa NODE_JOINED, como o marilib_edge publica:
    expect(hex(encodeEdgeMessage(EdgeEvent.NODE_JOINED, bytes))).toBe(
      '0125270dc04bb0f2bd0100000000000000',
    );
    expect(decodeNodeInfoCloud(bytes)).toEqual(info);
  });

  it('bytes truncados lançam erro', () => {
    expect(() => decodeNodeInfoCloud(new Uint8Array(15))).toThrow(/16 bytes/);
  });
});

describe('protocol/edge — GatewayInfo (GATEWAY_INFO)', () => {
  const info: GatewayInfo = {
    address: 1n,
    network_id: 0x1200,
    schedule_id: 4,
    schedule_stats: new Uint8Array(Array.from({ length: 32 }, (_, i) => i)),
    asn: 0x1122334455667788n,
    timer: 1000,
  };
  const GOLDEN =
    '010000000000000000120400' +
    '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f' +
    '8877665544332211e8030000';

  it('vetor golden: 55 B, tudo LE, schedule_stats crus', () => {
    const bytes = encodeGatewayInfo(info);
    expect(bytes.length).toBe(GATEWAY_INFO_SIZE);
    expect(hex(bytes)).toBe(GOLDEN);
  });

  it('round-trip encode→decode', () => {
    expect(decodeGatewayInfo(encodeGatewayInfo(info))).toEqual(info);
  });

  it('mensagem completa GATEWAY_INFO bate com o marilib', () => {
    expect(hex(encodeEdgeMessage(EdgeEvent.GATEWAY_INFO, encodeGatewayInfo(info)))).toBe(
      '05' + GOLDEN,
    );
  });

  it('schedule_stats com tamanho errado lança erro', () => {
    expect(() => encodeGatewayInfo({ ...info, schedule_stats: new Uint8Array(31) })).toThrow(
      RangeError,
    );
  });
});

describe('protocol/edge — base64 (payload MQTT)', () => {
  it('vetor golden: bate com base64.b64encode do Python', () => {
    expect(bytesToBase64(fromHex(EDGE_NODE_DATA_HEX))).toBe(EDGE_NODE_DATA_B64);
    expect(hex(base64ToBytes(EDGE_NODE_DATA_B64))).toBe(EDGE_NODE_DATA_HEX);
  });

  it('atalhos encodeEdgeMessageBase64/decodeEdgeMessageBase64', () => {
    expect(encodeEdgeMessageBase64(EdgeEvent.NODE_DATA, fromHex(FRAME_HEX))).toBe(
      EDGE_NODE_DATA_B64,
    );
    const decoded = decodeEdgeMessageBase64(EDGE_NODE_DATA_B64);
    expect(decoded.event).toBe(EdgeEvent.NODE_DATA);
    expect(hex(decoded.data)).toBe(FRAME_HEX);
  });

  it('round-trip em todos os comprimentos de resto (0, 1 e 2 bytes sobrando)', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 33, 55, 256]) {
      const bytes = new Uint8Array(Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff));
      const b64 = bytesToBase64(bytes);
      expect(b64.length % 4).toBe(0);
      expect(hex(base64ToBytes(b64))).toBe(hex(bytes));
    }
  });

  it('padding correto (RFC 4648, igual ao Python)', () => {
    expect(bytesToBase64(new Uint8Array([0x66]))).toBe('Zg==');
    expect(bytesToBase64(new Uint8Array([0x66, 0x6f]))).toBe('Zm8=');
    expect(bytesToBase64(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe('Zm9v');
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });

  it('todos os 256 valores de byte sobrevivem ao round-trip', () => {
    const bytes = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
    expect(hex(base64ToBytes(bytesToBase64(bytes)))).toBe(hex(bytes));
  });

  it('base64 inválido lança erro claro', () => {
    expect(() => base64ToBytes('AwM')).toThrow(/múltiplo de 4/);
    expect(() => base64ToBytes('Aw$=')).toThrow(/caractere/);
  });

  it('aceita quebras de linha no meio (logs/brokers)', () => {
    expect(hex(base64ToBytes('AwMQABIlJw3AS7Dy\nvQEAAAAAAAAAEQAAnABk'))).toBe(EDGE_NODE_DATA_HEX);
  });
});

describe('protocol/edge — tópicos MQTT', () => {
  it('NETID em 4 hex maiúsculos (network_id_str do marilib)', () => {
    expect(networkIdToTopicStr(0x1200)).toBe('1200');
    expect(networkIdToTopicStr(0x0001)).toBe('0001');
    expect(networkIdToTopicStr(0xabcd)).toBe('ABCD');
  });

  it('tópicos to_edge/to_cloud no formato do communication_adapter.py', () => {
    expect(toEdgeTopic(0x1200)).toBe('/mari/1200/to_edge');
    expect(toCloudTopic(0x1200)).toBe('/mari/1200/to_cloud');
  });
});
