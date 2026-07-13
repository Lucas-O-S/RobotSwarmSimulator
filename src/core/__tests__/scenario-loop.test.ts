// Fase 6 — campo opcional `loop` no cenário (retrocompatível) e validação
// do cenário de enxame (scenarios/enxame.json).

import { describe, expect, it } from 'vitest';
import enxameJson from '../../../scenarios/enxame.json';
import { loadScenario, serializeScenario } from '../scenario';
import { ControlModeType, Scenario } from '../types';

const BASE: Scenario = {
  version: 1,
  network: { id: '1200', gateway_addr: '0000000000000001' },
  arena: { width_mm: 2000, height_mm: 2000, grid_mm: 100 },
  obstacles: [],
  robots: [
    {
      address: 'BDF2B04BC00D2725',
      application: 0,
      mode: 1,
      start: { x_mm: 300, y_mm: 300, theta_deg: 0 },
      battery: 100,
      waypoints: [{ x_mm: 1500, y_mm: 300 }],
      waypoint_threshold_mm: 50,
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

function clone(s: Scenario): Scenario {
  return JSON.parse(JSON.stringify(s)) as Scenario;
}

describe('Cenário — campo opcional loop (Fase 6)', () => {
  it('sem o campo, loop default é false (retrocompatível)', () => {
    const world = loadScenario(clone(BASE));
    expect(world.robots[0].loop).toBe(false);
  });

  it('loop: true carrega no robô e sobrevive ao round-trip', () => {
    const s = clone(BASE);
    s.robots[0].loop = true;
    const world = loadScenario(s);
    expect(world.robots[0].loop).toBe(true);

    const out = serializeScenario(world);
    expect(out.robots[0].loop).toBe(true);
    expect(loadScenario(out).robots[0].loop).toBe(true);
  });

  it('loop false/ausente NÃO é emitido no JSON salvo (formato antigo intacto)', () => {
    const world = loadScenario(clone(BASE));
    const out = serializeScenario(world);
    expect('loop' in out.robots[0]).toBe(false);
  });

  it('loop não-boolean é rejeitado com erro amigável', () => {
    const s = clone(BASE);
    (s.robots[0] as unknown as { loop: unknown }).loop = 'sim';
    expect(() => loadScenario(s)).toThrow(/loop deve ser boolean/);
  });
});

describe('scenarios/enxame.json — cenário de enxame (Fase 6)', () => {
  it('carrega com 6 robôs, mistura de MANUAL/AUTO (com e sem loop) e barreiras', () => {
    const world = loadScenario(enxameJson as Scenario);
    expect(world.robots).toHaveLength(6);
    expect(world.obstacles.length).toBeGreaterThanOrEqual(2);

    const autos = world.robots.filter((r) => r.mode === ControlModeType.Auto);
    const manuals = world.robots.filter((r) => r.mode === ControlModeType.Manual);
    expect(autos.length).toBeGreaterThanOrEqual(2);
    expect(manuals.length).toBeGreaterThanOrEqual(2);
    expect(autos.some((r) => r.loop)).toBe(true);
    expect(autos.some((r) => !r.loop)).toBe(true);
    // todo robô em AUTO do enxame tem rota
    for (const r of autos) expect(r.waypoints.length).toBeGreaterThan(0);

    // addresses únicos, 16 hex
    const addrs = new Set(world.robots.map((r) => r.address));
    expect(addrs.size).toBe(6);
    for (const a of addrs) expect(a).toMatch(/^[0-9A-F]{16}$/);
  });

  it('simula 10 s sem ninguém sair da arena nem cair da rede', () => {
    const world = loadScenario(enxameJson as Scenario);
    world.step(10);
    for (const r of world.robots) {
      expect(r.online).toBe(true);
      expect(r.pos_x).toBeGreaterThanOrEqual(0);
      expect(r.pos_x).toBeLessThanOrEqual(world.arena.width);
      expect(r.pos_y).toBeGreaterThanOrEqual(0);
      expect(r.pos_y).toBeLessThanOrEqual(world.arena.height);
    }
  });
});
