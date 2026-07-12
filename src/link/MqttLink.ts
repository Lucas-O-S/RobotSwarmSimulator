// Fase 5 — MqttLink: implementação MQTT do FleetLink.
//
// Reproduz o MQTTAdapter do marilib (communication_adapter.py) do lado EDGE:
//   - assina  /mari/{NETID}/to_edge   (comandos descendo, cloud → gateway)
//   - publica /mari/{NETID}/to_cloud  (eventos/telemetria subindo)
//   - payload MQTT = base64( [1 B EdgeEvent] + evento/frame Mari ), QoS 0
//   - NETID = network_id em 4 hex MAIÚSCULOS
//
// A lib `mqtt` (mqtt.js) funciona em node (TCP mqtt://) E no browser
// (MQTT-over-WebSocket ws://), então este arquivo serve pros dois mundos.
//
// O enquadramento uplink e a decodificação downlink são FUNÇÕES PURAS
// exportadas (encodeUplink / decodeDownlink) — testáveis sem broker.

import { connect, MqttClient } from 'mqtt';

import {
  addressFromHex,
  addressToHex,
  decodeDotBotPayload,
  decodeEdgeMessageBase64,
  decodeMariFrame,
  EdgeEvent,
  encodeDotBotPayload,
  encodeEdgeMessageBase64,
  encodeGatewayInfo,
  encodeMariFrame,
  encodeNodeInfoCloud,
  GATEWAY_INFO_SCHEDULE_STATS_SIZE,
  GatewayInfo,
  makeMariHeader,
  MariFrame,
  NextProto,
  PayloadType,
  toCloudTopic,
  toEdgeTopic,
} from '../protocol';
import { FleetCommand, FleetLink, FleetUplink } from './FleetLink';

// ---------------------------------------------------------------------------
// Enquadramento (puro, sem I/O)
// ---------------------------------------------------------------------------

export interface WireOptions {
  networkId: number; // u16
  gatewayAddress: bigint; // u64
  /** schedule_id do GATEWAY_INFO (default 0 — sem semântica no simulador). */
  scheduleId?: number;
}

/** Enquadra um uplink neutro no wire do gateway e retorna o base64 pronto
 *  pro publish em /mari/{NETID}/to_cloud (marilib_edge.send_data_to_cloud). */
export function encodeUplink(uplink: FleetUplink, opts: WireOptions): string {
  switch (uplink.kind) {
    case 'gateway-info': {
      const info: GatewayInfo = {
        address: opts.gatewayAddress,
        network_id: opts.networkId,
        schedule_id: opts.scheduleId ?? 0,
        schedule_stats: new Uint8Array(GATEWAY_INFO_SCHEDULE_STATS_SIZE),
        asn: uplink.asn,
        timer: uplink.timer,
      };
      return encodeEdgeMessageBase64(EdgeEvent.GATEWAY_INFO, encodeGatewayInfo(info));
    }
    case 'node-joined':
    case 'node-left':
    case 'node-keep-alive': {
      const event =
        uplink.kind === 'node-joined'
          ? EdgeEvent.NODE_JOINED
          : uplink.kind === 'node-left'
            ? EdgeEvent.NODE_LEFT
            : EdgeEvent.NODE_KEEP_ALIVE;
      const info = encodeNodeInfoCloud({
        address: addressFromHex(uplink.address),
        gateway_address: opts.gatewayAddress,
      });
      return encodeEdgeMessageBase64(event, info);
    }
    case 'node-data': {
      // Frame de uplink: robô (source) → gateway (destination), como o
      // firmware envia pelo rádio e o edge relaya intacto pro cloud.
      const frame: MariFrame = {
        header: makeMariHeader({
          network_id: opts.networkId,
          destination: opts.gatewayAddress,
          source: addressFromHex(uplink.source),
          next_proto: NextProto.DOTBOT_APP,
        }),
        payload: encodeDotBotPayload(uplink.payload),
      };
      return encodeEdgeMessageBase64(EdgeEvent.NODE_DATA, encodeMariFrame(frame));
    }
  }
}

/** Decodifica um payload MQTT de /mari/{NETID}/to_edge num comando neutro.
 *  Retorna null (e loga o motivo) pra mensagens que não nos dizem respeito:
 *  EdgeEvent ≠ NODE_DATA, network_id alheio, next_proto ≠ DOTBOT_APP,
 *  payload malformado ou payload_type que não é comando. */
