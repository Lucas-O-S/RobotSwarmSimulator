// Fase 7 (Peça 2) — respondedor swarmit do LADO DISPOSITIVO (o robô).
//
// FRONTEIRA DE PAPÉIS (decidida no projeto): o BACKEND (control plane) é quem
// ORQUESTRA — decide e envia START/STOP/RESET/OTA_*/STATUS descendo. O robô
// (que o simulador emula) é o RESPONDEDOR: roda a máquina de estados, dá ACK
// nos chunks de OTA, troca de estado e devolve heartbeat de status. Ele NUNCA
// inicia nada. Este arquivo é puro (sem I/O): recebe um SwarmitPayload que
// desceu e devolve os SwarmitPayload(s) que devem subir em resposta.
//
// Máquina de estados (swarmit/testbed/protocol.py, StatusType):
//   Bootloader ──OTA_START──▶ Programming ──(chunks+ACKs)──▶ Programming
//   Programming/Bootloader ──START──▶ Running ──STOP──▶ Bootloader
//   qualquer ──RESET(x,y)──▶ Bootloader (+ teleporta a pose conhecida)

import { Robot } from '../core/Robot';
import { SwarmitDeviceType, SwarmitPayload, SwarmitPayloadType, SwarmitStatusType } from '../protocol';

/** Bateria % (0..100) → mV (u16), mesmo mapeamento do DOTBOT_ADVERTISEMENT
 *  (rampa LiPo 3000–4200 mV) — o control plane divide por 1000 pra exibir. */
function batteryToMillivolts(percent: number): number {
  const p = Math.min(100, Math.max(0, percent));
  return Math.round(3000 + (p / 100) * 1200);
}

export class SwarmitDevice {
  private _status = SwarmitStatusType.Bootloader;
  private expectedChunks = 0;
  private readonly received = new Set<number>();

  constructor(
    private readonly robot: Robot,
    private readonly device: SwarmitDeviceType = SwarmitDeviceType.DotBotV3,
  ) {}

  get status(): SwarmitStatusType {
    return this._status;
  }

  /** true quando todos os chunks esperados do OTA já foram recebidos. */
  get allChunksReceived(): boolean {
    return this.expectedChunks > 0 && this.received.size >= this.expectedChunks;
  }

  /** Progresso do flash em [0, 1] (chunks recebidos / esperados). */
  get flashProgress(): number {
    if (this.expectedChunks <= 0) return this._status === SwarmitStatusType.Running ? 1 : 0;
    return Math.min(1, this.received.size / this.expectedChunks);
  }

  /** Heartbeat SWARMIT_STATUS a partir do estado atual do robô. */
  heartbeat(): SwarmitPayload {
    return this.statusPayload();
  }

  private statusPayload(): SwarmitPayload {
    return {
      type: SwarmitPayloadType.SWARMIT_STATUS,
      device: this.device,
      status: this._status,
      battery: batteryToMillivolts(this.robot.battery),
      pos_x: Math.round(this.robot.pos_x),
      pos_y: Math.round(this.robot.pos_y),
    };
  }

  /** Reage a um comando swarmit que desceu; devolve os payloads de resposta
   *  que devem SUBIR (acks/status). Só requests fazem sentido descendo — os
   *  tipos que só sobem (acks/status/eventos) são ignorados se chegarem. */
  onCommand(cmd: SwarmitPayload): SwarmitPayload[] {
    switch (cmd.type) {
      case SwarmitPayloadType.SWARMIT_STATUS:
        // request de status → responde o heartbeat atual
        return [this.statusPayload()];

      case SwarmitPayloadType.SWARMIT_OTA_START:
        this._status = SwarmitStatusType.Programming;
        this.expectedChunks = cmd.fw_chunk_count;
        this.received.clear();
        return [{ type: SwarmitPayloadType.SWARMIT_OTA_START_ACK }];

      case SwarmitPayloadType.SWARMIT_OTA_CHUNK:
        // ARQ pare-e-espere: idempotente — reenvio do mesmo índice re-ACKa
        // sem duplicar efeito (Set).
        this.received.add(cmd.index);
        return [{ type: SwarmitPayloadType.SWARMIT_OTA_CHUNK_ACK, index: cmd.index }];

      case SwarmitPayloadType.SWARMIT_START:
        this._status = SwarmitStatusType.Running;
        return [this.statusPayload()];

      case SwarmitPayloadType.SWARMIT_STOP:
        // "stop" devolve o dispositivo ao bootloader (o app do usuário é
        // recuperável porque o bootloader/sandbox sempre sobrevive).
        this._status = SwarmitStatusType.Bootloader;
        return [this.statusPayload()];

      case SwarmitPayloadType.SWARMIT_RESET:
        // seta a pose conhecida (o backend informa x/y) e volta ao bootloader
        this.robot.pos_x = cmd.pos_x;
        this.robot.pos_y = cmd.pos_y;
        this._status = SwarmitStatusType.Bootloader;
        return [this.statusPayload()];

      case SwarmitPayloadType.SWARMIT_MESSAGE:
      case SwarmitPayloadType.SWARMIT_LH2_CALIBRATION:
      case SwarmitPayloadType.SWARMIT_LH2_CAPTURE:
        // aceitos (no-op coerente); sem resposta obrigatória
        return [];

      default:
        // OTA_*_ACK / STATUS(subida) / EVENT_LOG não descem — ignora
        return [];
    }
  }
}
