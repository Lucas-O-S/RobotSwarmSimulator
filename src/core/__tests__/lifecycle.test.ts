// Fase 6 — ciclo de vida / liveness no NÚCLEO: online/offline por bateria
// zerada ou injeção de falha (setOnline). Os timers ACTIVE→INACTIVE(5 s)→
// LOST(60 s) são do controller/backend e NÃO são testados aqui — só o
// gatilho local (o robô que sai/volta da rede).

import { describe, expect, it } from 'vitest';
import { Robot } from '../Robot';
import { World } from '../World';
import { RobotStatus } from '../types';

const ADDR = 'BDF2B04BC00D2725';

function makeWorld(robots: Robot[], drainPerMin = 1.0): World {
  return new World({
    arena: { width: 4000, height: 4000, grid: 100 },
    network: { id: '1200', gateway_addr: '0000000000000001' },
    sim: {
      tick_hz: 50,
      advertise_hz: 2,
      battery_drain_per_min: drainPerMin,
      pdr_percent: 100,
      slot_latency_ms: 0,
    },
    robots,
  });
}

describe('Robot — ciclo de vida (online/offline)', () => {
  it('nasce online, com status Active e loop desligado', () => {
    const robot = new Robot({ address: ADDR, x: 500, y: 500, theta: 0 });
    expect(robot.online).toBe(true);
    expect(robot.status).toBe(RobotStatus.Active);
    expect(robot.loop).toBe(false);
  });

  it('bateria → 0 derruba o robô (online=false, status Inactive)', () => {
    const robot = new Robot({ address: ADDR, x: 500, y: 500, theta: 0, battery: 1 });
    const world = makeWorld([robot], 6000); // 100%/s — morre em ~0.01 s
    expect(robot.online).toBe(true);
    world.step(1);
    expect(robot.battery).toBe(0);
    expect(robot.online).toBe(false);
    expect(robot.status).toBe(RobotStatus.Inactive);
  });

  it('setOnline(false)/(true) alterna a falha injetada', () => {
    const robot = new Robot({ address: ADDR, x: 500, y: 500, theta: 0 });
    robot.setOnline(false);
    expect(robot.online).toBe(false);
    expect(robot.status).toBe(RobotStatus.Inactive);
    robot.setOnline(true);
    expect(robot.online).toBe(true);
    expect(robot.status).toBe(RobotStatus.Active);
  });

  it('religar com bateria zerada NÃO ressuscita (sem energia não há rádio)', () => {
    const robot = new Robot({ address: ADDR, x: 500, y: 500, theta: 0, battery: 0 });
    expect(robot.online).toBe(false);
    robot.setOnline(true);
    expect(robot.online).toBe(false);
  });

  it('snapshot expõe online/status/loop coerentes', () => {
    const robot = new Robot({ address: ADDR, x: 500, y: 500, theta: 0 });
    robot.loop = true;
    expect(robot.snapshot()).toMatchObject({
      online: true,
      status: RobotStatus.Active,
      loop: true,
    });
    robot.setOnline(false);
    expect(robot.snapshot()).toMatchObject({
      online: false,
      status: RobotStatus.Inactive,
    });
  });
});
