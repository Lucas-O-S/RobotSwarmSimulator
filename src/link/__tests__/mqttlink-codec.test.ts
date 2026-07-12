// Fase 5 — testes das funções PURAS de enquadramento do MqttLink
// (encodeUplink / decodeDownlink), verificadas contra o codec da Fase 4.

import { describe, expect, it } from 'vitest';

import { ControlModeType } from '../../core/types';
import {
  addressFromHex,
  decodeDotBotPayload,
  decodeEdgeMessageBase64,
  decodeGatewayInfo,
  decodeMariFrame,
  decodeNodeInfoCloud,
  EdgeEvent,
  encodeDotBotPayload,
  encodeEdgeMessageBase64,
  encodeMariFrame,
  makeMariHeader,
  MARI_PROTOCOL_VERSION,
  NextProto,
  PayloadType,
} from '../../protocol';
import { decodeDownlink, encodeUplink, WireOptions } from '../MqttLink';

const NETWORK_ID = 0x1200;
const GATEWAY = addressFromHex('0000000000000001');
const ROBOT = 'BDF2B04BC00D2725';
const OPTS: WireOptions = { networkId: NETWORK_ID, gatewayAddress: GATEWAY };

/** Enquadra um payload DotBot como o BACKEND (cloud) faria pro to_edge:
 *  base64( [NODE_DATA] + frame Mari{dest=robô, next_proto=DOTBOT_APP} ). */
function frameDownlink(
  destinationHex: string,
  payloadBytes: Uint8Array,
  overrides: { networkId?: number; nextProto?: NextProto } = {},
): string {
  const frame = {
    header: makeMariHeader({
      network_id: overrides.networkId ?? NETWORK_ID,
      destination: addressFromHex(destinationHex),
      source: GATEWAY,
      next_proto: overrides.nextProto ?? NextProto.DOTBOT_APP,
    }),
    payload: payloadBytes,
  };
  return encodeEdgeMessageBase64(EdgeEvent.NODE_DATA, encodeMariFrame(frame));
}

describe('link/MqttLink — encodeUplink (gateway → cloud)', () => {
  it('gateway-info decodifica de volta com o codec da Fase 4', () => {
    const b64 = encodeUplink({ kind: 'gateway-info', asn: 1234n, timer: 56789 }, OPTS);
    const msg = decodeEdgeMessageBase64(b64);
    expect(msg.event).toBe(EdgeEvent.GATEWAY_INFO);
    const info = decodeGatewayInfo(msg.data);
    expect(info.address).toBe(GATEWAY);
    expect(info.network_id).toBe(NETWORK_ID);
    expect(info.asn).toBe(1234n);
    expect(info.timer).toBe(56789);
    expect(info.schedule_stats).toHaveLength(32);
  });

  it('node-joined/left/keep-alive viram NodeInfoCloud com o EdgeEvent certo', () => {
    const cases = [
      ['node-joined', EdgeEvent.NODE_JOINED],
      ['node-left', EdgeEvent.NODE_LEFT],
      ['node-keep-alive', EdgeEvent.NODE_KEEP_ALIVE],
    ] as const;
    for (const [kind, event] of cases) {
      const b64 = encodeUplink({ kind, address: ROBOT }, OPTS);
      const msg = decodeEdgeMessageBase64(b64);
      expect(msg.event).toBe(event);
      const info = decodeNodeInfoCloud(msg.data);
      expect(info.address).toBe(addressFromHex(ROBOT));
      expect(info.gateway_address).toBe(GATEWAY);
    }
  });

  it('node-data enquadra frame Mari v3 (source=robô, next_proto=DOTBOT_APP)', () => {
    const b64 = encodeUplink(
      {
        kind: 'node-data',
        source: ROBOT,
        payload: {
          type: PayloadType.DOTBOT_ADVERTISEMENT,
          calibrated: 2,
          direction: 90,
          pos_x: 1235,
          pos_y: 55,
          battery: 4200,
          pwm_left: -20,
          pwm_right: 100,
          mode: ControlModeType.Auto,
          encoder_left: -13,
          encoder_right: 88,
          waypoint_x: 1500,
          waypoint_y: 300,
          waypoint_idx: 0,
        },
      },
      OPTS,
    );
    const msg = decodeEdgeMessageBase64(b64);
    expect(msg.event).toBe(EdgeEvent.NODE_DATA);
    const frame = decodeMariFrame(msg.data);
    expect(frame.header.version).toBe(MARI_PROTOCOL_VERSION);
    expect(frame.header.network_id).toBe(NETWORK_ID);
    expect(frame.header.source).toBe(addressFromHex(ROBOT));
    expect(frame.header.destination).toBe(GATEWAY);
    expect(frame.header.next_proto).toBe(NextProto.DOTBOT_APP);
    const payload = decodeDotBotPayload(frame.payload);
    if (payload.type !== PayloadType.DOTBOT_ADVERTISEMENT) {
      throw new Error('esperava DOTBOT_ADVERTISEMENT');
    }
    expect(payload.pos_x).toBe(1235);
    expect(payload.direction).toBe(90);
    expect(payload.pwm_left).toBe(-20);
    expect(payload.mode).toBe(ControlModeType.Auto);
  });
});

