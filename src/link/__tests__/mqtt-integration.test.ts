// Fase 5 — teste de INTEGRAÇÃO ponta-a-ponta, headless, sem docker:
// broker MQTT em processo (aedes) num servidor TCP efêmero + MqttLink +
// SimGateway de verdade + um cliente mqtt fazendo o papel do CLOUD
// (backend NestJS), enquadrando/desenquadrando com o codec da Fase 4.
//
// O que fica provado:
//   1. o gateway publica GATEWAY_INFO, NODE_JOINED por robô e
//      NODE_DATA+DOTBOT_ADVERTISEMENT em /mari/{NETID}/to_cloud,
//      decodificáveis de volta e com pose coerente com o World;
//   2. um CMD_MOVE_RAW publicado em /mari/{NETID}/to_edge (enquadrado
//      exatamente como o backend faria) chega no robô certo e, após
//      ticks, o robô SE MOVEU — e a telemetria seguinte mostra isso;
//   3. LH2_WAYPOINTS pelo to_edge põe o robô em AUTO com a rota carregada.

import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:net';
import mqtt, { MqttClient } from 'mqtt';
import Aedes from 'aedes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadScenario } from '../../core/scenario';
import { ControlModeType, Scenario } from '../../core/types';
import { World } from '../../core/World';
import {
  addressFromHex,
  decodeDotBotPayload,
  decodeEdgeMessageBase64,
  decodeGatewayInfo,
  decodeMariFrame,
  decodeNodeInfoCloud,
  DotBotPayload,
  EdgeEvent,
  EdgeMessage,
  encodeDotBotPayload,
  encodeEdgeMessageBase64,
  encodeMariFrame,
  makeMariHeader,
  NextProto,
  PayloadType,
  toCloudTopic,
  toEdgeTopic,
} from '../../protocol';
import { MqttLink } from '../MqttLink';
import { SimGateway } from '../../net/gateway';

const ROBOT_1 = 'BDF2B04BC00D2725';
const ROBOT_2 = 'A1B2C3D4E5F60708';
const NETID_STR = '1200';
const NETWORK_ID = 0x1200;
const GATEWAY_ADDR = '0000000000000001';

const SCENARIO: Scenario = {
  version: 1,
  network: { id: NETID_STR, gateway_addr: GATEWAY_ADDR },
  arena: { width_mm: 4000, height_mm: 4000, grid_mm: 100 },
  obstacles: [],
  robots: [
    {
      address: ROBOT_1,
      application: 0,
      mode: 0,
      start: { x_mm: 500, y_mm: 500, theta_deg: 0 },
      battery: 100,
    },
    {
      address: ROBOT_2,
      application: 0,
      mode: 0,
      start: { x_mm: 1000, y_mm: 1000, theta_deg: 90 },
      battery: 100,
    },
  ],
  sim: {
    tick_hz: 50,
    advertise_hz: 2,
    battery_drain_per_min: 0,
    pdr_percent: 100,
    slot_latency_ms: 0,
  },
};

/** Enquadra um payload DotBot como o BACKEND (cloud) publica no to_edge:
 *  base64( [NODE_DATA] + frame Mari{src=gateway, dst=robô, DOTBOT_APP} )
 *  — o espelho do marilib_cloud.send_frame. */
