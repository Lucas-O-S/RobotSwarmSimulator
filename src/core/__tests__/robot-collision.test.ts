// Fase 8 — colisão robô × robô: os robôs não se atravessam mais.

import { describe, expect, it } from 'vitest';
import { Robot, ROBOT_RADIUS_MM } from '../Robot';
import { separateRobots } from '../physics';
import { World } from '../World';
import { ArenaConfig, SimConfig } from '../types';

const ARENA: ArenaConfig = { width: 4000, height: 4000, grid: 100 };
const SIM: SimConfig = {
  tick_hz: 50,
  advertise_hz: 2,
  battery_drain_per_min: 0,
  pdr_percent: 100,
  slot_latency_ms: 0,
};
const MIN_DIST = ROBOT_RADIUS_MM * 2; // 70 mm

function dist(a: { pos_x: number; pos_y: number }, b: { pos_x: number; pos_y: number }): number {
  return Math.hypot(a.pos_x - b.pos_x, a.pos_y - b.pos_y);
}

describe('separateRobots (unitário)', () => {
  it('separa dois corpos sobrepostos até ~2·raio', () => {
    const bodies = [
      { x: 500, y: 500 },
      { x: 510, y: 500 }, // sobrepostos (dist 10 << 70)
    ];
    separateRobots(bodies, ROBOT_RADIUS_MM, [], ARENA);
    const d = Math.hypot(bodies[0].x - bodies[1].x, bodies[0].y - bodies[1].y);
    expect(d).toBeGreaterThanOrEqual(MIN_DIST - 1);
  });

  it('sobreposição exata (mesma posição) não gera NaN e separa', () => {
    const bodies = [
      { x: 1000, y: 1000 },
      { x: 1000, y: 1000 },
    ];
    separateRobots(bodies, ROBOT_RADIUS_MM, [], ARENA);
    const d = Math.hypot(bodies[0].x - bodies[1].x, bodies[0].y - bodies[1].y);
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBeGreaterThan(0);
  });
});

describe('World — robôs não se atravessam', () => {
  it('dois robôs em rota de colisão param sem sobrepor nem cruzar', () => {
    const a = new Robot({ address: 'AAAAAAAAAAAAAAAA', x: 500, y: 500, theta: 0, battery: 100 });
    const b = new Robot({ address: 'BBBBBBBBBBBBBBBB', x: 800, y: 500, theta: Math.PI, battery: 100 });
    const world = new World({
      arena: ARENA,
      network: { id: '1200', gateway_addr: '0000000000000001' },
      sim: SIM,
      robots: [a, b],
    });

    a.applyMoveRaw(0, 100, 0, 100); // A anda pra +x
    b.applyMoveRaw(0, 100, 0, 100); // B (theta=180°) anda pra -x → convergem

    world.step(5);

    expect(dist(a, b)).toBeGreaterThanOrEqual(MIN_DIST - 1); // não se sobrepõem
    expect(a.pos_x).toBeLessThan(b.pos_x); // A não atravessou pro outro lado
  });

  it('sem colisão robô-robô, cada um segue livre', () => {
    const a = new Robot({ address: 'AAAAAAAAAAAAAAAA', x: 500, y: 500, theta: 0, battery: 100 });
    const b = new Robot({ address: 'BBBBBBBBBBBBBBBB', x: 500, y: 2000, theta: 0, battery: 100 });
    const world = new World({
      arena: ARENA,
      network: { id: '1200', gateway_addr: '0000000000000001' },
      sim: SIM,
      robots: [a, b],
    });
    a.applyMoveRaw(0, 100, 0, 100);
    const x0 = a.pos_x;
    world.step(2);
    expect(a.pos_x).toBeGreaterThan(x0 + 100); // andou sem ser bloqueado por B
  });
});
