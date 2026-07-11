// Geometria pura do editor (Fase 3): snap, retângulo de arrasto, alças de
// resize, hit-test e contenção na arena.

import { describe, expect, it } from 'vitest';
import {
  MIN_OBSTACLE_MM,
  Rect,
  clampRectToArena,
  clampVecToArena,
  handlePoint,
  hitHandle,
  moveRectTo,
  pointInRect,
  rectFromCorners,
  resizeRect,
  snapAngleDeg,
  snapValue,
  snapVec,
} from '../editorGeometry';

const R: Rect = { x: 100, y: 200, w: 400, h: 300 }; // x2=500, y2=500

describe('snap', () => {
  it('arredonda pro múltiplo do grid mais próximo', () => {
    expect(snapValue(149, 100)).toBe(100);
    expect(snapValue(150, 100)).toBe(200);
    expect(snapValue(0, 100)).toBe(0);
  });

  it('grid <= 0 desliga o snap', () => {
    expect(snapValue(149, 0)).toBe(149);
    expect(snapVec({ x: 3, y: 7 }, -1)).toEqual({ x: 3, y: 7 });
  });

  it('snapVec aplica nos dois eixos', () => {
    expect(snapVec({ x: 149, y: 251 }, 100)).toEqual({ x: 100, y: 300 });
  });

  it('snapAngleDeg arredonda pro múltiplo do passo', () => {
    expect(snapAngleDeg(37, 15)).toBe(30);
    expect(snapAngleDeg(38, 15)).toBe(45);
    expect(snapAngleDeg(-97, 15)).toBe(-90);
    expect(snapAngleDeg(37.3, 0)).toBe(37.3); // passo <= 0 desliga
  });
});

describe('rectFromCorners', () => {
  it('normaliza qualquer par de cantos (w,h >= 0)', () => {
    expect(rectFromCorners({ x: 500, y: 500 }, { x: 100, y: 200 })).toEqual(R);
    expect(rectFromCorners({ x: 100, y: 500 }, { x: 500, y: 200 })).toEqual(R);
  });
});

describe('handlePoint / hitHandle', () => {
  it('posiciona as alças nos cantos e meios de borda (mundo, Y pra cima)', () => {
    expect(handlePoint(R, 'sw')).toEqual({ x: 100, y: 200 });
    expect(handlePoint(R, 'ne')).toEqual({ x: 500, y: 500 });
    expect(handlePoint(R, 'n')).toEqual({ x: 300, y: 500 });
    expect(handlePoint(R, 'e')).toEqual({ x: 500, y: 350 });
  });

  it('acha a alça dentro da tolerância; null fora', () => {
    expect(hitHandle(R, { x: 502, y: 498 }, 10)).toBe('ne');
    expect(hitHandle(R, { x: 300, y: 505 }, 10)).toBe('n');
    expect(hitHandle(R, { x: 300, y: 350 }, 10)).toBeNull(); // centro
  });
});

describe('resizeRect', () => {
  it('arrasta uma borda mantendo a oposta fixa', () => {
    const out = resizeRect(R, 'e', { x: 600, y: 999 }, MIN_OBSTACLE_MM);
    expect(out).toEqual({ x: 100, y: 200, w: 500, h: 300 });
  });

  it('arrasta um canto (duas bordas ao mesmo tempo)', () => {
    const out = resizeRect(R, 'nw', { x: 50, y: 600 }, MIN_OBSTACLE_MM);
    expect(out).toEqual({ x: 50, y: 200, w: 450, h: 400 });
  });

  it('não cruza a borda oposta: respeita o tamanho mínimo', () => {
    const out = resizeRect(R, 'e', { x: 0, y: 0 }, MIN_OBSTACLE_MM);
    expect(out.w).toBe(MIN_OBSTACLE_MM);
    expect(out.x).toBe(100);

    const out2 = resizeRect(R, 's', { x: 0, y: 9999 }, MIN_OBSTACLE_MM);
    expect(out2.h).toBe(MIN_OBSTACLE_MM);
    expect(out2.y + out2.h).toBe(500); // topo fixo
  });
});

describe('contenção na arena', () => {
  it('moveRectTo + clampRectToArena empurram pra dentro', () => {
    const moved = moveRectTo(R, { x: -50, y: 1900 });
    const out = clampRectToArena(moved, 2000, 2000);
    expect(out).toEqual({ x: 0, y: 1700, w: 400, h: 300 });
  });

  it('clampRectToArena recorta retângulo maior que a arena', () => {
    const out = clampRectToArena({ x: -10, y: -10, w: 5000, h: 100 }, 2000, 2000);
    expect(out).toEqual({ x: 0, y: 0, w: 2000, h: 100 });
  });

  it('clampVecToArena respeita a margem (raio do robô)', () => {
    expect(clampVecToArena({ x: -5, y: 3000 }, 2000, 2000, 35)).toEqual({
      x: 35,
      y: 1965,
    });
  });
});

describe('pointInRect', () => {
  it('dentro/borda/fora', () => {
    expect(pointInRect({ x: 300, y: 350 }, R)).toBe(true);
    expect(pointInRect({ x: 100, y: 200 }, R)).toBe(true);
    expect(pointInRect({ x: 99, y: 350 }, R)).toBe(false);
  });
});
