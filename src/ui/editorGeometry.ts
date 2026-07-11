// Geometria PURA do editor de cenário (Fase 3) — sem React, sem Canvas.
// Tudo em coordenadas de MUNDO (mm, Y crescendo pra cima). Testável em
// unidade; a conversão mundo↔tela fica no componente (ScenarioEditor).

import { Vec2 } from '../core/types';

/** Retângulo AABB em mm — x,y = canto INFERIOR-esquerdo (convenção do core). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Alças de redimensionamento (pontos cardeais; 'n' = topo = y+h no mundo). */
export type HandleId = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

export const HANDLES: readonly HandleId[] = [
  'nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se',
];

/** Tamanho mínimo de barreira, em mm (evita retângulo degenerado). */
export const MIN_OBSTACLE_MM = 20;

/** Snap de um valor ao grid. grid <= 0 desliga o snap. */
export function snapValue(v: number, grid: number): number {
  if (grid <= 0) return v;
  return Math.round(v / grid) * grid;
}

export function snapVec(p: Vec2, grid: number): Vec2 {
  return { x: snapValue(p.x, grid), y: snapValue(p.y, grid) };
}

/** Snap de ângulo (graus) ao múltiplo de `stepDeg` mais próximo. */
export function snapAngleDeg(deg: number, stepDeg: number): number {
  if (stepDeg <= 0) return deg;
  return Math.round(deg / stepDeg) * stepDeg;
}

/** Retângulo normalizado a partir de dois cantos de um arrasto (w,h >= 0). */
export function rectFromCorners(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Posição (mundo) de uma alça do retângulo. */
export function handlePoint(r: Rect, h: HandleId): Vec2 {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('s') ? r.y : h.includes('n') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

/** Alça sob o ponto `p` (tolerância em mm), ou null. */
export function hitHandle(r: Rect, p: Vec2, tolMm: number): HandleId | null {
  for (const h of HANDLES) {
    const hp = handlePoint(r, h);
    if (Math.hypot(p.x - hp.x, p.y - hp.y) <= tolMm) return h;
  }
  return null;
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Redimensiona movendo a alça `h` até `p`, mantendo as bordas opostas fixas
 *  e respeitando `minSize` (a borda arrastada NÃO cruza a oposta). */
export function resizeRect(r: Rect, h: HandleId, p: Vec2, minSize: number): Rect {
  let x1 = r.x;
  let y1 = r.y;
  let x2 = r.x + r.w;
  let y2 = r.y + r.h;

  if (h.includes('w')) x1 = Math.min(p.x, x2 - minSize);
  if (h.includes('e')) x2 = Math.max(p.x, x1 + minSize);
  if (h.includes('s')) y1 = Math.min(p.y, y2 - minSize);
  if (h.includes('n')) y2 = Math.max(p.y, y1 + minSize);

  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Move o retângulo pra que o canto inferior-esquerdo fique em `origin`. */
export function moveRectTo(r: Rect, origin: Vec2): Rect {
  return { x: origin.x, y: origin.y, w: r.w, h: r.h };
}

/** Empurra o retângulo pra dentro da arena (recorta o tamanho se exceder). */
export function clampRectToArena(r: Rect, arenaW: number, arenaH: number): Rect {
  const w = Math.min(r.w, arenaW);
  const h = Math.min(r.h, arenaH);
  const x = Math.min(Math.max(r.x, 0), arenaW - w);
  const y = Math.min(Math.max(r.y, 0), arenaH - h);
  return { x, y, w, h };
}

/** Contém um ponto na arena com uma margem (ex.: raio do robô). */
export function clampVecToArena(
  p: Vec2,
  arenaW: number,
  arenaH: number,
  margin = 0,
): Vec2 {
  return {
    x: Math.min(Math.max(p.x, margin), arenaW - margin),
    y: Math.min(Math.max(p.y, margin), arenaH - margin),
  };
}
