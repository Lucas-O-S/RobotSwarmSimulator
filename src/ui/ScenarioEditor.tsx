// Editor de cenário (Fase 3) — Canvas 2D com as MESMAS convenções do
// MapView (origem inferior-esquerda, Y pra cima, escala fit ao contêiner).
//
// O editor manipula o cenário direto no formato JSON (`Scenario`, mm/graus):
// "Simular" só faz loadScenario(draft) — sem conversão intermediária.
// A geometria (resize/snap/hit-test) é pura e vive em editorGeometry.ts;
// as operações sobre o cenário, em editorModel.ts. Aqui fica só a cola
// React/Canvas (eventos de mouse, desenho, ferramenta ativa).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { ROBOT_RADIUS_MM } from '../core/Robot';
import { DEG_TO_RAD } from '../core/scenario';
import {
  ControlModeType,
  Scenario,
  ScenarioObstacle,
  ScenarioRobot,
  Vec2,
} from '../core/types';
import EditorPanel from './EditorPanel';
import { FALLBACK_COLORS } from './MapView';
import {
  HANDLES,
  HandleId,
  MIN_OBSTACLE_MM,
  Rect,
  clampRectToArena,
  clampVecToArena,
  handlePoint,
  hitHandle,
  moveRectTo,
  pointInRect,
  rectFromCorners,
  resizeRect,
  snapAngleDeg,
  snapVec,
} from './editorGeometry';
import {
  addObstacle,
  addRobot,
  addRobotWaypoint,
  makeObstacle,
  makeRobot,
  removeObstacle,
  removeRobot,
  setObstacleRect,
  setRobotStart,
} from './editorModel';

export type Selection =
  | { kind: 'obstacle'; index: number }
  | { kind: 'robot'; index: number };

export type Tool = 'select' | 'obstacle' | 'robot' | 'waypoint';

type DragState =
  | { kind: 'draw'; start: Vec2; cur: Vec2 }
  | { kind: 'move-obstacle'; index: number; offset: Vec2 }
  | { kind: 'resize-obstacle'; index: number; handle: HandleId }
  | { kind: 'move-robot'; index: number; offset: Vec2 }
  | { kind: 'rotate-robot'; index: number };

const HIT_TOL_PX = 8;      // tolerância de clique em alças/pontos
const HEADING_SNAP_DEG = 15;

function obstacleRect(o: ScenarioObstacle): Rect {
  return { x: o.x_mm, y: o.y_mm, w: o.w_mm, h: o.h_mm };
}

