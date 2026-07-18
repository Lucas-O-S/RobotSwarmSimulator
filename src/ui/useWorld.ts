// Hook que liga o núcleo headless (World) ao React:
//  - instancia o World via loadScenario(scenario);
//  - avança em requestAnimationFrame com dt real, convertido em ticks FIXOS
//    de 1/tick_hz (lógica pura em simLoop.ts);
//  - guarda uma trilha curta do caminho recente de cada robô;
//  - expõe snapshots imutáveis pro render.
//
// Desde a Fase 3 o hook recebe UM cenário (o draft do editor ou um embutido);
// quem escolhe qual cenário rodar é o App. Se a referência do cenário mudar,
// o World é reconstruído do zero.

import { useCallback, useEffect, useRef, useState } from 'react';
import { World } from '../core/World';
import { loadScenario } from '../core/scenario';
import { ControlModeType, RobotState, Scenario, Vec2 } from '../core/types';
import { planTicks } from './simLoop';
import { SwarmitDevice } from '../net/swarmitDevice';
import { SwarmitPayloadType, SwarmitStatusType, SWARMIT_OTA_SHA_SIZE } from '../protocol';

const TRAIL_MAX_POINTS = 400; // pontos por robô
const TRAIL_MIN_DIST_MM = 8;  // só grava ponto novo se andou isso

/** Fase 7 — configurações de rede vivas (view do world.sim corrente).
 *  Valores iniciais vêm do `sim` do cenário; Reset volta pra eles. */
export interface NetConfigValues {
  /** Degradação ligada? (sim.net_enabled; ausente = true) */
  enabled: boolean;
  pdr_percent: number;    // 0..100
  slot_latency_ms: number; // ≥ 0
  jitter_ms: number;       // ≥ 0 (sim.jitter_ms; ausente = 0)
}

/** Fase 7 (Peça 2) — visão do estado swarmit de um robô pra UI. */
export interface SwarmitView {
  address: string;
  status: SwarmitStatusType;
  flashProgress: number; // 0..1
}

export interface UseWorldResult {
  /** O World vivo (mutável — use só pra leitura na UI). */
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
  /** Injeta um CMD_MOVE_RAW de teste no 1º robô em MANUAL (só demonstração
   *  de movimento — sem UI de joystick ainda). Retorna o address ou null. */
  injectMoveRawTest: () => string | null;
  /** Fault injection (Fase 6): derruba (false) / religa (true) um robô na
   *  rede durante a simulação. Religar não ressuscita bateria zerada. */
  setRobotOnline: (address: string, online: boolean) => void;
  /** Fase 7 — configurações de rede (PDR/latência/jitter) do World VIVO. */
  netConfig: NetConfigValues;
  /** Fase 7 — ajusta as configurações de rede AO VIVO: muda world.sim, que
   *  o SimGateway/netmodel lê por mensagem — efeito imediato em qualquer
   *  gateway pendurado neste World. Reset volta aos valores do cenário. */
  setNetConfig: (patch: Partial<NetConfigValues>) => void;
  /** Fase 7 (Peça 2) — camada swarmit no navegador: aqui o usuário faz o
   *  papel do backend (liga a camada e manda START/STOP/RESET/flash). */
  swarmitEnabled: boolean;
  setSwarmitEnabled: (on: boolean) => void;
  /** Estado swarmit por robô (só quando a camada está ligada). */
  swarmit: SwarmitView[];
  swarmitStart: (address: string) => void;
  swarmitStop: (address: string) => void;
  swarmitReset: (address: string, x: number, y: number) => void;
  swarmitFlash: (address: string, chunkCount?: number) => void;
}

