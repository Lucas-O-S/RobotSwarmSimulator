// Demo headless da Fase 1: carrega scenarios/exemplo.json, roda alguns
// segundos de simulação e imprime as poses no console.
// Uso: npm run demo

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, RAD_TO_DEG } from './core/scenario';
import { ControlModeType } from './core/types';

const here = dirname(fileURLToPath(import.meta.url));
const scenarioPath = resolve(here, '../scenarios/exemplo.json');
const world = loadScenario(readFileSync(scenarioPath, 'utf-8'));

console.log('=== RobotSwarmSimulator — demo headless (Fase 1) ===');
console.log(
  `Arena ${world.arena.width}x${world.arena.height} mm | ` +
    `${world.obstacles.length} obstáculo(s) | ${world.robots.length} robô(s) | ` +
    `tick ${world.sim.tick_hz} Hz`,
);

// Robô 1: rota em AUTO contornando a barreira pela direita.
const r1 = world.robots[0];
r1.setWaypoints(
  [
    { x: 1500, y: 300 },
    { x: 1500, y: 1700 },
  ],
  50,
);

// Robô 2: MANUAL, dirigindo reto contra a barreira (x: 900..1100) —
// deve parar bloqueado na frente dela, sem atravessar.
const r2 = world.robots[1];
r2.applyMoveRaw(0, 80, 0, 80);

function modeName(mode: ControlModeType): string {
  return mode === ControlModeType.Auto ? 'AUTO' : 'MANUAL';
}

function printPoses(): void {
  for (const r of world.robots) {
    const line =
      `  ${r.address}  ` +
      `pos=(${r.pos_x.toFixed(0).padStart(4)}, ${r.pos_y.toFixed(0).padStart(4)}) mm  ` +
      `theta=${(r.theta * RAD_TO_DEG).toFixed(1).padStart(6)}°  ` +
      `${modeName(r.mode).padEnd(6)}  ` +
      `wp_idx=${r.waypoint_idx}/${r.waypoints.length}  ` +
      `bat=${r.battery.toFixed(2)}%`;
    console.log(line);
  }
}

console.log(`\nt = 0.0 s`);
printPoses();

const TOTAL_S = 10;
const PRINT_EVERY_S = 1;
for (let t = PRINT_EVERY_S; t <= TOTAL_S; t += PRINT_EVERY_S) {
  world.step(PRINT_EVERY_S);
  console.log(`\nt = ${t.toFixed(1)} s (tempo simulado: ${world.time.toFixed(1)} s)`);
  printPoses();
}

console.log('\nResumo:');
console.log(
  `  ${r1.address}: rota ${r1.waypoint_idx >= r1.waypoints.length ? 'CONCLUÍDA' : 'em andamento'} ` +
    `(wp_idx=${r1.waypoint_idx})`,
);
console.log(
  `  ${r2.address}: bloqueado pela barreira em x=${r2.pos_x.toFixed(0)} mm ` +
    `(barreira começa em x=900, raio do robô=35)`,
);