/** Ponta da seta de heading (mundo, mm) — mesmo comprimento do MapView. */
function headingTip(r: ScenarioRobot, scale: number): Vec2 {
  const radPx = Math.max(ROBOT_RADIUS_MM * scale, 4);
  const lenMm = (radPx * 2) / scale;
  const th = r.start.theta_deg * DEG_TO_RAD;
  return {
    x: r.start.x_mm + Math.cos(th) * lenMm,
    y: r.start.y_mm + Math.sin(th) * lenMm,
  };
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

function draw(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  s: Scenario,
  selection: Selection | null,
  drag: DragState | null,
  scale: number,
): void {
  const sx = (x: number) => x * scale;
  const sy = (y: number) => cssH - y * scale;

  ctx.clearRect(0, 0, cssW, cssH);

  // fundo + grid + borda (mesma estética do MapView)
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, cssW, cssH);
  if (s.arena.grid_mm > 0) {
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = s.arena.grid_mm; x < s.arena.width_mm; x += s.arena.grid_mm) {
      ctx.moveTo(sx(x), 0);
      ctx.lineTo(sx(x), cssH);
    }
    for (let y = s.arena.grid_mm; y < s.arena.height_mm; y += s.arena.grid_mm) {
      ctx.moveTo(0, sy(y));
      ctx.lineTo(cssW, sy(y));
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, cssW, cssH);

  // obstáculos
  s.obstacles.forEach((o, i) => {
    const selected = selection?.kind === 'obstacle' && selection.index === i;
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(sx(o.x_mm), sy(o.y_mm + o.h_mm), o.w_mm * scale, o.h_mm * scale);
    ctx.fillStyle = '#f9fafb';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.id, sx(o.x_mm + o.w_mm / 2), sy(o.y_mm + o.h_mm / 2), o.w_mm * scale - 4);

    if (selected) {
      const r = obstacleRect(o);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(r.x), sy(r.y + r.h), r.w * scale, r.h * scale);
      for (const h of HANDLES) {
        const hp = handlePoint(r, h);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.fillRect(sx(hp.x) - 4, sy(hp.y) - 4, 8, 8);
        ctx.strokeRect(sx(hp.x) - 4, sy(hp.y) - 4, 8, 8);
      }
    }
  });

  // robôs (pose inicial) + rotas
  s.robots.forEach((r, i) => {
    const color = FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    const selected = selection?.kind === 'robot' && selection.index === i;
    const cx = sx(r.start.x_mm);
    const cy = sy(r.start.y_mm);
    const radPx = Math.max(ROBOT_RADIUS_MM * scale, 4);

    // rota persistida (esmaecida se o robô não está em AUTO)
    const wps = r.waypoints ?? [];
    if (wps.length > 0) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = r.mode === ControlModeType.Auto ? 0.5 : 0.2;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (const wp of wps) ctx.lineTo(sx(wp.x_mm), sy(wp.y_mm));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      wps.forEach((wp, k) => {
        ctx.beginPath();
        ctx.arc(sx(wp.x_mm), sy(wp.y_mm), 4, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = r.mode === ControlModeType.Auto ? 0.7 : 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#374151';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(k), sx(wp.x_mm) + 7, sy(wp.y_mm) - 3);
      });
    }

    // corpo + seta de heading
    ctx.beginPath();
    ctx.arc(cx, cy, radPx, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1;
    ctx.stroke();

    const th = r.start.theta_deg * DEG_TO_RAD;
    const hx = cx + Math.cos(th) * radPx * 2;
    const hy = cy - Math.sin(th) * radPx * 2;
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    ctx.fillStyle = '#374151';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(r.address.slice(-4), cx, cy + radPx + 3);

    if (selected) {
      // anel de seleção + alça de rotação na ponta da seta
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, radPx + 6, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, 2 * Math.PI);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  // pré-visualização da barreira sendo desenhada
  if (drag?.kind === 'draw') {
    const r = rectFromCorners(drag.start, drag.cur);
    ctx.fillStyle = 'rgba(37, 99, 235, 0.15)';
    ctx.fillRect(sx(r.x), sy(r.y + r.h), r.w * scale, r.h * scale);
    ctx.strokeStyle = '#2563eb';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx(r.x), sy(r.y + r.h), r.w * scale, r.h * scale);
    ctx.setLineDash([]);
  }
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export interface ScenarioEditorProps {
  scenario: Scenario;
  onChange: (s: Scenario) => void;
}

const toolBtn = (active: boolean) =>
  ({
    padding: '4px 12px',
    border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`,
    borderRadius: 6,
    background: active ? '#dbeafe' : '#fff',
    cursor: 'pointer',
    fontSize: 13,
  }) as const;

const TOOL_HINTS: Record<Tool, string> = {
  select: 'clique pra selecionar; arraste pra mover; alças redimensionam; Delete apaga',
  obstacle: 'arraste no mapa pra desenhar uma barreira',
  robot: 'clique no mapa pra posicionar um robô novo',
  waypoint: 'selecione um robô e clique no mapa pra adicionar waypoints (entra em AUTO)',
};

export default function ScenarioEditor({ scenario, onChange }: ScenarioEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState({ w: 640, h: 480 });

  const [tool, setTool] = useState<Tool>('select');
  const [snap, setSnap] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // Refs espelhando o estado — os handlers de mousemove/mouseup/keydown são
  // registrados no window e precisam ler o valor ATUAL sem re-registrar.
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const dragRef = useRef<DragState | null>(drag);

  const setDragBoth = useCallback((d: DragState | null) => {
    dragRef.current = d;
    setDrag(d);
  }, []);

  // fit à área disponível (idêntico ao MapView)
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

  const scale = Math.min(
    avail.w / scenario.arena.width_mm,
    avail.h / scenario.arena.height_mm,
  );
  const cssW = Math.max(1, Math.floor(scenario.arena.width_mm * scale));
  const cssH = Math.max(1, Math.floor(scenario.arena.height_mm * scale));

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const cssHRef = useRef(cssH);
  cssHRef.current = cssH;

  /** Posição do mouse em coordenadas de MUNDO (mm, Y pra cima). */
  const toWorld = useCallback((clientX: number, clientY: number): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / scaleRef.current,
      y: (cssHRef.current - (clientY - rect.top)) / scaleRef.current,
    };
  }, []);

  const deleteSelection = useCallback(() => {
    const sel = selectionRef.current;
    if (!sel) return;
    const s = scenarioRef.current;
    onChangeRef.current(
      sel.kind === 'obstacle' ? removeObstacle(s, sel.index) : removeRobot(s, sel.index),
    );
    setSelection(null);
  }, []);

  // Delete/Backspace apagam a seleção (fora de inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      deleteSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelection]);

  const onCanvasMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const p = toWorld(e.clientX, e.clientY);
    const s = scenario;
    const grid = snap ? s.arena.grid_mm : 0;
    const aw = s.arena.width_mm;
    const ah = s.arena.height_mm;

    if (tool === 'obstacle') {
      const sp = clampVecToArena(snapVec(p, grid), aw, ah);
      setDragBoth({ kind: 'draw', start: sp, cur: sp });
      return;
    }

    if (tool === 'robot') {
      const sp = clampVecToArena(snapVec(p, grid), aw, ah, ROBOT_RADIUS_MM);
      onChange(addRobot(s, makeRobot(s, sp)));
      setSelection({ kind: 'robot', index: s.robots.length });
      return;
    }

    if (tool === 'waypoint') {
      if (selection?.kind === 'robot') {
        const sp = clampVecToArena(snapVec(p, grid), aw, ah);
        onChange(addRobotWaypoint(s, selection.index, sp));
      }
      return;
    }

    // ferramenta SELECIONAR
    const tol = HIT_TOL_PX / scale;

    if (selection?.kind === 'obstacle') {
      const h = hitHandle(obstacleRect(s.obstacles[selection.index]), p, tol);
      if (h) {
        setDragBoth({ kind: 'resize-obstacle', index: selection.index, handle: h });
        return;
      }
    }

    if (selection?.kind === 'robot') {
      const tip = headingTip(s.robots[selection.index], scale);
      if (Math.hypot(p.x - tip.x, p.y - tip.y) <= tol * 1.5) {
        setDragBoth({ kind: 'rotate-robot', index: selection.index });
        return;
      }
    }

    for (let i = s.robots.length - 1; i >= 0; i--) {
      const r = s.robots[i];
      if (Math.hypot(p.x - r.start.x_mm, p.y - r.start.y_mm) <= Math.max(ROBOT_RADIUS_MM, tol)) {
        setSelection({ kind: 'robot', index: i });
        setDragBoth({
          kind: 'move-robot',
          index: i,
          offset: { x: p.x - r.start.x_mm, y: p.y - r.start.y_mm },
        });
        return;
      }
    }

    for (let i = s.obstacles.length - 1; i >= 0; i--) {
      const r = obstacleRect(s.obstacles[i]);
      if (pointInRect(p, r)) {
        setSelection({ kind: 'obstacle', index: i });
        setDragBoth({
          kind: 'move-obstacle',
          index: i,
          offset: { x: p.x - r.x, y: p.y - r.y },
        });
        return;
      }
    }

    setSelection(null);
  };

  // mousemove/mouseup no WINDOW enquanto arrasta (funciona fora do canvas)
  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const s = scenarioRef.current;
      const grid = snapRef.current ? s.arena.grid_mm : 0;
      const aw = s.arena.width_mm;
      const ah = s.arena.height_mm;
      const p = toWorld(e.clientX, e.clientY);

      switch (d.kind) {
        case 'draw': {
          setDragBoth({ ...d, cur: clampVecToArena(snapVec(p, grid), aw, ah) });
          break;
        }
        case 'move-obstacle': {
          const r = obstacleRect(s.obstacles[d.index]);
          const origin = snapVec({ x: p.x - d.offset.x, y: p.y - d.offset.y }, grid);
          onChangeRef.current(
            setObstacleRect(s, d.index, clampRectToArena(moveRectTo(r, origin), aw, ah)),
          );
          break;
        }
        case 'resize-obstacle': {
          const r = obstacleRect(s.obstacles[d.index]);
          const sp = clampVecToArena(snapVec(p, grid), aw, ah);
          onChangeRef.current(
            setObstacleRect(
              s,
              d.index,
              clampRectToArena(resizeRect(r, d.handle, sp, MIN_OBSTACLE_MM), aw, ah),
            ),
          );
          break;
        }
        case 'move-robot': {
          const c = clampVecToArena(
            snapVec({ x: p.x - d.offset.x, y: p.y - d.offset.y }, grid),
            aw,
            ah,
            ROBOT_RADIUS_MM,
          );
          onChangeRef.current(setRobotStart(s, d.index, { x_mm: c.x, y_mm: c.y }));
          break;
        }
        case 'rotate-robot': {
          const r = s.robots[d.index];
          const deg = Math.atan2(p.y - r.start.y_mm, p.x - r.start.x_mm) / DEG_TO_RAD;
          const snapped = snapRef.current
            ? snapAngleDeg(deg, HEADING_SNAP_DEG)
            : Math.round(deg);
          onChangeRef.current(setRobotStart(s, d.index, { theta_deg: snapped }));
          break;
        }
      }
    };

    const onUp = () => {
      const d = dragRef.current;
      if (d?.kind === 'draw') {
        const s = scenarioRef.current;
        const rect = rectFromCorners(d.start, d.cur);
        if (rect.w >= MIN_OBSTACLE_MM && rect.h >= MIN_OBSTACLE_MM) {
          const clamped = clampRectToArena(rect, s.arena.width_mm, s.arena.height_mm);
          onChangeRef.current(addObstacle(s, makeObstacle(s, clamped)));
          setSelection({ kind: 'obstacle', index: s.obstacles.length });
        }
      }
      setDragBoth(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragActive, setDragBoth, toWorld]);

  // desenho a cada render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, cssW, cssH, scenario, selection, drag, scale);
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 16px',
          borderBottom: '1px solid #f3f4f6',
          flexWrap: 'wrap',
        }}
      >
        <button style={toolBtn(tool === 'select')} onClick={() => setTool('select')}>
          Selecionar
        </button>
        <button style={toolBtn(tool === 'obstacle')} onClick={() => setTool('obstacle')}>
          + Barreira
        </button>
        <button style={toolBtn(tool === 'robot')} onClick={() => setTool('robot')}>
          + Robô
        </button>
        <button style={toolBtn(tool === 'waypoint')} onClick={() => setTool('waypoint')}>
          + Waypoint
        </button>

        <label style={{ fontSize: 13, marginLeft: 8 }}>
          <input
            type="checkbox"
            checked={snap}
            onChange={(e) => setSnap(e.target.checked)}
          />{' '}
          snap ao grid ({scenario.arena.grid_mm} mm)
        </label>

        <button
          style={{ ...toolBtn(false), marginLeft: 8 }}
          onClick={deleteSelection}
          disabled={selection === null}
          title="Apaga o item selecionado (atalho: Delete)"
        >
          Deletar
        </button>

        <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
          {TOOL_HINTS[tool]}
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
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
            onMouseDown={onCanvasMouseDown}
            style={{
              width: cssW,
              height: cssH,
              border: '1px solid #d1d5db',
              cursor: tool === 'select' ? 'default' : 'crosshair',
            }}
          />
        </div>
        <EditorPanel
          scenario={scenario}
          selection={selection}
          onChange={onChange}
          onDelete={deleteSelection}
        />
      </div>
    </div>
  );
}
