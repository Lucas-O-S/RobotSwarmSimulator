// Fase 7 — testes do modelo puro de fidelidade de rede (netmodel.ts):
// RNG determinístico, decisão drop/atraso por mensagem e o agendador de
// entregas em tempo simulado (NetChannel). Tudo com seed fixa.

import { describe, expect, it } from 'vitest';

import {
  decideFate,
  isPassthrough,
  mulberry32,
  NetChannel,
  NetParams,
  netParamsFromSim,
} from '../netmodel';

/** Params com defaults "rede perfeita" e overrides pontuais. */
function P(over: Partial<NetParams> = {}): NetParams {
  return { enabled: true, pdr_percent: 100, slot_latency_ms: 0, jitter_ms: 0, ...over };
}

describe('netmodel — mulberry32 (RNG com seed)', () => {
  it('mesma seed → mesma sequência; seeds diferentes → sequências diferentes', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    const seqC = Array.from({ length: 8 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('valores sempre em [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('netmodel — netParamsFromSim / isPassthrough', () => {
  it('defaults retrocompatíveis: net_enabled ausente = true, jitter ausente = 0', () => {
    const p = netParamsFromSim({
      tick_hz: 50,
      advertise_hz: 2,
      battery_drain_per_min: 0,
      pdr_percent: 80,
      slot_latency_ms: 100,
    });
    expect(p).toEqual({ enabled: true, pdr_percent: 80, slot_latency_ms: 100, jitter_ms: 0 });
  });

  it('passthrough: PDR=100/lat=0 (default do exemplo.json) OU enabled=false', () => {
    expect(isPassthrough(P())).toBe(true);
    expect(isPassthrough(P({ enabled: false, pdr_percent: 0, slot_latency_ms: 500 }))).toBe(true);
    expect(isPassthrough(P({ pdr_percent: 99 }))).toBe(false);
    expect(isPassthrough(P({ slot_latency_ms: 1 }))).toBe(false);
    expect(isPassthrough(P({ jitter_ms: 1 }))).toBe(false);
  });
});

describe('netmodel — decideFate (drop/atraso por mensagem)', () => {
  it('PDR=0 → TODAS dropam; PDR=100 → NENHUMA dropa', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 500; i++) {
      expect(decideFate(P({ pdr_percent: 0 }), rng)).toEqual({ drop: true });
    }
    for (let i = 0; i < 500; i++) {
      expect(decideFate(P({ pdr_percent: 100 }), rng).drop).toBe(false);
    }
  });

  it('enabled=false ignora PDR/latência (kill-switch)', () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 100; i++) {
      const fate = decideFate(P({ enabled: false, pdr_percent: 0, slot_latency_ms: 999 }), rng);
      expect(fate).toEqual({ drop: false, delay_s: 0 });
    }
  });

  it('PDR intermediário com seed fixa: fração de drops dentro do esperado', () => {
    const rng = mulberry32(42);
    const N = 2000;
    let drops = 0;
    for (let i = 0; i < N; i++) {
      if (decideFate(P({ pdr_percent: 30 }), rng).drop) drops++;
    }
    // esperado: 70% de drops; tolerância ±5 pontos (binomial, sd ≈ 1%)
    expect(drops / N).toBeGreaterThan(0.65);
    expect(drops / N).toBeLessThan(0.75);
  });

  it('latência: atraso = slot_latency_ms fixo; jitter soma uniforme [0, jitter_ms]', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const fate = decideFate(P({ slot_latency_ms: 150 }), rng);
      expect(fate).toEqual({ drop: false, delay_s: 0.15 });
    }
    const delays = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const fate = decideFate(P({ slot_latency_ms: 63, jitter_ms: 87 }), rng);
      if (fate.drop) throw new Error('não devia dropar com PDR=100');
      // faixa TSCH da seção 4.6: 63 ms base + jitter até 87 → [63, 150) ms
      expect(fate.delay_s).toBeGreaterThanOrEqual(0.063);
      expect(fate.delay_s).toBeLessThan(0.15);
      delays.add(fate.delay_s);
    }
    expect(delays.size).toBeGreaterThan(1); // jitter de fato varia
  });

  it('é determinístico: mesma seed + mesma sequência de params ⇒ mesmos destinos', () => {
    const run = () => {
      const rng = mulberry32(99);
      return Array.from({ length: 100 }, () =>
        decideFate(P({ pdr_percent: 50, slot_latency_ms: 80, jitter_ms: 40 }), rng),
      );
    };
    expect(run()).toEqual(run());
  });
});

