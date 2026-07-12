// Fase 5 — FleetLink: interface de transporte do gateway simulado.
//
// Espelha o papel do `dotbot/adapter.py` (PyDotBot): o runtime do gateway
// (src/net/gateway.ts) conversa com o mundo externo SÓ por esta interface,
// em tipos NEUTROS (comandos já decodificados, uplinks ainda não
// enquadrados). Implementações plugáveis:
//   - MqttLink (src/link/MqttLink.ts) — a real, sobre MQTT;
//   - FakeLink (nos testes) — captura uplinks e injeta comandos.
//
// Quem conhece bytes/tópicos/base64 é a implementação (MqttLink usa o
// codec da Fase 4); o gateway não vê nada disso.

import { ControlModeType, Vec2 } from '../core/types';
import { DotBotPayload } from '../protocol';

/** Destination de broadcast (addressToHex(MARI_BROADCAST_ADDRESS)). */
export const BROADCAST_DEST = 'FFFFFFFFFFFFFFFF';

// ---------------------------------------------------------------------------
// Comandos que DESCEM (cloud → gateway → robô), já decodificados.
// `destination` = address em 16 hex maiúsculos (ou BROADCAST_DEST).
// ---------------------------------------------------------------------------

/** CMD_MOVE_RAW 0x00 — joystick (entra em MANUAL). */
export interface MoveRawCommand {
  kind: 'move-raw';
  destination: string;
  left_x: number;
  left_y: number;
  right_x: number;
  right_y: number;
}

/** CMD_RGB_LED 0x01. */
export interface RgbCommand {
  kind: 'rgb';
  destination: string;
  red: number;
  green: number;
  blue: number;
}

/** CONTROL_MODE 0x07. */
export interface ControlModeCommand {
  kind: 'control-mode';
  destination: string;
  mode: ControlModeType;
}

/** LH2_WAYPOINTS 0x08 — rota (entra em AUTO). Posições em mm. */
export interface WaypointsCommand {
  kind: 'waypoints';
  destination: string;
  threshold: number; // mm
  waypoints: Vec2[];
}

export type FleetCommand =
  | MoveRawCommand
  | RgbCommand
  | ControlModeCommand
  | WaypointsCommand;

// ---------------------------------------------------------------------------
// Uplinks que SOBEM (gateway → cloud), ainda em forma neutra.
// A implementação enquadra ([EdgeEvent] + evento/frame + base64).
// ---------------------------------------------------------------------------

/** GATEWAY_INFO (EdgeEvent 5). address/network_id/schedule vêm do link. */
export interface GatewayInfoUplink {
  kind: 'gateway-info';
  /** Nº do slot TSCH corrente (u64) — no simulador, derivado do relógio. */
  asn: bigint;
  /** Uptime do gateway em ms (u32). */
  timer: number;
}

/** NODE_JOINED / NODE_LEFT / NODE_KEEP_ALIVE (EdgeEvents 1/2/4). */
export interface NodeLifecycleUplink {
  kind: 'node-joined' | 'node-left' | 'node-keep-alive';
  /** Address do robô em 16 hex maiúsculos. */
  address: string;
}

/** NODE_DATA (EdgeEvent 3) com payload DotBot (next_proto=DOTBOT_APP). */
export interface NodeDataUplink {
  kind: 'node-data';
  /** Address do robô de origem em 16 hex maiúsculos. */
  source: string;
  payload: DotBotPayload;
}

export type FleetUplink = GatewayInfoUplink | NodeLifecycleUplink | NodeDataUplink;

// ---------------------------------------------------------------------------
// A interface de transporte.
// ---------------------------------------------------------------------------

export interface FleetLink {
  /** Conecta/assina. Resolve quando o link está pronto pra trafegar. */
  start(): Promise<void>;

  /** Desconecta e libera recursos. */
  stop(): Promise<void>;

  /** Registra o callback de comandos descendo (já decodificados). */
  onCommand(cb: (cmd: FleetCommand) => void): void;

  /** Publica um evento subindo (o link enquadra e envia). */
  publishUplink(uplink: FleetUplink): void;
}
