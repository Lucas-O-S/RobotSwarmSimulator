import { describe, expect, it } from 'vitest';
import { MAX_FRAME_DT_S, MAX_TICKS_PER_FRAME, planTicks } from '../simLoop';

// tick de 50 Hz, como no cenário de exemplo
const TICK_DT = 1 / 50;

describe('planTicks (passo fixo com acumulador)', () => {
  it('frame típico de 60 fps rende 0–1 tick e guarda o resto', () => {
    // 16.67 ms < 20 ms → 0 ticks, acumula
    const a = planTicks(0, 1 / 60, TICK_DT);
    expect(a.ticks).toBe(0);
    expect(a.acc).toBeCloseTo(1 / 60, 10);

    // próximo frame: 2/60 s ≈ 33.3 ms → 1 tick, resto de ~13.3 ms
    const b = planTicks(a.acc, 1 / 60, TICK_DT);
    expect(b.ticks).toBe(1);
    expect(b.acc).toBeCloseTo(2 / 60 - TICK_DT, 10);
  });

  it('o tempo simulado converge pro tempo real (sem drift)', () => {
    let acc = 0;
    let ticks = 0;
    const frames = 300; // 5 s a 60 fps
    for (let i = 0; i < frames; i++) {
      const plan = planTicks(acc, 1 / 60, TICK_DT);
      acc = plan.acc;
      ticks += plan.ticks;
    }
    const simTime = ticks * TICK_DT;
    expect(Math.abs(simTime - frames / 60)).toBeLessThanOrEqual(TICK_DT);
  });

  it('clampa dt gigante (aba em background) e respeita o teto de ticks', () => {
    // 10 s de dt → clampado pra MAX_FRAME_DT_S
    const a = planTicks(0, 10, TICK_DT);
    expect(a.ticks).toBe(Math.floor(MAX_FRAME_DT_S / TICK_DT));
    expect(a.ticks).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);

    // teto explícito de ticks: descarta o excesso e zera o acumulador
    const b = planTicks(0, 1, 0.001, 1, 10);
    expect(b.ticks).toBe(10);
    expect(b.acc).toBe(0);
  });

  it('dt negativo (timestamp fora de ordem) não quebra', () => {
    const p = planTicks(0.01, -5, TICK_DT);
    expect(p.ticks).toBe(0);
    expect(p.acc).toBeCloseTo(0.01, 10);
  });
});
