// Fase 6 — refino do modo AUTO: rota em LOOP (waypoint_idx cicla) vs parar
// no fim, e chegada ESTÁVEL (sem jitter depois de concluir a rota).

import { describe, expect, it } from 'vitest';
import { Robot } from '../Robot';
import { World } from '../World';

const ADDR = 'BDF2B04BC00D2725';

function makeWorld(robots: Robot[]): World {
  return new World({
    arena: { width: 4000, height: 4000, grid: 100 },
    network: { id: '1200', gateway_addr: '0000000000000001' },
    sim: {
      tick_hz: 50,
      advertise_hz: 2,
      battery_drain_per_min: 0,
      pdr_percent: 100,
      slot_latency_ms: 0,
    },
    robots,
  });
}

describe('Modo AUTO — rota em LOOP vs parar no fim (Fase 6)', () => {
  it('loop: waypoint_idx cicla (volta a 0 depois do último) e o robô segue rodando', () => {
    const robot = new Robot({ address: ADDR, x: 200, y: 200, theta: 0 });
    const world = makeWorld([robot]);
    robot.setWaypoints([{ x: 700, y: 200 }, { x: 1200, y: 200 }], 40);
    robot.loop = true;

    const idxSeen: number[] = [];
    let wraps = 0;
    let prevIdx = robot.waypoint_idx;
    for (let i = 0; i < 50 * 60; i++) {
      world.tick();
      if (robot.waypoint_idx !== prevIdx) {
        idxSeen.push(robot.waypoint_idx);
        if (robot.waypoint_idx < prevIdx) wraps++;
        prevIdx = robot.waypoint_idx;
      }
      if (wraps >= 2) break;
    }

    // ciclou pelo menos 2 vezes: …→1→0→1→0…
    expect(wraps).toBeGreaterThanOrEqual(2);
    expect(idxSeen).toContain(0);
    expect(idxSeen).toContain(1);
    // idx nunca sai do range [0, len)
    expect(Math.max(...idxSeen)).toBeLessThan(2);
    // e o robô continua em movimento (não parou no "fim")
    expect(Math.abs(robot.pwm_left) + Math.abs(robot.pwm_right)).toBeGreaterThan(0);
  });

  it('sem loop: para no fim (idx == length) e fica parado — regressão', () => {
    const robot = new Robot({ address: ADDR, x: 200, y: 200, theta: 0 });
    const world = makeWorld([robot]);
    robot.setWaypoints([{ x: 700, y: 200 }], 40);

    for (let i = 0; i < 50 * 20 && robot.waypoint_idx < 1; i++) world.tick();
    expect(robot.waypoint_idx).toBe(1);

    world.step(1);
    expect(robot.pwm_left).toBe(0);
    expect(robot.pwm_right).toBe(0);
  });

  it('chegada estável: depois de concluir, a pose não muda mais (sem jitter)', () => {
    const robot = new Robot({ address: ADDR, x: 200, y: 200, theta: 0 });
    const world = makeWorld([robot]);
    robot.setWaypoints([{ x: 700, y: 200 }], 40);

    for (let i = 0; i < 50 * 20 && robot.waypoint_idx < 1; i++) world.tick();
    const { pos_x, pos_y, theta } = robot;

    world.step(5); // 5 s parado
    expect(robot.pos_x).toBeCloseTo(pos_x, 9);
    expect(robot.pos_y).toBeCloseTo(pos_y, 9);
    expect(robot.theta).toBeCloseTo(theta, 9);
  });

  it('loop degenerado (todos os waypoints dentro do raio) fica parado, sem loop infinito', () => {
    const robot = new Robot({ address: ADDR, x: 500, y: 500, theta: 0 });
    const world = makeWorld([robot]);
    robot.setWaypoints([{ x: 510, y: 500 }, { x: 500, y: 510 }], 100);
    robot.loop = true;

    world.step(1);
    expect(robot.pwm_left).toBe(0);
    expect(robot.pwm_right).toBe(0);
    expect(robot.pos_x).toBeCloseTo(500, 6);
    expect(robot.pos_y).toBeCloseTo(500, 6);
  });
});
