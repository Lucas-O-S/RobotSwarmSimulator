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

// ---------------------------------------------------------------------------
// Colisão robô × robô (Fase 8): cada robô é um círculo de mesmo raio; dois
// robôs colidem quando a distância entre os centros é menor que 2·raio.
// Resolvemos por SEPARAÇÃO posicional (empurra os dois pra fora, metade da
// sobreposição pra cada um, ao longo da linha dos centros) — sem inventar
// física de impulso/velocidade, coerente com o resto do simulador. O empurrão
// respeita as bordas da arena e NÃO empurra ninguém pra dentro de um obstáculo.
// ---------------------------------------------------------------------------

/** Corpo circular mutável (só posição) — o World passa as poses dos robôs. */
export interface CircleBody {
  x: number;
  y: number;
}

/** Move um corpo por (mx, my) se o destino ficar dentro da arena e fora dos
 *  obstáculos; senão, não move (evita empurrar robô pra dentro de parede). */
function tryNudge(
  body: CircleBody,
  mx: number,
  my: number,
  radius: number,
  obstacles: Obstacle[],
  arena: ArenaConfig,
): void {
  const nx = clamp(body.x + mx, radius, arena.width - radius);
  const ny = clamp(body.y + my, radius, arena.height - radius);
  if (collidesAny({ x: nx, y: ny }, radius, obstacles)) return;
  body.x = nx;
  body.y = ny;
}

/** Separa robôs que se sobrepõem, mutando as posições in place. Faz algumas
 *  iterações pra estabilizar aglomerados (a correção de um par pode criar
 *  sobreposição em outro). Determinístico. */
export function separateRobots(
  bodies: CircleBody[],
  radius: number,
  obstacles: Obstacle[],
  arena: ArenaConfig,
  iterations = 4,
): void {
  const minDist = radius * 2;
  for (let it = 0; it < iterations; it++) {
    let anyOverlap = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        anyOverlap = true;
        if (dist < 1e-6) {
          // sobreposição exata: escolhe uma normal arbitrária estável
          dx = 1;
          dy = 0;
          dist = 1e-6;
        }
        const push = (minDist - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        tryNudge(a, -nx * push, -ny * push, radius, obstacles, arena);
        tryNudge(b, nx * push, ny * push, radius, obstacles, arena);
      }
    }
    if (!anyOverlap) break;
  }
}