function cloudDownlink(destinationHex: string, payload: DotBotPayload): string {
  const frame = {
    header: makeMariHeader({
      network_id: NETWORK_ID,
      destination: addressFromHex(destinationHex),
      source: addressFromHex(GATEWAY_ADDR),
      next_proto: NextProto.DOTBOT_APP,
    }),
    payload: encodeDotBotPayload(payload),
  };
  return encodeEdgeMessageBase64(EdgeEvent.NODE_DATA, encodeMariFrame(frame));
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('integração MQTT ponta-a-ponta (broker aedes em processo)', () => {
  let broker: InstanceType<typeof Aedes>;
  let server: Server;
  let url: string;
  let world: World;
  let gateway: SimGateway;
  let cloud: MqttClient;
  /** Tudo que o "cloud" recebeu em to_cloud, já desenquadrado do base64. */
  const received: EdgeMessage[] = [];

  beforeAll(async () => {
    // broker em processo, porta TCP efêmera
    broker = new Aedes();
    server = createServer(broker.handle);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `mqtt://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // o "cloud" (papel do backend NestJS): assina to_cloud
    cloud = mqtt.connect(url, { protocolVersion: 4 });
    await new Promise<void>((resolve, reject) => {
      cloud.once('connect', () => resolve());
      cloud.once('error', reject);
    });
    cloud.on('message', (_topic, payload) => {
      received.push(decodeEdgeMessageBase64(payload.toString()));
    });
    await cloud.subscribeAsync(toCloudTopic(NETWORK_ID), { qos: 0 });

    // o gateway simulado de verdade (MqttLink real; ticks manuais)
    world = loadScenario(SCENARIO);
    const link = new MqttLink({
      url,
      networkId: NETWORK_ID,
      gatewayAddress: addressFromHex(GATEWAY_ADDR),
      protocolVersion: 4, // aedes fala MQTT 3.1.1
    });
    gateway = new SimGateway({ world, link, autoTick: false });
    await gateway.start();
  }, 15000);

  afterAll(async () => {
    await gateway?.stop();
    await cloud?.endAsync();
    await new Promise<void>((resolve) => broker.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('publica GATEWAY_INFO e NODE_JOINED por robô, decodificáveis (Fase 4)', async () => {
    await waitFor(
      () => received.some((m) => m.event === EdgeEvent.GATEWAY_INFO),
      'GATEWAY_INFO no to_cloud',
    );
    await waitFor(
      () => received.filter((m) => m.event === EdgeEvent.NODE_JOINED).length >= 2,
      'NODE_JOINED dos 2 robôs',
    );

    const gwInfo = decodeGatewayInfo(
      received.find((m) => m.event === EdgeEvent.GATEWAY_INFO)!.data,
    );
    expect(gwInfo.address).toBe(addressFromHex(GATEWAY_ADDR));
    expect(gwInfo.network_id).toBe(NETWORK_ID);

    const joined = received
      .filter((m) => m.event === EdgeEvent.NODE_JOINED)
      .map((m) => decodeNodeInfoCloud(m.data));
    expect(joined.map((j) => j.address)).toEqual(
      expect.arrayContaining([addressFromHex(ROBOT_1), addressFromHex(ROBOT_2)]),
    );
    expect(joined[0].gateway_address).toBe(addressFromHex(GATEWAY_ADDR));
  }, 10000);

  it('advertise: NODE_DATA+DOTBOT_ADVERTISEMENT com pose coerente e keep-alive', async () => {
    gateway.step(1.0); // 1 s simulado → 2 rodadas de advertise + 1 keep-alive

    await waitFor(
      () => received.some((m) => m.event === EdgeEvent.NODE_DATA),
      'NODE_DATA no to_cloud',
    );
    await waitFor(
      () => received.some((m) => m.event === EdgeEvent.NODE_KEEP_ALIVE),
      'NODE_KEEP_ALIVE no to_cloud',
    );

    const frames = received
      .filter((m) => m.event === EdgeEvent.NODE_DATA)
      .map((m) => decodeMariFrame(m.data));
    const fromR1 = frames.filter((f) => f.header.source === addressFromHex(ROBOT_1));
    expect(fromR1.length).toBeGreaterThanOrEqual(1);
    expect(fromR1[0].header.next_proto).toBe(NextProto.DOTBOT_APP);
    expect(fromR1[0].header.network_id).toBe(NETWORK_ID);

    const adv = decodeDotBotPayload(fromR1[0].payload);
    if (adv.type !== PayloadType.DOTBOT_ADVERTISEMENT) {
      throw new Error('esperava DOTBOT_ADVERTISEMENT');
    }
    // pose coerente com o World (robô parado em (500, 500), theta 0)
    expect(adv.pos_x).toBe(500);
    expect(adv.pos_y).toBe(500);
    expect(adv.direction).toBe(0);
    expect(adv.mode).toBe(ControlModeType.Manual);
    expect(adv.battery).toBe(4200);
  }, 10000);

  it('CMD_MOVE_RAW pelo to_edge move o robô alvo (e SÓ ele) após ticks', async () => {
    const r1 = world.getRobot(ROBOT_1)!;
    const r2 = world.getRobot(ROBOT_2)!;
    const x0 = r1.pos_x;
    const r2Before = { x: r2.pos_x, y: r2.pos_y };

    await cloud.publishAsync(
      toEdgeTopic(NETWORK_ID),
      cloudDownlink(ROBOT_1, {
        type: PayloadType.CMD_MOVE_RAW,
        left_x: 0,
        left_y: 100,
        right_x: 0,
        right_y: 100,
      }),
      { qos: 0 },
    );

    // o comando desce async pelo broker; espera o gateway aplicar
    await waitFor(() => r1.pwm_left === 100 && r1.pwm_right === 100, 'move-raw aplicado');
    expect(r1.mode).toBe(ControlModeType.Manual);

    received.length = 0;
    gateway.step(1.0); // após ticks…
    expect(r1.pos_x).toBeGreaterThan(x0 + 100); // …o robô ANDOU (+x, theta=0)
    expect(r2.pos_x).toBe(r2Before.x); // o outro robô não se mexeu
    expect(r2.pos_y).toBe(r2Before.y);

    // e a telemetria subindo reflete a pose nova (os advertises chegam
    // async pelo broker — espera até o de t=1,0 s, com a pose final)
    const advsOfR1 = () =>
      received
        .filter((m) => m.event === EdgeEvent.NODE_DATA)
        .map((m) => decodeMariFrame(m.data))
        .filter((f) => f.header.source === addressFromHex(ROBOT_1))
        .map((f) => decodeDotBotPayload(f.payload));
    await waitFor(() => {
      const advs = advsOfR1();
      const last = advs[advs.length - 1];
      return (
        last !== undefined &&
        last.type === PayloadType.DOTBOT_ADVERTISEMENT &&
        Math.abs(last.pos_x - r1.pos_x) <= 1
      );
    }, 'advertise refletindo a pose pós-movimento');
    const last = advsOfR1().pop()!;
    if (last.type !== PayloadType.DOTBOT_ADVERTISEMENT) {
      throw new Error('esperava DOTBOT_ADVERTISEMENT');
    }
    expect(last.pwm_left).toBe(100);
    expect(last.mode).toBe(ControlModeType.Manual);
  }, 10000);

  it('LH2_WAYPOINTS pelo to_edge põe o robô em AUTO com a rota carregada', async () => {
    const r2 = world.getRobot(ROBOT_2)!;
    expect(r2.mode).toBe(ControlModeType.Manual);

    await cloud.publishAsync(
      toEdgeTopic(NETWORK_ID),
      cloudDownlink(ROBOT_2, {
        type: PayloadType.LH2_WAYPOINTS,
        threshold: 60,
        waypoints: [
          { pos_x: 1500, pos_y: 300 },
          { pos_x: 1500, pos_y: 1700 },
        ],
      }),
      { qos: 0 },
    );

    await waitFor(() => r2.mode === ControlModeType.Auto, 'waypoints aplicados');
    expect(r2.waypoints).toEqual([
      { x: 1500, y: 300 },
      { x: 1500, y: 1700 },
    ]);
    expect(r2.waypoint_threshold).toBe(60);

    // e em AUTO o robô passa a perseguir o 1º waypoint após ticks
    const d0 = Math.hypot(1500 - r2.pos_x, 300 - r2.pos_y);
    gateway.step(2.0);
    const d1 = Math.hypot(1500 - r2.pos_x, 300 - r2.pos_y);
    expect(d1).toBeLessThan(d0);
  }, 10000);
});
