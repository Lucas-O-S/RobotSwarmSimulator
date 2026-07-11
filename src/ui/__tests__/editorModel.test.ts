// Operações puras do editor sobre o cenário (Fase 3): address, criação de
// robô/barreira, waypoints e validação de arquivo carregado.

import { describe, expect, it } from 'vitest';
import { ControlModeType, Scenario } from '../../core/types';
import { DEFAULT_WAYPOINT_THRESHOLD_MM } from '../../core/scenario';
import {
  addObstacle,
  addRobot,
  addRobotWaypoint,
  cloneScenario,
  generateAddress,
  isValidAddress,
  makeObstacle,
  makeRobot,
  parseScenarioFile,
  removeRobotWaypoint,
  uniqueObstacleId,
} from '../editorModel';

function baseScenario(): Scenario {
  return {
    version: 1,
    network: { id: '1200', gateway_addr: '0000000000000001' },
    arena: { width_mm: 2000, height_mm: 2000, grid_mm: 100 },
    obstacles: [{ id: 'barreira-1', x_mm: 900, y_mm: 600, w_mm: 200, h_mm: 800 }],
    robots: [
      {
        address: 'BDF2B04BC00D2725',
        application: 0,
        mode: 0,
        start: { x_mm: 300, y_mm: 300, theta_deg: 0 },
        battery: 100,
      },
    ],
    sim: {
      tick_hz: 50,
      advertise_hz: 2,
      battery_drain_per_min: 1.0,
      pdr_percent: 100,
      slot_latency_ms: 0,
    },
  };
}

describe('address', () => {
  it('valida 16 dígitos hex (case-insensitive)', () => {
    expect(isValidAddress('BDF2B04BC00D2725')).toBe(true);
    expect(isValidAddress('bdf2b04bc00d2725')).toBe(true);
    expect(isValidAddress('BDF2B04BC00D272')).toBe(false);  // 15 chars
    expect(isValidAddress('BDF2B04BC00D27255')).toBe(false); // 17 chars
    expect(isValidAddress('GDF2B04BC00D2725')).toBe(false);  // não-hex
    expect(isValidAddress('')).toBe(false);
  });

  it('gera address válido, maiúsculo e único', () => {
    const existing = ['BDF2B04BC00D2725'];
    const a = generateAddress(existing);
    expect(isValidAddress(a)).toBe(true);
    expect(a).toBe(a.toUpperCase());
    expect(existing).not.toContain(a);
  });

  it('evita colisão com endereços existentes (rng determinístico)', () => {
    // rng constante 0 geraria sempre "000...0"; o primeiro candidato colide
    // e o gerador precisa tentar de novo com os próximos valores.
    let calls = 0;
    const rng = () => {
      calls++;
      return calls <= 16 ? 0 : 0.5;
    };
    const a = generateAddress(['0000000000000000'], rng);
    expect(a).toBe('8888888888888888');
  });
});

describe('criação de itens', () => {
  it('uniqueObstacleId pula ids já usados', () => {
    expect(uniqueObstacleId(['barreira-1', 'barreira-2'])).toBe('barreira-3');
    expect(uniqueObstacleId([])).toBe('barreira-1');
  });

  it('makeRobot cria robô válido em MANUAL com bateria 100', () => {
    const s = baseScenario();
    const r = makeRobot(s, { x: 500, y: 700 });
    expect(isValidAddress(r.address)).toBe(true);
    expect(r.address).not.toBe(s.robots[0].address);
    expect(r.mode).toBe(ControlModeType.Manual);
    expect(r.battery).toBe(100);
    expect(r.start).toEqual({ x_mm: 500, y_mm: 700, theta_deg: 90 });
  });

  it('makeObstacle usa o retângulo e um id novo; addX não muta o original', () => {
    const s = baseScenario();
    const o = makeObstacle(s, { x: 100, y: 100, w: 300, h: 50 });
    expect(o).toEqual({ id: 'barreira-2', x_mm: 100, y_mm: 100, w_mm: 300, h_mm: 50 });

    const s2 = addObstacle(s, o);
    const s3 = addRobot(s2, makeRobot(s2, { x: 1, y: 1 }));
    expect(s.obstacles).toHaveLength(1); // original intacto
    expect(s.robots).toHaveLength(1);
    expect(s3.obstacles).toHaveLength(2);
    expect(s3.robots).toHaveLength(2);
  });
});

describe('waypoints do editor', () => {
  it('addRobotWaypoint acrescenta ponto, entra em AUTO e aplica threshold default', () => {
    const s = baseScenario();
    const s2 = addRobotWaypoint(s, 0, { x: 1000, y: 1200 });
    const r = s2.robots[0];
    expect(r.mode).toBe(ControlModeType.Auto);
    expect(r.waypoints).toEqual([{ x_mm: 1000, y_mm: 1200 }]);
    expect(r.waypoint_threshold_mm).toBe(DEFAULT_WAYPOINT_THRESHOLD_MM);
    expect(s.robots[0].waypoints).toBeUndefined(); // original intacto
  });

  it('removeRobotWaypoint tira só o ponto pedido', () => {
    let s = baseScenario();
    s = addRobotWaypoint(s, 0, { x: 1, y: 2 });
    s = addRobotWaypoint(s, 0, { x: 3, y: 4 });
    const s2 = removeRobotWaypoint(s, 0, 0);
    expect(s2.robots[0].waypoints).toEqual([{ x_mm: 3, y_mm: 4 }]);
  });
});

describe('parseScenarioFile (upload)', () => {
  it('aceita cenário válido e normaliza address pra maiúsculas', () => {
    const s = baseScenario();
    s.robots[0].address = 'bdf2b04bc00d2725';
    const res = parseScenarioFile(JSON.stringify(s));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.scenario.robots[0].address).toBe('BDF2B04BC00D2725');
      expect(res.scenario.arena.width_mm).toBe(2000);
    }
  });

  it('aceita cenário da Fase 3 com waypoints', () => {
    const s = baseScenario();
    s.robots[0].mode = 1;
    s.robots[0].waypoints = [{ x_mm: 1500, y_mm: 300 }];
    const res = parseScenarioFile(JSON.stringify(s));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.scenario.robots[0].waypoints).toEqual([{ x_mm: 1500, y_mm: 300 }]);
    }
  });

  it('rejeita JSON malformado com mensagem amigável', () => {
    const res = parseScenarioFile('{ isso não é json');
    expect(res).toEqual({ ok: false, error: 'O arquivo não é um JSON válido.' });
  });

  it('rejeita cenário inválido repassando o erro do core', () => {
    const s = baseScenario();
    s.robots[0].address = 'XYZ';
    const res = parseScenarioFile(JSON.stringify(s));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/16 dígitos hex/);

    const res2 = parseScenarioFile(JSON.stringify({ hello: 'world' }));
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.error).toMatch(/Cenário inválido/);
  });
});

describe('cloneScenario', () => {
  it('cópia profunda: mexer no clone não afeta o original', () => {
    const s = baseScenario();
    const c = cloneScenario(s);
    c.obstacles[0].x_mm = 1;
    c.robots[0].start.x_mm = 1;
    expect(s.obstacles[0].x_mm).toBe(900);
    expect(s.robots[0].start.x_mm).toBe(300);
  });
});
