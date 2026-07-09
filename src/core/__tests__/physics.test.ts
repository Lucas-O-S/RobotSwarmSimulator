import { describe, expect, it } from 'vitest';
import { Robot, ROBOT_RADIUS_MM } from '../Robot';
import { World } from '../World';
import { circleIntersectsRect } from '../physics';

function makeWorld(robots: Robot[]): World {
  return new World({
    arena: { width: 2000, height: 2000, grid: 100 },
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

describe('Colisão AABB', () => {
  it('robô dirigindo contra uma barreira NÃO atravessa', () => {
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 300, y: 500, theta: 0 });
    const world = makeWorld([robot]);
    // parede vertical na frente do robô (x: 600..800)
    world.addObstacle({ id: 'wall-1', x: 600, y: 0, w: 200, h: 1000 });

    robot.applyMoveRaw(0, 100, 0, 100);
    for (let i = 0; i < 50 * 5; i++) {
      world.tick();
      // em nenhum tick o círculo do robô pode invadir a parede
      expect(
        circleIntersectsRect(
          { x: robot.pos_x, y: robot.pos_y },
          ROBOT_RADIUS_MM,
          { id: 'wall-1', x: 600, y: 0, w: 200, h: 1000 },
        ),
      ).toBe(false);
    }

    expect(robot.pos_x).toBeGreaterThan(300);              // andou
    expect(robot.pos_x).toBeLessThanOrEqual(600 - ROBOT_RADIUS_MM); // ficou antes da parede
    expect(robot.pos_y).toBeCloseTo(500, 6);
  });

  it('robô fica contido nas bordas da arena', () => {
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 1800, y: 1000, theta: 0 });
    const world = makeWorld([robot]);
    robot.applyMoveRaw(0, 127, 0, 127);
    world.step(3); // iria muito além da parede leste (x = 2000)
    expect(robot.pos_x).toBeLessThanOrEqual(2000 - ROBOT_RADIUS_MM);
  });
});
