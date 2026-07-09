import { Robot } from './Robot';
import { World } from './World';
import { Scenario } from './types';

// (De)serialização do cenário JSON — schema da seção 7 do PLANO.md.
// Ângulos: o JSON usa theta_deg; o núcleo trabalha em radianos.

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

function fail(msg: string): never {
  throw new Error(`Cenário inválido: ${msg}`);
}

/** Valida o mínimo necessário e constrói um World a partir do JSON. */
export function loadScenario(json: Scenario | string): World {
  const s: Scenario = typeof json === 'string' ? JSON.parse(json) : json;

  if (s.version !== 1) fail(`version esperada 1, recebida ${s.version}`);
  if (!s.arena || s.arena.width_mm <= 0 || s.arena.height_mm <= 0) {
    fail('arena.width_mm/height_mm devem ser positivos');
  }
  if (!s.sim || s.sim.tick_hz <= 0) fail('sim.tick_hz deve ser positivo');
  if (!s.network?.id) fail('network.id ausente');
  if (!Array.isArray(s.robots)) fail('robots deve ser uma lista');
  if (!Array.isArray(s.obstacles)) fail('obstacles deve ser uma lista');

  const world = new World({
    arena: {
      width: s.arena.width_mm,
      height: s.arena.height_mm,
      grid: s.arena.grid_mm,
    },
    network: { id: s.network.id, gateway_addr: s.network.gateway_addr },
    sim: { ...s.sim },
    obstacles: s.obstacles.map((o) => ({
      id: o.id,
      x: o.x_mm,
      y: o.y_mm,
      w: o.w_mm,
      h: o.h_mm,
    })),
  });

  for (const r of s.robots) {
    if (!/^[0-9A-F]{16}$/i.test(r.address)) {
      fail(`address "${r.address}" deve ter 16 dígitos hex`);
    }
    world.addRobot(
      new Robot({
        address: r.address.toUpperCase(),
        application: r.application,
        mode: r.mode,
        x: r.start.x_mm,
        y: r.start.y_mm,
        theta: r.start.theta_deg * DEG_TO_RAD, // graus → rad na carga
        battery: r.battery,
      }),
    );
  }

  return world;
}

/** Serializa o World de volta pro schema JSON. A pose ATUAL de cada robô
 *  vira o `start` do cenário salvo (útil pra "congelar" um estado). */
export function serializeScenario(world: World): Scenario {
  return {
    version: 1,
    network: { ...world.network },
    arena: {
      width_mm: world.arena.width,
      height_mm: world.arena.height,
      grid_mm: world.arena.grid,
    },
    obstacles: world.obstacles.map((o) => ({
      id: o.id,
      x_mm: o.x,
      y_mm: o.y,
      w_mm: o.w,
      h_mm: o.h,
    })),
    robots: world.robots.map((r) => ({
      address: r.address,
      application: r.application,
      mode: r.mode,
      start: {
        x_mm: r.pos_x,
        y_mm: r.pos_y,
        theta_deg: r.theta * RAD_TO_DEG,
      },
      battery: r.battery,
    })),
    sim: { ...world.sim },
  };
}