describe('link/MqttLink — decodeDownlink (cloud → gateway)', () => {
  it('CMD_MOVE_RAW vira comando move-raw com destination em hex', () => {
    const b64 = frameDownlink(
      ROBOT,
      encodeDotBotPayload({
        type: PayloadType.CMD_MOVE_RAW,
        left_x: 0,
        left_y: -100,
        right_x: 0,
        right_y: 100,
      }),
    );
    const cmd = decodeDownlink(b64, NETWORK_ID);
    expect(cmd).toEqual({
      kind: 'move-raw',
      destination: ROBOT,
      left_x: 0,
      left_y: -100,
      right_x: 0,
      right_y: 100,
    });
  });

  it('CMD_RGB_LED, CONTROL_MODE e LH2_WAYPOINTS mapeiam pros comandos neutros', () => {
    const rgb = decodeDownlink(
      frameDownlink(
        ROBOT,
        encodeDotBotPayload({ type: PayloadType.CMD_RGB_LED, red: 1, green: 2, blue: 3 }),
      ),
      NETWORK_ID,
    );
    expect(rgb).toEqual({ kind: 'rgb', destination: ROBOT, red: 1, green: 2, blue: 3 });

    const mode = decodeDownlink(
      frameDownlink(
        ROBOT,
        encodeDotBotPayload({ type: PayloadType.CONTROL_MODE, mode: ControlModeType.Auto }),
      ),
      NETWORK_ID,
    );
    expect(mode).toEqual({
      kind: 'control-mode',
      destination: ROBOT,
      mode: ControlModeType.Auto,
    });

    const wps = decodeDownlink(
      frameDownlink(
        ROBOT,
        encodeDotBotPayload({
          type: PayloadType.LH2_WAYPOINTS,
          threshold: 60,
          waypoints: [
            { pos_x: 1500, pos_y: 300 },
            { pos_x: 1500, pos_y: 1700 },
          ],
        }),
      ),
      NETWORK_ID,
    );
    expect(wps).toEqual({
      kind: 'waypoints',
      destination: ROBOT,
      threshold: 60,
      waypoints: [
        { x: 1500, y: 300 },
        { x: 1500, y: 1700 },
      ],
    });
  });

  it('ignora network_id alheio, next_proto ≠ DOTBOT_APP e não-comandos', () => {
    const moveRaw = encodeDotBotPayload({
      type: PayloadType.CMD_MOVE_RAW,
      left_x: 0,
      left_y: 1,
      right_x: 0,
      right_y: 1,
    });
    // network alheia
    expect(decodeDownlink(frameDownlink(ROBOT, moveRaw, { networkId: 0x9999 }), NETWORK_ID)).toBe(
      null,
    );
    // outro protocolo (swarmit) — não é nosso escopo
    expect(
      decodeDownlink(
        frameDownlink(ROBOT, moveRaw, { nextProto: NextProto.SWARMIT_TESTBED }),
        NETWORK_ID,
      ),
    ).toBe(null);
    // payload que não é comando descendo (telemetria)
    const adv = encodeDotBotPayload({
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
    expect(decodeDownlink(frameDownlink(ROBOT, adv), NETWORK_ID)).toBe(null);
    // EdgeEvent que não é NODE_DATA
    const keepAlive = encodeUplink({ kind: 'node-keep-alive', address: ROBOT }, OPTS);
    expect(decodeDownlink(keepAlive, NETWORK_ID)).toBe(null);
    // lixo
    expect(decodeDownlink('%%%não-base64%%%', NETWORK_ID)).toBe(null);
  });

  it('round-trip uplink→decodeDownlink não confunde direções', () => {
    // um advertise subindo, se relayado de volta, NÃO vira comando
    const b64 = encodeUplink(
      {
        kind: 'node-data',
        source: ROBOT,
        payload: { type: PayloadType.DOTBOT_SIMULATOR_DATA, theta: 90, pos_x: 1, pos_y: 2 },
      },
      OPTS,
    );
    expect(decodeDownlink(b64, NETWORK_ID)).toBe(null);
  });
});