describe('netmodel — NetChannel (agendador em tempo simulado)', () => {
  it('passthrough: entrega SÍNCRONA e em ordem (baseline preservado)', () => {
    const out: string[] = [];
    const ch = new NetChannel<string>(1, (m) => out.push(m));
    ch.send('a', 0, P());
    expect(out).toEqual(['a']); // síncrono, sem esperar advanceTo
    ch.send('b', 0.5, P({ enabled: false, pdr_percent: 0 }));
    expect(out).toEqual(['a', 'b']);
    expect(ch.stats).toEqual({ sent: 2, delivered: 2, dropped: 0, pending: 0 });
  });

  it('mensagem atrasada só é entregue quando o tempo simulado vence o atraso', () => {
    const out: string[] = [];
    const ch = new NetChannel<string>(1, (m) => out.push(m));
    ch.send('a', 0, P({ slot_latency_ms: 100 })); // vence em t=0.1
    expect(out).toEqual([]);
    ch.advanceTo(0.05);
    expect(out).toEqual([]);
    expect(ch.stats.pending).toBe(1);
    ch.advanceTo(0.1);
    expect(out).toEqual(['a']);
    expect(ch.stats).toEqual({ sent: 1, delivered: 1, dropped: 0, pending: 0 });
  });

  it('entregas respeitam a ordem de TEMPO de entrega (desempate = ordem de envio)', () => {
    const out: string[] = [];
    const ch = new NetChannel<string>(1, (m) => out.push(m));
    ch.send('lenta', 0, P({ slot_latency_ms: 200 }));   // vence em 0.2
    ch.send('rapida', 0.1, P({ slot_latency_ms: 50 })); // vence em 0.15
    ch.send('junto1', 0.1, P({ slot_latency_ms: 100 })); // vence em 0.2
    ch.send('junto2', 0.1, P({ slot_latency_ms: 100 })); // vence em 0.2 (depois)
    ch.advanceTo(1.0);
    expect(out).toEqual(['rapida', 'lenta', 'junto1', 'junto2']);
  });

  it('PDR=0: nada é entregue nem fica pendente (drop conta nos stats)', () => {
    const out: string[] = [];
    const ch = new NetChannel<string>(1, (m) => out.push(m));
    for (let i = 0; i < 20; i++) ch.send(`m${i}`, i, P({ pdr_percent: 0 }));
    ch.advanceTo(1000);
    expect(out).toEqual([]);
    expect(ch.stats).toEqual({ sent: 20, delivered: 0, dropped: 20, pending: 0 });
  });

  it('params mudam AO VIVO por mensagem; agendadas mantêm o atraso decidido', () => {
    const out: string[] = [];
    const ch = new NetChannel<string>(1, (m) => out.push(m));
    ch.send('atrasada', 0, P({ slot_latency_ms: 300 })); // vence em 0.3
    // params mudaram pra rede perfeita: a nova é síncrona, a antiga espera
    ch.send('imediata', 0.1, P());
    expect(out).toEqual(['imediata']);
    ch.advanceTo(0.3);
    expect(out).toEqual(['imediata', 'atrasada']);
  });

  it('clear() descarta as entregas pendentes', () => {
    const out: string[] = [];
    const ch = new NetChannel<string>(1, (m) => out.push(m));
    ch.send('a', 0, P({ slot_latency_ms: 100 }));
    ch.clear();
    ch.advanceTo(10);
    expect(out).toEqual([]);
  });
});
