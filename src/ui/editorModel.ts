// Operações PURAS do editor sobre o cenário JSON (Fase 3) — sem React.
// O editor trabalha direto no formato `Scenario` (mm / graus, seção 7 do
// PLANO); "Simular" só faz loadScenario(draft). Toda função retorna um
// cenário NOVO (imutável do ponto de vista do chamador).

import {
  ControlModeType,
  Scenario,
  ScenarioObstacle,
  ScenarioRobot,
} from '../core/types';
import { DEFAULT_WAYPOINT_THRESHOLD_MM, loadScenario, serializeScenario } from '../core/scenario';
import { Rect } from './editorGeometry';

// ---------------------------------------------------------------------------
// Address (16 dígitos hex — mesmo formato do VARCHAR(16) do backend)
// ---------------------------------------------------------------------------

export const ADDRESS_RE = /^[0-9A-F]{16}$/i;

export function isValidAddress(a: string): boolean {
  return ADDRESS_RE.test(a);
}

/** Gera um address hex de 16 chars, único em relação a `existing`.
 *  `rand` é injetável só pra teste (default Math.random). */
export function generateAddress(
  existing: Iterable<string>,
  rand: () => number = Math.random,
): string {
  const taken = new Set(Array.from(existing, (a) => a.toUpperCase()));
  const HEX = '0123456789ABCDEF';
  for (;;) {
    let addr = '';
    for (let i = 0; i < 16; i++) addr += HEX[Math.floor(rand() * 16) % 16];
    if (!taken.has(addr)) return addr;
  }
}

// ---------------------------------------------------------------------------
// Criação / edição de barreiras e robôs
// ---------------------------------------------------------------------------

export function cloneScenario(s: Scenario): Scenario {
  return JSON.parse(JSON.stringify(s)) as Scenario;
}

/** Próximo id livre no padrão "barreira-N". */
export function uniqueObstacleId(existing: readonly string[]): string {
  const taken = new Set(existing);
  for (let n = 1; ; n++) {
    const id = `barreira-${n}`;
    if (!taken.has(id)) return id;
  }
}

export function makeObstacle(s: Scenario, rect: Rect): ScenarioObstacle {
  return {
    id: uniqueObstacleId(s.obstacles.map((o) => o.id)),
    x_mm: rect.x,
    y_mm: rect.y,
    w_mm: rect.w,
    h_mm: rect.h,
  };
}

export function makeRobot(s: Scenario, pos: { x: number; y: number }): ScenarioRobot {
  return {
    address: generateAddress(s.robots.map((r) => r.address)),
    application: 0, // ApplicationType.DotBot
    mode: ControlModeType.Manual,
    start: { x_mm: pos.x, y_mm: pos.y, theta_deg: 90 }, // "olhando pro norte"
    battery: 100,
  };
}

export function addObstacle(s: Scenario, o: ScenarioObstacle): Scenario {
  return { ...s, obstacles: [...s.obstacles, o] };
}

export function addRobot(s: Scenario, r: ScenarioRobot): Scenario {
  return { ...s, robots: [...s.robots, r] };
}

export function removeObstacle(s: Scenario, index: number): Scenario {
  return { ...s, obstacles: s.obstacles.filter((_, i) => i !== index) };
}

export function removeRobot(s: Scenario, index: number): Scenario {
  return { ...s, robots: s.robots.filter((_, i) => i !== index) };
}

export function patchObstacle(
  s: Scenario,
  index: number,
  patch: Partial<ScenarioObstacle>,
): Scenario {
  return {
    ...s,
    obstacles: s.obstacles.map((o, i) => (i === index ? { ...o, ...patch } : o)),
  };
}

export function setObstacleRect(s: Scenario, index: number, rect: Rect): Scenario {
  return patchObstacle(s, index, {
    x_mm: rect.x,
    y_mm: rect.y,
    w_mm: rect.w,
    h_mm: rect.h,
  });
}

export function patchRobot(
  s: Scenario,
  index: number,
  patch: Partial<ScenarioRobot>,
): Scenario {
  return {
    ...s,
    robots: s.robots.map((r, i) => (i === index ? { ...r, ...patch } : r)),
  };
}

export function setRobotStart(
  s: Scenario,
  index: number,
  start: Partial<ScenarioRobot['start']>,
): Scenario {
  const cur = s.robots[index];
  return patchRobot(s, index, { start: { ...cur.start, ...start } });
}

/** Acrescenta um waypoint à rota do robô. Espelha o efeito do payload
 *  LH2_WAYPOINTS: ganhar rota coloca o robô em AUTO. */
export function addRobotWaypoint(
  s: Scenario,
  index: number,
  p: { x: number; y: number },
): Scenario {
  const cur = s.robots[index];
  return patchRobot(s, index, {
    mode: ControlModeType.Auto,
    waypoints: [...(cur.waypoints ?? []), { x_mm: p.x, y_mm: p.y }],
    waypoint_threshold_mm: cur.waypoint_threshold_mm ?? DEFAULT_WAYPOINT_THRESHOLD_MM,
  });
}

export function removeRobotWaypoint(
  s: Scenario,
  index: number,
  wpIndex: number,
): Scenario {
  const cur = s.robots[index];
  return patchRobot(s, index, {
    waypoints: (cur.waypoints ?? []).filter((_, i) => i !== wpIndex),
  });
}

// ---------------------------------------------------------------------------
// Carga de arquivo (upload) — valida via core e devolve o cenário CANÔNICO
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; scenario: Scenario }
  | { ok: false; error: string };

/** Parseia + valida o texto de um .json de cenário. A validação é a MESMA do
 *  core (`loadScenario`); em caso de sucesso devolve o cenário re-serializado
 *  (normaliza address pra maiúsculas e descarta campos desconhecidos). */
export function parseScenarioFile(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' };
  }
  try {
    const world = loadScenario(parsed as Scenario);
    return { ok: true, scenario: serializeScenario(world) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
