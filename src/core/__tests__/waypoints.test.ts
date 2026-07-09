import { describe, expect, it } from 'vitest';
import { Robot } from '../Robot';
import { World } from '../World';
import { ControlModeType } from '../types';

function makeWorld(robots: Robot[]): World {
  return new World({
    arena: { width: 4000, height: 4000, grid: 100 },
    network: { id: '1200', gateway_addr: '0000000000000001' },
    sim: {
      tick_hz: 50,
      advertise_hz: 2,
      battery_drain_per_min: 1,
      pdr_percent: 100,
      slot_latency_ms: 0,
    },
    robots,
  });
}

describe('Modo AUTO — controlador de waypoints', () => {
  it('setWaypoints entra em AUTO e zera waypoint_idx', () => {
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 200, y: 200, theta: 0 });
    robot.setWaypoints([{ x: 700, y: 200 }], 40);
    expect(robot.mode).toBe(ControlModeType.Auto);
    expect(robot.waypoint_idx).toBe(0);
    expect(robot.waypoint_threshold).toBe(40);
  });

  it('alcança o 1º waypoint (idx avança), segue pro 2º e para no fim', () => {
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 200, y: 200, theta: 0 });
    const world = makeWorld([robot]);
    // 2º waypoint exige girar ~90° — exercita a rotação do controlador
    robot.setWaypoints([{ x: 700, y: 200 }, { x: 700, y: 700 }], 40);

    let reachedFirstAt = -1;
    for (let i = 0; i < 50 * 20; i++) {
      world.tick();
      if (reachedFirstAt < 0 && robot.waypoint_idx >= 1) reachedFirstAt = i;
      if (robot.waypoint_idx >= 2) break;
    }

    expect(reachedFirstAt).toBeGreaterThan(0); // 1º waypoint alcançado
    expect(robot.waypoint_idx).toBe(2);        // rota concluída

    // no fim da lista, o robô fica parado
    const { pos_x, pos_y } = robot;
    world.step(1);
    expect(robot.pwm_left).toBe(0);
    expect(robot.pwm_right).toBe(0);
    expect(robot.pos_x).toBeCloseTo(pos_x, 6);
    expect(robot.pos_y).toBeCloseTo(pos_y, 6);

    // parou dentro do raio do último waypoint (com folga de 1 tick)
    const dist = Math.hypot(robot.pos_x - 700, robot.pos_y - 700);
    expect(dist).toBeLessThanOrEqual(40 + 10);
  });

  it('lista vazia mantém o robô parado em AUTO', () => {
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 200, y: 200, theta: 0 });
    const world = makeWorld([robot]);
    robot.setWaypoints([], 40);
    world.step(1);
    expect(robot.pos_x).toBeCloseTo(200, 6);
    expect(robot.pos_y).toBeCloseTo(200, 6);
  });
});