export function useWorld(scenario: Scenario): UseWorldResult {
  const worldRef = useRef<World | null>(null);
  const scenarioRef = useRef<Scenario | null>(null);
  const trailsRef = useRef<Map<string, Vec2[]>>(new Map());
  const accRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(true);
  // Contador só pra forçar re-render a cada frame / reset.
  const [, setFrame] = useState(0);

  // Fase 7 (Peça 2) — respondedor swarmit por robô, no navegador.
  const swarmitRef = useRef<Map<string, SwarmitDevice>>(new Map());
  const [swarmitEnabled, setSwarmitEnabledState] = useState(false);

  const seedTrails = useCallback((world: World) => {
    const trails = new Map<string, Vec2[]>();
    for (const r of world.robots) {
      trails.set(r.address, [{ x: r.pos_x, y: r.pos_y }]);
    }
    trailsRef.current = trails;
  }, []);

  // Reconstrói ANTES do paint (sem efeito extra) no primeiro render e sempre
  // que o cenário mudar de referência.
  if (worldRef.current === null || scenarioRef.current !== scenario) {
    scenarioRef.current = scenario;
    worldRef.current = loadScenario(scenario);
    seedTrails(worldRef.current);
    accRef.current = 0;
    lastTsRef.current = null;
    swarmitRef.current.clear();
  }

  const reset = useCallback(() => {
    worldRef.current = loadScenario(scenario);
    seedTrails(worldRef.current);
    accRef.current = 0;
    lastTsRef.current = null;
    swarmitRef.current.clear();
    setFrame((f) => f + 1);
  }, [scenario, seedTrails]);

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

  const setRobotOnline = useCallback((address: string, online: boolean) => {
    worldRef.current!.getRobot(address)?.setOnline(online);
    setFrame((f) => f + 1);
  }, []);

  const setNetConfig = useCallback((patch: Partial<NetConfigValues>) => {
    const sim = worldRef.current!.sim;
    if (patch.enabled !== undefined) sim.net_enabled = patch.enabled;
    if (patch.pdr_percent !== undefined) {
      sim.pdr_percent = Math.min(100, Math.max(0, patch.pdr_percent));
    }
    if (patch.slot_latency_ms !== undefined) {
      sim.slot_latency_ms = Math.max(0, patch.slot_latency_ms);
    }
    if (patch.jitter_ms !== undefined) sim.jitter_ms = Math.max(0, patch.jitter_ms);
    setFrame((f) => f + 1);
  }, []);

  // --- Fase 7 (Peça 2): camada swarmit ------------------------------------
  const getSwarmitDevice = useCallback(
    (address: string): SwarmitDevice | undefined => {
      if (!swarmitEnabled) return undefined;
      const map = swarmitRef.current;
      let dev = map.get(address);
      if (!dev) {
        const robot = worldRef.current!.getRobot(address);
        if (!robot) return undefined;
        dev = new SwarmitDevice(robot);
        map.set(address, dev);
      }
      return dev;
    },
    [swarmitEnabled],
  );

  const setSwarmitEnabled = useCallback((on: boolean) => {
    setSwarmitEnabledState(on);
    if (!on) swarmitRef.current.clear();
    setFrame((f) => f + 1);
  }, []);

  const swarmitStart = useCallback(
    (address: string) => {
      getSwarmitDevice(address)?.onCommand({ type: SwarmitPayloadType.SWARMIT_START });
      setFrame((f) => f + 1);
    },
    [getSwarmitDevice],
  );
  const swarmitStop = useCallback(
    (address: string) => {
      getSwarmitDevice(address)?.onCommand({ type: SwarmitPayloadType.SWARMIT_STOP });
      setFrame((f) => f + 1);
    },
    [getSwarmitDevice],
  );
  const swarmitReset = useCallback(
    (address: string, x: number, y: number) => {
      getSwarmitDevice(address)?.onCommand({
        type: SwarmitPayloadType.SWARMIT_RESET,
        pos_x: Math.round(x),
        pos_y: Math.round(y),
      });
      setFrame((f) => f + 1);
    },
    [getSwarmitDevice],
  );
  const swarmitFlash = useCallback(
    (address: string, chunkCount = 8) => {
      const dev = getSwarmitDevice(address);
      if (!dev) return;
      dev.onCommand({
        type: SwarmitPayloadType.SWARMIT_OTA_START,
        fw_length: chunkCount * 128,
        fw_chunk_count: chunkCount,
      });
      for (let i = 0; i < chunkCount; i++) {
        dev.onCommand({
          type: SwarmitPayloadType.SWARMIT_OTA_CHUNK,
          index: i,
          sha: new Uint8Array(SWARMIT_OTA_SHA_SIZE),
          chunk: new Uint8Array(128),
        });
      }
      setFrame((f) => f + 1);
    },
    [getSwarmitDevice],
  );

  const swarmit: SwarmitView[] = swarmitEnabled
    ? worldRef.current!.robots.map((r) => {
        const dev = getSwarmitDevice(r.address);
        return {
          address: r.address,
          status: dev ? dev.status : SwarmitStatusType.Bootloader,
          flashProgress: dev ? dev.flashProgress : 0,
        };
      })
    : [];

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
    injectMoveRawTest,
    setRobotOnline,
    netConfig: {
      enabled: world.sim.net_enabled ?? true,
      pdr_percent: world.sim.pdr_percent,
      slot_latency_ms: world.sim.slot_latency_ms,
      jitter_ms: world.sim.jitter_ms ?? 0,
    },
    setNetConfig,
    swarmitEnabled,
    setSwarmitEnabled,
    swarmit,
    swarmitStart,
    swarmitStop,
    swarmitReset,
    swarmitFlash,
  };
}