export function decodeDownlink(
  b64: string,
  networkId: number,
  log?: (msg: string) => void,
): FleetCommand | null {
  let msg;
  try {
    msg = decodeEdgeMessageBase64(b64);
  } catch (err) {
    log?.(`[link] downlink ilegível (${(err as Error).message})`);
    return null;
  }
  if (msg.event !== EdgeEvent.NODE_DATA) {
    log?.(`[link] downlink ignorado: EdgeEvent=${msg.event} (só NODE_DATA desce)`);
    return null;
  }
  let frame: MariFrame;
  try {
    frame = decodeMariFrame(msg.data);
  } catch (err) {
    log?.(`[link] frame Mari ilegível (${(err as Error).message})`);
    return null;
  }
  if (frame.header.network_id !== networkId) {
    log?.(
      `[link] downlink ignorado: network_id=0x${frame.header.network_id.toString(16)} não é o nosso`,
    );
    return null;
  }
  if (frame.header.next_proto !== NextProto.DOTBOT_APP) {
    log?.(`[link] downlink ignorado: next_proto=0x${frame.header.next_proto.toString(16)}`);
    return null;
  }
  let payload;
  try {
    payload = decodeDotBotPayload(frame.payload);
  } catch (err) {
    log?.(`[link] payload DotBot ilegível (${(err as Error).message})`);
    return null;
  }
  const destination = addressToHex(frame.header.destination);
  switch (payload.type) {
    case PayloadType.CMD_MOVE_RAW:
      return {
        kind: 'move-raw',
        destination,
        left_x: payload.left_x,
        left_y: payload.left_y,
        right_x: payload.right_x,
        right_y: payload.right_y,
      };
    case PayloadType.CMD_RGB_LED:
      return {
        kind: 'rgb',
        destination,
        red: payload.red,
        green: payload.green,
        blue: payload.blue,
      };
    case PayloadType.CONTROL_MODE:
      return { kind: 'control-mode', destination, mode: payload.mode };
    case PayloadType.LH2_WAYPOINTS:
      return {
        kind: 'waypoints',
        destination,
        threshold: payload.threshold,
        waypoints: payload.waypoints.map((wp) => ({ x: wp.pos_x, y: wp.pos_y })),
      };
    default:
      log?.(
        `[link] payload_type 0x${payload.type.toString(16)} não é comando descendo — ignorado`,
      );
      return null;
  }
}

// ---------------------------------------------------------------------------
// O link MQTT em si
// ---------------------------------------------------------------------------

export interface MqttLinkOptions extends WireOptions {
  /** URL do broker: mqtt://host:1883 (node) ou ws://host:9001 (browser). */
  url: string;
  /** Versão do protocolo MQTT. O marilib usa 5; brokers de teste em
   *  processo (aedes) só falam 3.1.1 → passe 4 nos testes. Default 5. */
  protocolVersion?: 4 | 5;
  log?: (msg: string) => void;
}

export class MqttLink implements FleetLink {
  private client?: MqttClient;
  private cb?: (cmd: FleetCommand) => void;
  private readonly toEdge: string;
  private readonly toCloud: string;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: MqttLinkOptions) {
    this.toEdge = toEdgeTopic(opts.networkId);
    this.toCloud = toCloudTopic(opts.networkId);
    this.log = opts.log ?? (() => {});
  }

  async start(): Promise<void> {
    if (this.client) return;
    const client = connect(this.opts.url, {
      protocolVersion: this.opts.protocolVersion ?? 5,
      clientId: `rss-gw-${addressToHex(this.opts.gatewayAddress).slice(-6)}-${Math.random()
        .toString(16)
        .slice(2, 8)}`,
    });
    this.client = client;

    client.on('message', (topic, payload) => {
      if (topic !== this.toEdge) return;
      const cmd = decodeDownlink(payload.toString(), this.opts.networkId, this.log);
      if (cmd) {
        this.log(`[link] ⇩ ${cmd.kind} → ${cmd.destination}`);
        this.cb?.(cmd);
      }
    });
    client.on('reconnect', () => this.log(`[link] reconectando em ${this.opts.url}…`));

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      client.once('error', onError);
      client.once('connect', () => {
        client.removeListener('error', onError);
        resolve();
      });
    });
    // erros pós-conexão só logam (o mqtt.js reconecta sozinho)
    client.on('error', (err) => this.log(`[link] erro MQTT: ${err.message}`));

    await client.subscribeAsync(this.toEdge, { qos: 0 });
    this.log(`[link] conectado a ${this.opts.url} — assinando ${this.toEdge}`);
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client) {
      await client.endAsync();
      this.log('[link] desconectado');
    }
  }

  onCommand(cb: (cmd: FleetCommand) => void): void {
    this.cb = cb;
  }

  publishUplink(uplink: FleetUplink): void {
    if (!this.client) {
      throw new Error('MqttLink.publishUplink antes de start()');
    }
    const b64 = encodeUplink(uplink, this.opts);
    this.client.publish(this.toCloud, b64, { qos: 0 });
  }
}
