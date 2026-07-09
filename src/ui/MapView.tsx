// Mapa 2D de topo, READ-ONLY (Fase 2) — Canvas 2D.
//
// CONVENÇÃO DE EIXOS: o mundo usa origem no canto INFERIOR-esquerdo com Y
// crescendo PRA CIMA (padrão matemático; theta=0 aponta +X, theta=90° aponta
// +Y = "norte" na tela). O canvas tem Y crescendo pra baixo, então o desenho
// espelha: sy = alturaCanvas - y*escala.
//
// Escala: mundo(mm) → tela(px) com "fit" à área disponível, mantendo a
// proporção da arena (ResizeObserver no contêiner).

import { useEffect, useRef, useState } from 'react';
import { ROBOT_RADIUS_MM } from '../core/Robot';
import {
  ArenaConfig,
  ControlModeType,
  Obstacle,
  RobotState,
  Vec2,
} from '../core/types';

export interface MapViewProps {
  arena: ArenaConfig;
  obstacles: Obstacle[];
  robots: RobotState[];
  trails: ReadonlyMap<string, readonly Vec2[]>;
}

// Paleta padrão quando o robô não tem RGB definido (LED apagado = 0,0,0).
const FALLBACK_COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];

export function robotColor(r: RobotState, index: number): string {
  const { r: red, g, b } = r.rgb;
  if (red === 0 && g === 0 && b === 0) {
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }
  return `rgb(${red}, ${g}, ${b})`;
}

function draw(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  { arena, obstacles, robots, trails }: MapViewProps,
): void {
  const scale = Math.min(cssW / arena.width, cssH / arena.height);
  const mapW = arena.width * scale;
  const mapH = arena.height * scale;
  // mundo → tela (Y invertido; ver convenção no topo do arquivo)
  const sx = (x: number) => x * scale;
  const sy = (y: number) => mapH - y * scale;

  ctx.clearRect(0, 0, cssW, cssH);

  // fundo da arena
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, mapW, mapH);

  // grid conforme arena.grid_mm
  if (arena.grid > 0) {
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = arena.grid; x < arena.width; x += arena.grid) {
      ctx.moveTo(sx(x), 0);
      ctx.lineTo(sx(x), mapH);
    }
    for (let y = arena.grid; y < arena.height; y += arena.grid) {
      ctx.moveTo(0, sy(y));
      ctx.lineTo(mapW, sy(y));
    }
    ctx.stroke();
  }

  // borda da arena
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, mapW, mapH);

  // obstáculos (retângulos AABB; x,y = canto inferior-esquerdo no mundo)
  for (const o of obstacles) {
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(sx(o.x), sy(o.y + o.h), o.w * scale, o.h * scale);
    ctx.fillStyle = '#f9fafb';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.id, sx(o.x + o.w / 2), sy(o.y + o.h / 2), o.w * scale - 4);
  }

  robots.forEach((r, i) => {
    const color = robotColor(r, i);

    // trilha recente
    const trail = trails.get(r.address);
    if (trail && trail.length > 1) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx(trail[0].x), sy(trail[0].y));
      for (let k = 1; k < trail.length; k++) ctx.lineTo(sx(trail[k].x), sy(trail[k].y));
      ctx.lineTo(sx(r.pos_x), sy(r.pos_y));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // rota (AUTO): polilinha tracejada + marcadores; alvo atual destacado
    if (r.mode === ControlModeType.Auto && r.waypoints.length > 0) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx(r.pos_x), sy(r.pos_y));
      for (let k = Math.min(r.waypoint_idx, r.waypoints.length - 1); k < r.waypoints.length; k++) {
        ctx.lineTo(sx(r.waypoints[k].x), sy(r.waypoints[k].y));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      r.waypoints.forEach((wp, k) => {
        const reached = k < r.waypoint_idx;
        const current = k === r.waypoint_idx;
        ctx.beginPath();
        ctx.arc(sx(wp.x), sy(wp.y), current ? 6 : 4, 0, 2 * Math.PI);
        ctx.fillStyle = reached ? '#d1d5db' : color;
        ctx.globalAlpha = current ? 1 : 0.6;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#374151';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(k), sx(wp.x) + 7, sy(wp.y) - 3);
      });
    }

    // corpo do robô (círculo no raio real de colisão, mínimo 4 px)
    const rad = Math.max(ROBOT_RADIUS_MM * scale, 4);
    ctx.beginPath();
    ctx.arc(sx(r.pos_x), sy(r.pos_y), rad, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1;
    ctx.stroke();

    // seta de heading (theta) — no canvas o Y é invertido, daí o -sin
    const hx = sx(r.pos_x) + Math.cos(r.theta) * rad * 2;
    const hy = sy(r.pos_y) - Math.sin(r.theta) * rad * 2;
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(r.pos_x), sy(r.pos_y));
    ctx.lineTo(hx, hy);
    ctx.stroke();

    // rótulo curto (4 últimos dígitos do address)
    ctx.fillStyle = '#374151';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(r.address.slice(-4), sx(r.pos_x), sy(r.pos_y) + rad + 3);
  });
}

export default function MapView(props: MapViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState({ w: 640, h: 480 });

  // fit à área disponível do contêiner
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setAvail({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min(avail.w / props.arena.width, avail.h / props.arena.height);
  const cssW = Math.max(1, Math.floor(props.arena.width * scale));
  const cssH = Math.max(1, Math.floor(props.arena.height * scale));

  // redesenha a cada render (o hook re-renderiza por frame enquanto roda)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, cssW, cssH, props);
  });

  return (
    <div
      ref={wrapRef}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: cssW, height: cssH, border: '1px solid #d1d5db' }}
      />
    </div>
  );
}
