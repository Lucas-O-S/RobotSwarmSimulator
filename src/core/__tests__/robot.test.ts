import { describe, expect, it } from 'vitest';
import { Robot } from '../Robot';
import { World } from '../World';
import { ControlModeType } from '../types';

function makeWorld(robots: Robot[], drainPerMin = 1.0): World {
  return new World({
    arena: { width: 4000, height: 4000, grid: 100 },
    network: { id: '1200', gateway_addr: '0000000000000001' },
    sim: {
      tick_hz: 50,
      advertise_hz: 2,
      battery_drain_per_min: drainPerMin,
      pdr_percent: 100,
      slot_latency_ms: 0,
    },
    robots,
  });
}

describe('Robot — move-raw (MANUAL)', () => {
  it('avança na direção do heading após N ticks', () => {
    // heading 90° (+y): andar pra frente deve aumentar só pos_y
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 500, y: 500, theta: Math.PI / 2 });
    const world = makeWorld([robot]);

    robot.applyMoveRaw(0, 100, 0, 100);
    expect(robot.mode).toBe(ControlModeType.Manual);

    world.step(1); // 1 s = 50 ticks
    expect(robot.pos_y).toBeGreaterThan(600); // ~394 mm/s
    expect(robot.pos_x).toBeCloseTo(500, 6);  // não deriva lateralmente
    expect(robot.theta).toBeCloseTo(Math.PI / 2, 6);
  });

  it('acumula encoders com o deslocamento das rodas', () => {
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 500, y: 500, theta: 0 });
    const world = makeWorld([robot]);
    robot.applyMoveRaw(0, 127, 0, 127);
    world.step(1);
    // 127/127 * 500 mm/s * 1 s = 500 mm por roda
    expect(robot.encoder_left).toBeCloseTo(500, 3);
    expect(robot.encoder_right).toBeCloseTo(500, 3);
  });

  it('gira no lugar com PWMs opostos (theta muda, posição não)', () => {
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 500, y: 500, theta: 0 });
    const world = makeWorld([robot]);
    robot.applyMoveRaw(0, -50, 0, 50);
    world.step(0.1);
    expect(robot.pos_x).toBeCloseTo(500, 6);
    expect(robot.pos_y).toBeCloseTo(500, 6);
    expect(robot.theta).toBeGreaterThan(0);
  });
});

describe('Robot — bateria', () => {
  it('decai monotonicamente e satura em 0', () => {
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 500, y: 500, theta: 0, battery: 100 });
    const world = makeWorld([robot], 60); // 60%/min = 1%/s (rápido p/ teste)

    let prev = robot.battery;
    for (let i = 0; i < 200; i++) {
      world.tick();
      expect(robot.battery).toBeLessThan(prev);
      prev = robot.battery;
    }
    expect(robot.battery).toBeCloseTo(96, 1); // 4 s → ~4%

    world.step(200); // muito além da carga
    expect(robot.battery).toBe(0);
  });

  it('sem bateria, o robô para de se mover', () => {
    const robot = new Robot({ address: 'BDF2B04BC00D2725', x: 500, y: 500, theta: 0, battery: 0 });
    const world = makeWorld([robot], 1);
    robot.applyMoveRaw(0, 127, 0, 127);
    world.step(1);
    expect(robot.pos_x).toBeCloseTo(500, 6);
    expect(robot.pos_y).toBeCloseTo(500, 6);
  });
});
