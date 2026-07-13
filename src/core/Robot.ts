import {
  ApplicationType,
  ControlModeType,
  RgbColor,
  RobotState,
  RobotStatus,
  Vec2,
} from './types';

// Parâmetros da cinemática SIMPLES de tração diferencial (não é física
// realista — fidelidade funcional apenas, conforme o PLANO).
export const PWM_MAX = 127;               // CMD_MOVE_RAW usa int8
export const MAX_WHEEL_SPEED_MM_S = 500;  // pwm ±127 → ±500 mm/s
export const WHEEL_BASE_MM = 45;          // distância entre rodas
export const ROBOT_RADIUS_MM = 35;        // raio usado na colisão

/** Normaliza um ângulo para (-PI, PI]. */
export function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

function clampPwm(v: number): number {
  return Math.max(-PWM_MAX, Math.min(PWM_MAX, Math.round(v)));
}

export interface RobotInit {
  address: string;
  application?: ApplicationType;
  mode?: ControlModeType;
  x: number;      // mm
  y: number;      // mm
  theta: number;  // rad
  battery?: number;
}

export class Robot {
  readonly address: string;
  application: ApplicationType;
  mode: ControlModeType;

  // --- Ciclo de vida / liveness (Fase 6) -----------------------------------
  // O robô fica OFFLINE por: (a) bateria chegar a 0, ou (b) injeção de falha
  // manual (setOnline(false)). Offline = fora da rede Mari: o SimGateway para
  // de emitir advertise/keep-alive dele e emite NODE_LEFT uma vez; ao voltar,
  // re-emite NODE_JOINED e retoma o loop.
  //
  // FRONTEIRA COM O BACKEND (seção 4.5 do PLANO): os timers de envelhecimento
  // ACTIVE → INACTIVE (5 s sem telemetria) → LOST (60 s) vivem no
  // controller/backend. O simulador só modela o GATILHO de rede (o robô que
  // some/volta) — nunca esses timers.
  private faultOffline = false;

  pos_x: number;
  pos_y: number;
  theta: number; // rad

  pwm_left = 0;
  pwm_right = 0;
  encoder_left = 0;  // mm acumulados por roda (com sinal)
  encoder_right = 0;
  battery: number;   // 0..100
  rgb: RgbColor = { r: 0, g: 0, b: 0 };

  waypoints: Vec2[] = [];
  waypoint_idx = 0;
  waypoint_threshold = 0; // mm
  /** Rota em LOOP (Fase 6): ao alcançar o último waypoint, `waypoint_idx`
   *  volta a 0 e a rota recomeça. false (default) = para no fim. */
  loop = false;

  constructor(init: RobotInit) {
    this.address = init.address;
    this.application = init.application ?? ApplicationType.DotBot;
    this.mode = init.mode ?? ControlModeType.Manual;
    this.pos_x = init.x;
    this.pos_y = init.y;
    this.theta = normalizeAngle(init.theta);
    this.battery = init.battery ?? 100;
  }

  /** true quando o robô está na rede: bateria > 0 E sem falha injetada. */
  get online(): boolean {
    return !this.faultOffline && this.battery > 0;
  }

  /** Injeção de falha (Fase 6): derruba (false) / religa (true) o robô na
   *  rede. Religar NÃO ressuscita bateria zerada — sem energia não há rádio. */
  setOnline(v: boolean): void {
    this.faultOffline = !v;
  }

  /** Visão LOCAL coerente do status: Active na rede, Inactive fora dela.
   *  O INACTIVE/LOST "de verdade" é decisão do controller/backend, pelos
   *  timers da seção 4.5 do PLANO — este campo é só o espelho no snapshot. */
  get status(): RobotStatus {
    return this.online ? RobotStatus.Active : RobotStatus.Inactive;
  }

  /** CMD_MOVE_RAW (0x00): joystick. Entra em MANUAL; left_y/right_y viram
   *  os PWMs das rodas esquerda/direita (left_x/right_x são ignorados,
   *  como no firmware DotBot de tração diferencial). */
  applyMoveRaw(left_x: number, left_y: number, right_x: number, right_y: number): void {
    void left_x;
    void right_x;
    this.mode = ControlModeType.Manual;
    this.pwm_left = clampPwm(left_y);
    this.pwm_right = clampPwm(right_y);
  }

  /** LH2_WAYPOINTS (0x08): carrega a rota e entra em AUTO. */
  setWaypoints(list: Vec2[], threshold: number): void {
    this.mode = ControlModeType.Auto;
    this.waypoints = list.map((p) => ({ x: p.x, y: p.y }));
    this.waypoint_idx = 0;
    this.waypoint_threshold = threshold;
  }

  /** CMD_RGB_LED (0x01). */
  setRgb(r: number, g: number, b: number): void {
    this.rgb = { r, g, b };
  }

  /** CONTROL_MODE (0x07). Ao entrar em AUTO os PWMs passam a ser do
   *  controlador de waypoints; ao voltar pra MANUAL o robô para até o
   *  próximo move-raw. */
  setMode(mode: ControlModeType): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.pwm_left = 0;
    this.pwm_right = 0;
  }

  /** Integra um passo de dt segundos: pwm → velocidade de roda →
   *  pose (x, y, theta) + encoders + decaimento linear de bateria.
   *  A colisão é resolvida depois, pelo World. */
  step(dt: number, batteryDrainPerMin: number): void {
    if (this.battery <= 0) {
      // sem bateria, o robô não se move
      this.pwm_left = 0;
      this.pwm_right = 0;
    }

    const vl = (this.pwm_left / PWM_MAX) * MAX_WHEEL_SPEED_MM_S;  // mm/s
    const vr = (this.pwm_right / PWM_MAX) * MAX_WHEEL_SPEED_MM_S; // mm/s
    const v = (vl + vr) / 2;                 // velocidade linear
    const w = (vr - vl) / WHEEL_BASE_MM;     // velocidade angular (rad/s)

    this.pos_x += v * Math.cos(this.theta) * dt;
    this.pos_y += v * Math.sin(this.theta) * dt;
    this.theta = normalizeAngle(this.theta + w * dt);

    this.encoder_left += vl * dt;
    this.encoder_right += vr * dt;

    this.battery = Math.max(0, this.battery - (batteryDrainPerMin * dt) / 60);
  }

  /** Snapshot imutável do estado (base do DOTBOT_ADVERTISEMENT futuro). */
  snapshot(): RobotState {
    return {
      address: this.address,
      application: this.application,
      mode: this.mode,
      status: this.status,
      online: this.online,
      loop: this.loop,
      pos_x: this.pos_x,
      pos_y: this.pos_y,
      theta: this.theta,
      pwm_left: this.pwm_left,
      pwm_right: this.pwm_right,
      encoder_left: this.encoder_left,
      encoder_right: this.encoder_right,
      battery: this.battery,
      rgb: { ...this.rgb },
      waypoints: this.waypoints.map((p) => ({ ...p })),
      waypoint_idx: this.waypoint_idx,
      waypoint_threshold: this.waypoint_threshold,
    };
  }
}
