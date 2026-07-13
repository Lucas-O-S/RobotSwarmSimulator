// Fase 7 — Peça 1: fidelidade de rede (PDR + latência de slot), seção 4.6
// do PLANO.
//
// ⚠️ ABSTRAÇÃO LÓGICA, NÃO SIMULAÇÃO DE RÁDIO: o Mari real roda TSCH sobre
// BLE — slots de tempo agendados, com PDR (packet delivery ratio) e latência
// de slot típica de ~63–150 ms dependendo do schedule. Aqui NÃO simulamos
// slots/schedule/rádio: modelamos só o EFEITO observável por mensagem —
// cada mensagem é DESCARTADA com probabilidade (1 − pdr/100) ou ENTREGUE
// após um atraso fixo (slot_latency_ms) + jitter uniforme opcional
// ([0, jitter_ms]). É o suficiente pra testar a robustez do backend a
// perda/atraso, que é o objetivo da fidelidade FUNCIONAL.
//
// Determinismo: nada de Math.random() — o RNG (mulberry32) tem seed
// injetável, então a mesma sequência de mensagens com a mesma seed produz
// exatamente os mesmos drops/atrasos (testável).
//
// Tempo: o modelo é dirigido por TEMPO SIMULADO (segundos do World), nunca
// por wall-clock. Quem avança o relógio chama advanceTo(now) — no
// SimGateway isso acontece a cada tick de step(), coerente com o loop
// determinístico dele.
//
// REGRESSÃO GARANTIDA: com a degradação desligada (net_enabled=false) OU
// com PDR=100% e latência/jitter=0 (o default do exemplo.json), send()
// entrega SÍNCRONA e imediatamente, sem consumir RNG — comportamento
// byte-a-byte idêntico ao das Fases 1–6.

import { SimConfig } from '../core/types';

/** Gerador pseudo-aleatório: () => número em [0, 1). */
export type Rng = () => number;

/** mulberry32 — PRNG de 32 bits, minúsculo e determinístico por seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parâmetros vivos da degradação (por mensagem — podem mudar a qualquer
 *  momento; mensagens JÁ agendadas mantêm o atraso decidido no envio). */
export interface NetParams {
  /** Kill-switch: false ⇒ passthrough total (sem perda, sem atraso). */
  enabled: boolean;
  /** Packet delivery ratio, 0–100%. Prob. de DROP = 1 − pdr/100. */
  pdr_percent: number;
  /** Atraso base de entrega, ms (a "latência de slot TSCH" lógica). */
  slot_latency_ms: number;
  /** Jitter uniforme em [0, jitter_ms] SOMADO ao atraso base. */
  jitter_ms: number;
}

/** Lê os parâmetros do `sim` do cenário (defaults retrocompatíveis:
 *  net_enabled ausente = true, jitter_ms ausente = 0). */
export function netParamsFromSim(sim: SimConfig): NetParams {
  return {
    enabled: sim.net_enabled ?? true,
    pdr_percent: sim.pdr_percent,
    slot_latency_ms: sim.slot_latency_ms,
    jitter_ms: sim.jitter_ms ?? 0,
  };
}

/** true quando a degradação é um no-op (desligada OU PDR=100 e atraso 0) —
 *  o caminho rápido/síncrono que preserva o comportamento das Fases 1–6. */
export function isPassthrough(p: NetParams): boolean {
  return (
    !p.enabled ||
    (p.pdr_percent >= 100 && p.slot_latency_ms <= 0 && p.jitter_ms <= 0)
  );
}

export type NetDecision =
  | { drop: true }
  | { drop: false; /** atraso decidido, em SEGUNDOS de tempo simulado. */ delay_s: number };

/** Decide o destino de UMA mensagem: DROP ou DELIVER com atraso.
 *  Pura (o estado todo está no RNG). Consumo de RNG determinístico:
 *  0 draws em passthrough; 1 draw pro sorteio de drop quando pdr<100;
 *  +1 draw pro jitter quando jitter_ms>0. */
export function decideFate(params: NetParams, rng: Rng): NetDecision {
  if (isPassthrough(params)) return { drop: false, delay_s: 0 };
  const pdr = Math.min(100, Math.max(0, params.pdr_percent));
  // entrega com prob. pdr/100 → dropa quando o sorteio cai fora
  if (pdr < 100 && rng() >= pdr / 100) return { drop: true };
  const baseMs = Math.max(0, params.slot_latency_ms);
  const jitterMs = params.jitter_ms > 0 ? rng() * params.jitter_ms : 0;
  return { drop: false, delay_s: (baseMs + jitterMs) / 1000 };
}

export interface NetChannelStats {
  sent: number;
  delivered: number;
  dropped: number;
  pending: number;
}

interface Queued<T> {
  deliverAt: number; // tempo simulado (s)
  seq: number;       // desempate FIFO pra entregas no mesmo instante
  item: T;
}

/** Um sentido do canal (uplink OU downlink): aplica decideFate por mensagem
 *  e agenda as entregas atrasadas em TEMPO SIMULADO.
 *
 *  - send(item, nowS, params): decide na hora, com os params VIVOS;
 *    atraso 0 ⇒ entrega SÍNCRONA (dentro do próprio send — preserva o
 *    comportamento baseline); atraso > 0 ⇒ enfileira;
 *  - advanceTo(nowS): entrega tudo que venceu, em ordem de tempo de
 *    entrega (desempate na ordem de envio). Chamado a cada tick do
 *    SimGateway — nada de wall-clock. */
export class NetChannel<T> {
  private readonly rng: Rng;
  private readonly deliver: (item: T) => void;
  private queue: Queued<T>[] = [];
  private seq = 0;

  sent = 0;
  delivered = 0;
  dropped = 0;

  constructor(seed: number | Rng, deliver: (item: T) => void) {
    this.rng = typeof seed === 'number' ? mulberry32(seed) : seed;
    this.deliver = deliver;
  }

  get stats(): NetChannelStats {
    return {
      sent: this.sent,
      delivered: this.delivered,
      dropped: this.dropped,
      pending: this.queue.length,
    };
  }

  send(item: T, nowS: number, params: NetParams): void {
    this.sent++;
    const fate = decideFate(params, this.rng);
    if (fate.drop) {
      this.dropped++;
      return;
    }
    if (fate.delay_s <= 0) {
      // caminho rápido: entrega síncrona, idêntica a chamar deliver direto
      this.delivered++;
      this.deliver(item);
      return;
    }
    this.queue.push({ deliverAt: nowS + fate.delay_s, seq: this.seq++, item });
  }

  /** Entrega tudo com deliverAt ≤ now (com tolerância de float), em ordem
   *  (deliverAt, seq). Mensagens agendadas mantêm o atraso decidido no
   *  envio mesmo que os params mudem depois. */
  advanceTo(nowS: number): void {
    if (this.queue.length === 0) return;
    const t = nowS + 1e-9;
    const due = this.queue.filter((q) => q.deliverAt <= t);
    if (due.length === 0) return;
    this.queue = this.queue.filter((q) => q.deliverAt > t);
    due.sort((a, b) => a.deliverAt - b.deliverAt || a.seq - b.seq);
    for (const q of due) {
      this.delivered++;
      this.deliver(q.item);
    }
  }

  /** Descarta as entregas pendentes (ex.: reset do mundo). */
  clear(): void {
    this.queue = [];
  }
}
