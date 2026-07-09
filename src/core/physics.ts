import { ArenaConfig, Obstacle, Vec2 } from './types';

// Colisão simples da Fase 1: robô = círculo pequeno, obstáculo = AABB.
// Se a posição proposta no tick colidir, o movimento é bloqueado
// (a pose volta pra anterior). Sem resposta física (sem empurrão/slide).

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Testa interseção círculo × retângulo (ponto mais próximo do AABB). */
export function circleIntersectsRect(center: Vec2, radius: number, o: Obstacle): boolean {
  const nx = clamp(center.x, o.x, o.x + o.w);
  const ny = clamp(center.y, o.y, o.y + o.h);
  const dx = center.x - nx;
  const dy = center.y - ny;
  return dx * dx + dy * dy < radius * radius;
}

/** Testa colisão contra qualquer obstáculo da lista. */
export function collidesAny(center: Vec2, radius: number, obstacles: Obstacle[]): boolean {
  return obstacles.some((o) => circleIntersectsRect(center, radius, o));
}

/** Resolve o movimento de um tick: trava nas bordas da arena e, se a
 *  posição proposta colidir com um obstáculo, mantém a posição anterior. */
export function resolveMovement(
  prev: Vec2,
  next: Vec2,
  radius: number,
  obstacles: Obstacle[],
  arena: ArenaConfig,
): Vec2 {
  const clamped: Vec2 = {
    x: clamp(next.x, radius, arena.width - radius),
    y: clamp(next.y, radius, arena.height - radius),
  };
  if (collidesAny(clamped, radius, obstacles)) {
    return { x: prev.x, y: prev.y }; // movimento bloqueado neste tick
  }
  return clamped;
}
