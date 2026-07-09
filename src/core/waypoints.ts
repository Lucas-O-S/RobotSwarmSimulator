import { normalizeAngle, Robot } from './Robot';
import { ControlModeType } from './types';

// Controlador de rota do modo AUTO: gira em direção ao waypoint atual e
// avança; dentro do threshold, incrementa waypoint_idx; para no fim da lista.

const ANGLE_TOLERANCE_RAD = 0.15; // ~8.6° — acima disso, gira no lugar
const TURN_PWM_MAX = 60;
const FORWARD_PWM = 100;
const K_TURN = 200; // ganho proporcional (pwm por rad de erro)

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Aplica um passo do controlador AUTO, escrevendo direto nos PWMs.
 *  Não faz nada se o robô não estiver em AUTO. */
export function applyWaypointController(robot: Robot): void {
  if (robot.mode !== ControlModeType.Auto) return;

  const target = robot.waypoints[robot.waypoint_idx];
  if (!target) {
    // fim da lista (ou lista vazia): para
    robot.pwm_left = 0;
    robot.pwm_right = 0;
    return;
  }

  const dx = target.x - robot.pos_x;
  const dy = target.y - robot.pos_y;
  const dist = Math.hypot(dx, dy);

  if (dist <= robot.waypoint_threshold) {
    // chegou: avança pro próximo waypoint (mira no próximo tick)
    robot.waypoint_idx += 1;
    if (robot.waypoint_idx >= robot.waypoints.length) {
      robot.pwm_left = 0;
      robot.pwm_right = 0;
    }
    return;
  }

  const desired = Math.atan2(dy, dx);
  const err = normalizeAngle(desired - robot.theta);

  if (Math.abs(err) > ANGLE_TOLERANCE_RAD) {
    // gira no lugar, proporcional ao erro (evita oscilar em volta do alvo)
    const turn = clamp(K_TURN * err, -TURN_PWM_MAX, TURN_PWM_MAX);
    robot.pwm_left = Math.round(-turn);
    robot.pwm_right = Math.round(turn);
  } else {
    // avança com pequena correção diferencial de heading
    const corr = clamp(K_TURN * err, -20, 20);
    robot.pwm_left = Math.round(clamp(FORWARD_PWM - corr, -127, 127));
    robot.pwm_right = Math.round(clamp(FORWARD_PWM + corr, -127, 127));
  }
}
