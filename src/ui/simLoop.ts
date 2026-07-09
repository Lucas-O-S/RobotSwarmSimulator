// Lógica PURA do loop de animação (sem React) — testável em unidade.
//
// O render roda com requestAnimationFrame (dt variável); a simulação roda em
// PASSO FIXO de 1/tick_hz (determinismo do World). O acumulador guarda o
// tempo real que ainda não virou tick; o dt de cada frame é clampado pra
// evitar a "espiral da morte" quando a aba fica em background.

/** Clamp do dt real de um frame (s). Abas em background podem acordar com
 *  segundos acumulados — acima disso, descartamos o excesso. */
export const MAX_FRAME_DT_S = 0.25;

/** Trava de segurança: nunca roda mais que isso de ticks num único frame. */
export const MAX_TICKS_PER_FRAME = 100;

export interface StepPlan {
  /** Quantos ticks fixos executar neste frame. */
  ticks: number;
  /** Resto de tempo real (s) que fica pro próximo frame. */
  acc: number;
}

/** Decide quantos ticks fixos rodar dado o dt real do frame.
 *  `acc` é o resto acumulado do frame anterior. */
export function planTicks(
  acc: number,
  frameDtSeconds: number,
  tickDt: number,
  maxFrameDt: number = MAX_FRAME_DT_S,
  maxTicks: number = MAX_TICKS_PER_FRAME,
): StepPlan {
  const dt = Math.min(Math.max(frameDtSeconds, 0), maxFrameDt);
  let next = acc + dt;
  let ticks = Math.floor(next / tickDt);
  if (ticks > maxTicks) {
    // descarta o excesso (não tenta "recuperar" tempo perdido)
    ticks = maxTicks;
    next = 0;
  } else {
    next -= ticks * tickDt;
  }
  return { ticks, acc: next };
}
