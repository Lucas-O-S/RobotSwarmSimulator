// Fase 3 — persistência de mode/waypoints no cenário (extensão RETRO-
// compatível do schema da seção 7). Cenários antigos, sem os campos novos,
// continuam carregando e serializando idênticos ao formato antigo.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WAYPOINT_THRESHOLD_MM,
  loadScenario,
  serializeScenario,
} from '../scenario';
import { ControlModeType, Scenario } from '../types';

function baseScenario(): Scenario {
  return {
    version: 1,
    network: { id: '1200', gateway_addr: '0000000000000001' },
    arena: { width_mm: 2000, height_mm: 2000, grid_mm: 100 },
    obstacles: [],
    robots: [
      {
        address: 'BDF2B04BC00D2725',
        application: 0,
        mode: 0,
        start: { x_mm: 300, y_mm: 300, theta_deg: 0 },
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
}

describe('cenário com waypoints (Fase 3)', () => {
  it('carrega waypoints e threshold do JSON', () => {
    const s = baseScenario();
    s.robots[0].mode = ControlModeType.Auto;
    s.robots[0].waypoints = [
      { x_mm: 1500, y_mm: 300 },
      { x_mm: 1500, y_mm: 1700 },
    ];
    s.robots[0].waypoint_threshold_mm = 80;

    const world = loadScenario(s);
    const r = world.robots[0];
    expect(r.mode).toBe(ControlModeType.Auto);
    expect(r.waypoints).toEqual([
      { x: 1500, y: 300 },
      { x: 1500, y: 1700 },
    ]);
    expect(r.waypoint_threshold).toBe(80);
  });

  it('usa o threshold default quando o campo não vem', () => {
    const s = baseScenario();
    s.robots[0].waypoints = [{ x_mm: 500, y_mm: 500 }];
    const world = loadScenario(s);
    expect(world.robots[0].waypoint_threshold).toBe(DEFAULT_WAYPOINT_THRESHOLD_MM);
  });

  it('NÃO força AUTO: waypoints persistidos com mode=0 mantêm Manual', () => {
    const s = baseScenario();
    s.robots[0].mode = ControlModeType.Manual;
    s.robots[0].waypoints = [{ x_mm: 500, y_mm: 500 }];
    const world = loadScenario(s);
    expect(world.robots[0].mode).toBe(ControlModeType.Manual);
    expect(world.robots[0].waypoints).toHaveLength(1);
  });

  it('retrocompatível: cenário antigo (sem os campos) carrega e serializa sem eles', () => {
    const world = loadScenario(baseScenario());
    expect(world.robots[0].waypoints).toEqual([]);

    const out = serializeScenario(world);
    expect(out.robots[0]).not.toHaveProperty('waypoints');
    expect(out.robots[0]).not.toHaveProperty('waypoint_threshold_mm');
  });

  it('round-trip: serializa e recarrega mantendo rota, threshold e mode', () => {
    const s = baseScenario();
    s.robots[0].mode = ControlModeType.Auto;
    s.robots[0].waypoints = [{ x_mm: 1500, y_mm: 300 }];
    s.robots[0].waypoint_threshold_mm = 50;

    const out = serializeScenario(loadScenario(s));
    expect(out.robots[0].mode).toBe(ControlModeType.Auto);
    expect(out.robots[0].waypoints).toEqual([{ x_mm: 1500, y_mm: 300 }]);
    expect(out.robots[0].waypoint_threshold_mm).toBe(50);

    // e o mundo recarregado segue a rota de verdade (sem gambiarra de setup)
    const world2 = loadScenario(out);
    world2.step(10);
    const r = world2.robots[0];
    expect(Math.hypot(r.pos_x - 1500, r.pos_y - 300)).toBeLessThanOrEqual(60);
  });

  it('rejeita waypoints malformados com mensagem amigável', () => {
    const s = baseScenario();
    // @ts-expect-error — formato inválido de propósito
    s.robots[0].waypoints = [{ x: 1, y: 2 }];
    expect(() => loadScenario(s)).toThrow(/waypoints/);

    const s2 = baseScenario();
    // @ts-expect-error — não é lista
    s2.robots[0].waypoints = 'oops';
    expect(() => loadScenario(s2)).toThrow(/deve ser uma lista/);
  });
});
