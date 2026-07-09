// Hook que liga o núcleo headless (World) ao React:
//  - instancia o World via loadScenario(JSON);
//  - avança em requestAnimationFrame com dt real, convertido em ticks FIXOS
//    de 1/tick_hz (lógica pura em simLoop.ts);
//  - guarda uma trilha curta do caminho recente de cada robô;
//  - expõe snapshots imutáveis pro render (a UI da Fase 2 é read-only).

import { useCallback, useEffect, useRef, useState } from 'react';
import { World } from '../core/World';
import { loadScenario } from '../core/scenario';
import { ControlModeType, RobotState, Scenario, Vec2 } from '../core/types';
import { planTicks } from './simLoop';

export interface ScenarioEntry {
  name: string;
  data: Scenario;
  /** Comandos injetados via API do core logo após a carga (ex.: rota AUTO de
   *  demonstração, pra "ver o robô andar"). A Fase 2 não tem UI de comando. */
  setup?: (world: World) => void;
}

const TRAIL_MAX_POINTS = 400; // pontos por robô
const TRAIL_MIN_DIST_MM = 8;  // só grava ponto novo se andou isso

export interface UseWorldResult {
  /** O World vivo (mutável — use só pra leitura na Fase 2). */
  world: World;
  /** Snapshots imutáveis dos robôs, recalculados a cada frame. */
  robots: RobotState[];
  /** Trilha recente (mm, coordenadas de mundo) por address. */
  trails: ReadonlyMap<string, readonly Vec2[]>;
  /** Tempo simulado (s). */
  time: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  /** Recarrega o cenário atual do zero. */
  reset: () => void;
  scenarioName: string;
  setScenario: (name: string) => void;
  /** Injeta um CMD_MOVE_RAW de teste no 1º robô em MANUAL (só demonstração
   *  de movimento — sem UI de joystick na Fase 2). Retorna o address ou null. */
  injectMoveRawTest: () => string | null;
}

function buildWorld(entry: ScenarioEntry): World {
  const world = loadScenario(entry.data);
  entry.setup?.(world);
  return world;
}

export function useWorld(scenarios: ScenarioEntry[]): UseWorldResult {
  if (scenarios.length === 0) throw new Error('useWorld: lista de cenários vazia');

  const [scenarioName, setScenarioName] = useState(scenarios[0].name);
  const entry = scenarios.find((s) => s.name === scenarioName) ?? scenarios[0];

  const worldRef = useRef<World | null>(null);
  const trailsRef = useRef<Map<string, Vec2[]>>(new Map());
  const accRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(true);
  // Contador só pra forçar re-render a cada frame / reset.
  const [, setFrame] = useState(0);

  const seedTrails = useCallback((world: World) => {
    const trails = new Map<string, Vec2[]>();
    for (const r of world.robots) {
      trails.set(r.address, [{ x: r.pos_x, y: r.pos_y }]);
    }
    trailsRef.current = trails;
  }, []);

  // Inicialização preguiçosa: no primeiro render e sempre que setScenario
  // invalidar o world (null), reconstrói ANTES do paint — sem efeito extra.
  if (worldRef.current === null) {
    worldRef.current = buildWorld(entry);
    seedTrails(worldRef.current);
    accRef.current = 0;
    lastTsRef.current = null;
  }

  const reset = useCallback(() => {
    worldRef.current = buildWorld(entry);
    seedTrails(worldRef.current);
    accRef.current = 0;
    lastTsRef.current = null;
    setFrame((f) => f + 1);
  }, [entry, seedTrails]);

  const setScenario = useCallback((name: string) => {
    setScenarioName(name);
    worldRef.current = null; // será reconstruído no próximo render
  }, []);

  const recordTrails = useCallback((world: World) => {
    for (const r of world.robots) {
      let trail = trailsRef.current.get(r.address);
      if (!trail) {
        trail = [];
        trailsRef.current.set(r.address, trail);
      }
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(r.pos_x - last.x, r.pos_y - last.y) >= TRAIL_MIN_DIST_MM) {
        trail.push({ x: r.pos_x, y: r.pos_y });
        if (trail.length > TRAIL_MAX_POINTS) trail.splice(0, trail.length - TRAIL_MAX_POINTS);
      }
    }
  }, []);

  // Loop de animação — só roda enquanto playing.
  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null; // não conta o tempo pausado como dt
      return;
    }
    let raf = 0;
    const onFrame = (ts: number) => {
      const world = worldRef.current!;
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      if (last !== null) {
        const frameDt = (ts - last) / 1000;
        const plan = planTicks(accRef.current, frameDt, world.tickDt);
        accRef.current = plan.acc;
        for (let i = 0; i < plan.ticks; i++) world.tick();
        if (plan.ticks > 0) recordTrails(world);
      }
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(onFrame);
    };
    raf = requestAnimationFrame(onFrame);
    return () => cancelAnimationFrame(raf);
  }, [playing, recordTrails]);

  const injectMoveRawTest = useCallback((): string | null => {
    const world = worldRef.current!;
    const robot = world.robots.find((r) => r.mode === ControlModeType.Manual);
    if (!robot) return null;
    robot.applyMoveRaw(0, 80, 0, 80); // reto, ~315 mm/s
    setFrame((f) => f + 1);
    return robot.address;
  }, []);

  const world = worldRef.current;
  return {
    world,
    robots: world.robots.map((r) => r.snapshot()),
    trails: trailsRef.current,
    time: world.time,
    playing,
    play: useCallback(() => setPlaying(true), []),
    pause: useCallback(() => setPlaying(false), []),
    reset,
    scenarioName,
    setScenario,
    injectMoveRawTest,
  };
}
