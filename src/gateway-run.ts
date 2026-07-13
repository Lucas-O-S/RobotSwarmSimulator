// Fase 5 — entry headless do gateway simulado.
//
// Carrega um cenário, conecta num broker MQTT e roda o SimGateway
// (GATEWAY_INFO + NODE_JOINED + keep-alive/advertise + comandos).
//
// Uso:
//   npm run gateway                        # scenarios/exemplo.json
//   npm run gateway -- caminho/cenario.json
//   MQTT_URL=mqtt://broker:1883 npm run gateway
//   MQTT_PROTOCOL_VERSION=4 npm run gateway   # brokers sem MQTT 5 (default 5)

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadScenario } from './core/scenario';
import { addressFromHex, toCloudTopic, toEdgeTopic } from './protocol';
import { MqttLink } from './link/MqttLink';
import { SimGateway } from './net/gateway';

const here = dirname(fileURLToPath(import.meta.url));
const scenarioPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, '../scenarios/exemplo.json');
const url = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const protocolVersion = process.env.MQTT_PROTOCOL_VERSION === '4' ? 4 : 5;

const world = loadScenario(readFileSync(scenarioPath, 'utf-8'));

if (!/^[0-9a-fA-F]{1,4}$/.test(world.network.id)) {
  throw new Error(`network.id "${world.network.id}" deve ser 1–4 dígitos hex`);
}
const networkId = parseInt(world.network.id, 16);
const gatewayAddress = addressFromHex(world.network.gateway_addr);

console.log('=== RobotSwarmSimulator — gateway simulado (Fase 5) ===');
console.log(`cenário : ${scenarioPath}`);
console.log(
  `frota   : ${world.robots.length} robô(s) — ${world.robots.map((r) => r.address).join(', ')}`,
);
console.log(`broker  : ${url}`);
console.log(`tópicos : ${toEdgeTopic(networkId)} (⇩ comandos) | ${toCloudTopic(networkId)} (⇧ eventos)`);
console.log(
  `loop    : tick ${world.sim.tick_hz} Hz | advertise ${world.sim.advertise_hz} Hz | keep-alive 1 Hz`,
);
// Fase 7 — fidelidade de rede (PDR/latência) do cenário
const netOff =
  world.sim.net_enabled === false ||
  (world.sim.pdr_percent >= 100 && world.sim.slot_latency_ms <= 0 && (world.sim.jitter_ms ?? 0) <= 0);
console.log(
  `rede    : ${
    netOff
      ? 'perfeita (sem perda/atraso)'
      : `PDR ${world.sim.pdr_percent}% | latência ${world.sim.slot_latency_ms} ms` +
        ((world.sim.jitter_ms ?? 0) > 0 ? ` + jitter ${world.sim.jitter_ms} ms` : '')
  }`,
);

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const link = new MqttLink({ url, networkId, gatewayAddress, protocolVersion, log });
// staggerAdvertise (Fase 6): espalha os advertises da frota dentro do
// intervalo — N robôs não publicam N mensagens no mesmo tick.
const gateway = new SimGateway({ world, link, staggerAdvertise: true, log });

await gateway.start();
console.log('gateway rodando — Ctrl+C pra sair');

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\nencerrando…');
  void gateway.stop().then(() => process.exit(0));
});
