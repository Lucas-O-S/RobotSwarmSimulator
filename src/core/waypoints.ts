import { normalizeAngle, Robot } from './Robot';
import { ControlModeType } from './types';

// Controlador de rota do modo AUTO: gira em direção ao waypoint atual e
// avança; dentro do threshold, incrementa waypoint_idx.
// Fim da lista (Fase 6): com `robot.loop` false, PARA de forma estável;
// com `robot.loop` true, waypoint_idx volta a 0 e a rota recomeça.

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

  const wps = robot.waypoints;
  const len = wps.length;

  // Consome NO MESMO tick todos os waypoints já dentro do threshold
  // (retarget imediato — sem 1 tick de deriva com o PWM antigo entre um
  // waypoint e o próximo, o que causava jitter na chegada). O limite de
  // `len` saltos evita loop infinito quando a rota é em LOOP e todos os
  // pontos estão dentro do raio.
  for (let hops = 0; hops <= len; hops++) {
    const target = wps[robot.waypoint_idx];
    if (!target) break; // fim da lista (sem loop) ou lista vazia

    const dx = target.x - robot.pos_x;
    const dy = target.y - robot.pos_y;
    const dist = Math.hypot(dx, dy);

    if (dist > robot.waypoint_threshold) {
      // dirige em direção ao alvo corrente
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
      return;
    }

    // chegou neste waypoint: avança (ciclando quando a rota é em LOOP)
    robot.waypoint_idx = robot.loop
      ? (robot.waypoint_idx + 1) % len
      : robot.waypoint_idx + 1;
  }

  // Sem alvo perseguível — rota concluída (sem loop), lista vazia, ou loop
  // degenerado com todos os pontos dentro do raio: para de forma ESTÁVEL.
  robot.pwm_left = 0;
  robot.pwm_right = 0;
}
