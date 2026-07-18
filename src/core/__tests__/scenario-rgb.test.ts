// Cor do LED (rgb) no cenário — parte da configuração completa exportável.

import { describe, expect, it } from 'vitest';
import { loadScenario, serializeScenario } from '../scenario';
import { Scenario } from '../types';

function base(): Scenario {
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
      battery_drain_per_min: 1,
      pdr_percent: 100,
      slot_latency_ms: 0,
    },
  };
}

describe('Cenário — cor do LED (rgb)', () => {
  it('rgb ≠ preto sobrevive ao round-trip', () => {
    const s = base();
    s.robots[0].rgb = { r: 10, g: 200, b: 30 };
    const out = serializeScenario(loadScenario(s));
    expect(out.robots[0].rgb).toEqual({ r: 10, g: 200, b: 30 });
  });

  it('rgb preto (LED apagado) não é emitido — retrocompatível', () => {
    const s = base();
    s.robots[0].rgb = { r: 0, g: 0, b: 0 };
    const out = serializeScenario(loadScenario(s));
    expect('rgb' in out.robots[0]).toBe(false);
  });

  it('cenário sem rgb continua válido', () => {
    const out = serializeScenario(loadScenario(base()));
    expect('rgb' in out.robots[0]).toBe(false);
  });

  it('rgb fora de 0..255 é rejeitado', () => {
    const s = base();
    (s.robots[0] as { rgb: unknown }).rgb = { r: 999, g: 0, b: 0 };
    expect(() => loadScenario(s)).toThrow(/rgb/);
  });
});
