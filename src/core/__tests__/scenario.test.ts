import { describe, expect, it } from 'vitest';
import { loadScenario, serializeScenario } from '../scenario';
import { ApplicationType, ControlModeType, Scenario } from '../types';

const scenario: Scenario = {
  version: 1,
  network: { id: '1200', gateway_addr: '0000000000000001' },
  arena: { width_mm: 4000, height_mm: 4000, grid_mm: 100 },
  obstacles: [{ id: 'wall-1', x_mm: 1000, y_mm: 500, w_mm: 200, h_mm: 1500 }],
  robots: [
    {
      address: 'BDF2B04BC00D2725',
      application: 0,
      mode: 0,
      start: { x_mm: 200, y_mm: 200, theta_deg: 90 },
      battery: 100,
    },
  ],
  sim: {
    tick_hz: 50,
    advertise_hz: 2,
    battery_drain_per_min: 1.0,
    pdr_percent: 100,
    slot_latency_ms: 0,
  },
};

describe('scenario — load/serialize (schema seção 7 do PLANO)', () => {
  it('carrega o JSON e converte theta_deg → rad', () => {
    const world = loadScenario(JSON.stringify(scenario));

    expect(world.arena).toEqual({ width: 4000, height: 4000, grid: 100 });
    expect(world.network.id).toBe('1200');
    expect(world.sim.tick_hz).toBe(50);
    expect(world.obstacles).toEqual([{ id: 'wall-1', x: 1000, y: 500, w: 200, h: 1500 }]);

    const robot = world.robots[0];
    expect(robot.address).toBe('BDF2B04BC00D2725');
    expect(robot.application).toBe(ApplicationType.DotBot);
    expect(robot.mode).toBe(ControlModeType.Manual);
    expect(robot.pos_x).toBe(200);
    expect(robot.pos_y).toBe(200);
    expect(robot.theta).toBeCloseTo(Math.PI / 2, 9); // 90° → rad
    expect(robot.battery).toBe(100);
  });

  it('serializa de volta batendo com o schema (rad → theta_deg)', () => {
    const world = loadScenario(scenario);
    const out = serializeScenario(world);

    expect(out.version).toBe(1);
    expect(out.network).toEqual(scenario.network);
    expect(out.arena).toEqual(scenario.arena);
    expect(out.obstacles).toEqual(scenario.obstacles);
    expect(out.sim).toEqual(scenario.sim);
    expect(out.robots[0].address).toBe('BDF2B04BC00D2725');
    expect(out.robots[0].start.x_mm).toBe(200);
    expect(out.robots[0].start.theta_deg).toBeCloseTo(90, 6);
  });

  it('rejeita cenário com version errada ou address inválido', () => {
    expect(() => loadScenario({ ...scenario, version: 2 })).toThrow(/version/);
    expect(() =>
      loadScenario({
        ...scenario,
        robots: [{ ...scenario.robots[0], address: 'XYZ' }],
      }),
    ).toThrow(/hex/);
  });
});
