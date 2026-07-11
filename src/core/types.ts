// Tipos base do núcleo de simulação (Fase 1 — headless).
// Unidades: milímetros (mm) e segundos; ângulos internos em RADIANOS
// (o cenário JSON usa graus e a conversão acontece na carga).

export interface Vec2 {
  x: number;
  y: number;
}

/** Tipo de aplicação embarcada (idêntico ao enum do backend/firmware). */
export enum ApplicationType {
  DotBot = 0,
  SailBot = 1,
  Freebot = 2,
  XGO = 3,
  LH2_mini_mote = 4,
}

/** Modo de controle (espelha o payload CONTROL_MODE 0x07). */
export enum ControlModeType {
  Manual = 0,
  Auto = 1,
}

/** Envelhecimento de estado visto pelo controller (seção 4.5 do PLANO). */
export enum RobotStatus {
  Active = 0,
  Inactive = 1,
  Lost = 2,
}

/** Obstáculo retangular alinhado aos eixos (AABB), em mm. */
export interface Obstacle {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArenaConfig {
  width: number;  // mm
  height: number; // mm
  grid: number;   // mm (só p/ desenho nas fases futuras)
}

export interface NetworkConfig {
  id: string;           // 4 hex, ex.: "1200"
  gateway_addr: string; // 16 hex
}

export interface SimConfig {
  tick_hz: number;
  advertise_hz: number;          // usado a partir da Fase 5 (telemetria)
  battery_drain_per_min: number; // % por minuto
  pdr_percent: number;           // reservado (fidelidade de rede)
  slot_latency_ms: number;       // reservado (fidelidade de rede)
}

/** Cor do LED (CMD_RGB_LED 0x01). */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Snapshot do estado observável do robô (campos do DOTBOT_ADVERTISEMENT). */
export interface RobotState {
  address: string;
  application: ApplicationType;
  mode: ControlModeType;
  status: RobotStatus;
  pos_x: number;        // mm
  pos_y: number;        // mm
  theta: number;        // rad
  pwm_left: number;     // -127..127
  pwm_right: number;    // -127..127
  encoder_left: number; // mm acumulados (com sinal)
  encoder_right: number;
  battery: number;      // 0..100
  rgb: RgbColor;
  waypoints: Vec2[];
  waypoint_idx: number;
  waypoint_threshold: number; // mm
}

// ---------------------------------------------------------------------------
// Schema do cenário JSON — bate EXATAMENTE com a seção 7 do PLANO.md.
// ---------------------------------------------------------------------------

export interface ScenarioObstacle {
  id: string;
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
}

/** Waypoint persistido no cenário (Fase 3 — editor). */
export interface ScenarioWaypoint {
  x_mm: number;
  y_mm: number;
}

export interface ScenarioRobot {
  address: string;     // 16 hex
  application: number; // ApplicationType
  mode: number;        // ControlModeType
  start: { x_mm: number; y_mm: number; theta_deg: number };
  battery: number;
  /** Rota do modo AUTO (OPCIONAL — Fase 3). Cenários antigos, sem o campo,
   *  continuam carregando (retrocompatível). Só é seguida se mode=1 (Auto). */
  waypoints?: ScenarioWaypoint[];
  /** Raio de chegada do waypoint, em mm (OPCIONAL; default 50). */
  waypoint_threshold_mm?: number;
}

export interface Scenario {
  version: number;
  network: NetworkConfig;
  arena: { width_mm: number; height_mm: number; grid_mm: number };
  obstacles: ScenarioObstacle[];
  robots: ScenarioRobot[];
  sim: SimConfig;
}
