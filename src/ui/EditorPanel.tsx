// Painel de propriedades do editor (Fase 3): edita o item selecionado
// (barreira ou robô) por formulário. Toda mutação passa pelas operações
// puras de editorModel.ts (imutáveis, testadas em unidade).

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  ApplicationType,
  ControlModeType,
  Scenario,
  ScenarioObstacle,
  ScenarioRobot,
} from '../core/types';
import { DEFAULT_WAYPOINT_THRESHOLD_MM } from '../core/scenario';
import {
  MIN_OBSTACLE_MM,
  clampRectToArena,
  clampVecToArena,
} from './editorGeometry';
import {
  isValidAddress,
  patchObstacle,
  patchRobot,
  removeRobotWaypoint,
  setObstacleRect,
  setRobotStart,
} from './editorModel';
import { ROBOT_RADIUS_MM } from '../core/Robot';
import type { Selection } from './ScenarioEditor';

const APPLICATIONS: { value: number; label: string }[] = [
  { value: ApplicationType.DotBot, label: 'DotBot' },
  { value: ApplicationType.SailBot, label: 'SailBot' },
  { value: ApplicationType.Freebot, label: 'Freebot' },
  { value: ApplicationType.XGO, label: 'XGO' },
  { value: ApplicationType.LH2_mini_mote, label: 'LH2_mini_mote' },
];

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 6,
  fontSize: 13,
};

const labelStyle: CSSProperties = { width: 90, flexShrink: 0, color: '#374151' };

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '2px 6px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 13,
};

const dangerBtn: CSSProperties = {
  padding: '4px 12px',
  border: '1px solid #fca5a5',
  borderRadius: 6,
  background: '#fef2f2',
  color: '#b91c1c',
  cursor: 'pointer',
  fontSize: 13,
  marginTop: 8,
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

function NumField({
  value,
  onCommit,
  min,
  max,
  step,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      style={inputStyle}
      type="number"
      value={Number.isInteger(value) ? value : Number(value.toFixed(1))}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isFinite(v)) return;
        let c = v;
        if (min !== undefined) c = Math.max(min, c);
        if (max !== undefined) c = Math.min(max, c);
        onCommit(c);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Formulário de BARREIRA
// ---------------------------------------------------------------------------

function ObstacleForm({
  scenario,
  index,
  onChange,
}: {
  scenario: Scenario;
  index: number;
  onChange: (s: Scenario) => void;
}) {
  const o: ScenarioObstacle = scenario.obstacles[index];
  const aw = scenario.arena.width_mm;
  const ah = scenario.arena.height_mm;

  const commitRect = (patch: Partial<{ x: number; y: number; w: number; h: number }>) => {
    const rect = clampRectToArena(
      {
        x: patch.x ?? o.x_mm,
        y: patch.y ?? o.y_mm,
        w: Math.max(MIN_OBSTACLE_MM, patch.w ?? o.w_mm),
        h: Math.max(MIN_OBSTACLE_MM, patch.h ?? o.h_mm),
      },
      aw,
      ah,
    );
    onChange(setObstacleRect(scenario, index, rect));
  };

  return (
    <>
      <h3 style={{ fontSize: 13, margin: '8px 0' }}>Barreira</h3>
      <Row label="id">
        <input
          style={inputStyle}
          type="text"
          value={o.id}
          onChange={(e) => {
            const id = e.target.value;
            if (id.trim().length > 0) onChange(patchObstacle(scenario, index, { id }));
          }}
        />
      </Row>
      <Row label="x (mm)">
        <NumField value={o.x_mm} onCommit={(v) => commitRect({ x: v })} min={0} max={aw} />
      </Row>
      <Row label="y (mm)">
        <NumField value={o.y_mm} onCommit={(v) => commitRect({ y: v })} min={0} max={ah} />
      </Row>
      <Row label="largura (mm)">
        <NumField
          value={o.w_mm}
          onCommit={(v) => commitRect({ w: v })}
          min={MIN_OBSTACLE_MM}
          max={aw}
        />
      </Row>
      <Row label="altura (mm)">
        <NumField
          value={o.h_mm}
          onCommit={(v) => commitRect({ h: v })}
          min={MIN_OBSTACLE_MM}
          max={ah}
        />
      </Row>
    </>
  );
}

// ---------------------------------------------------------------------------
// Formulário de ROBÔ
// ---------------------------------------------------------------------------

function RobotForm({
  scenario,
  index,
  onChange,
}: {
  scenario: Scenario;
  index: number;
  onChange: (s: Scenario) => void;
}) {
  const r: ScenarioRobot = scenario.robots[index];
  const aw = scenario.arena.width_mm;
  const ah = scenario.arena.height_mm;

  // O address tem rascunho local: só é COMMITADO quando válido (16 hex).
  const [addrDraft, setAddrDraft] = useState(r.address);
  const addrOk = isValidAddress(addrDraft);

  const commitPos = (patch: Partial<{ x: number; y: number }>) => {
    const c = clampVecToArena(
      { x: patch.x ?? r.start.x_mm, y: patch.y ?? r.start.y_mm },
      aw,
      ah,
      ROBOT_RADIUS_MM,
    );
    onChange(setRobotStart(scenario, index, { x_mm: c.x, y_mm: c.y }));
  };

  const wps = r.waypoints ?? [];

  return (
    <>
      <h3 style={{ fontSize: 13, margin: '8px 0' }}>Robô</h3>
      <Row label="address">
        <input
          style={{
            ...inputStyle,
            fontFamily: 'monospace',
            borderColor: addrOk ? '#d1d5db' : '#ef4444',
          }}
          type="text"
          maxLength={16}
          value={addrDraft}
          onChange={(e) => {
            const v = e.target.value;
            setAddrDraft(v);
            if (isValidAddress(v)) {
              onChange(patchRobot(scenario, index, { address: v.toUpperCase() }));
            }
          }}
        />
      </Row>
      {!addrOk && (
        <div style={{ fontSize: 12, color: '#b91c1c', margin: '-2px 0 6px 96px' }}>
          address deve ter 16 dígitos hex (0-9, A-F)
        </div>
      )}
      <Row label="application">
        <select
          style={inputStyle}
          value={r.application}
          onChange={(e) =>
            onChange(patchRobot(scenario, index, { application: Number(e.target.value) }))
          }
        >
          {APPLICATIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.value} — {a.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="mode">
        <select
          style={inputStyle}
          value={r.mode}
          onChange={(e) => onChange(patchRobot(scenario, index, { mode: Number(e.target.value) }))}
        >
          <option value={ControlModeType.Manual}>0 — Manual</option>
          <option value={ControlModeType.Auto}>1 — Auto</option>
        </select>
      </Row>
      <Row label="battery (%)">
        <NumField
          value={r.battery}
          onCommit={(v) => onChange(patchRobot(scenario, index, { battery: v }))}
          min={0}
          max={100}
        />
      </Row>
      <Row label="x (mm)">
        <NumField value={r.start.x_mm} onCommit={(v) => commitPos({ x: v })} min={0} max={aw} />
      </Row>
      <Row label="y (mm)">
        <NumField value={r.start.y_mm} onCommit={(v) => commitPos({ y: v })} min={0} max={ah} />
      </Row>
      <Row label="theta (°)">
        <NumField
          value={r.start.theta_deg}
          onCommit={(v) => onChange(setRobotStart(scenario, index, { theta_deg: v }))}
          min={-180}
          max={360}
        />
      </Row>

      {r.mode === ControlModeType.Auto && (
        <div style={{ marginTop: 10 }}>
          <h4 style={{ fontSize: 13, margin: '6px 0' }}>Waypoints (AUTO)</h4>
          <Row label="threshold (mm)">
            <NumField
              value={r.waypoint_threshold_mm ?? DEFAULT_WAYPOINT_THRESHOLD_MM}
              onCommit={(v) =>
                onChange(patchRobot(scenario, index, { waypoint_threshold_mm: v }))
              }
              min={1}
            />
          </Row>
          <Row label="rota em loop">
            <input
              type="checkbox"
              checked={r.loop ?? false}
              title="Repete a rota ao chegar no último waypoint (waypoint_idx cicla); desmarcado, o robô para no fim"
              onChange={(e) =>
                onChange(patchRobot(scenario, index, { loop: e.target.checked }))
              }
            />
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              repetir waypoints (Fase 6)
            </span>
          </Row>
          {wps.length === 0 ? (
            <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0' }}>
              Sem waypoints — use a ferramenta “+ Waypoint” e clique no mapa.
            </p>
          ) : (
            <ol start={0} style={{ margin: '4px 0', paddingLeft: 28, fontSize: 13 }}>
              {wps.map((wp, k) => (
                <li key={k} style={{ marginBottom: 2 }}>
                  ({wp.x_mm.toFixed(0)}, {wp.y_mm.toFixed(0)}) mm{' '}
                  <button
                    style={{
                      border: 'none',
                      background: 'none',
                      color: '#b91c1c',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                    title="Remove este waypoint"
                    onClick={() => onChange(removeRobotWaypoint(scenario, index, k))}
                  >
                    remover
                  </button>
                </li>
              ))}
            </ol>
          )}
          {wps.length > 0 && (
            <button
              style={{
                padding: '2px 8px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
                fontSize: 12,
              }}
              onClick={() => onChange(patchRobot(scenario, index, { waypoints: [] }))}
            >
              Limpar rota
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export interface EditorPanelProps {
  scenario: Scenario;
  selection: Selection | null;
  onChange: (s: Scenario) => void;
  onDelete: () => void;
}

export default function EditorPanel({
  scenario,
  selection,
  onChange,
  onDelete,
}: EditorPanelProps) {
  return (
    <aside
      style={{
        width: 340,
        flexShrink: 0,
        overflow: 'auto',
        borderLeft: '1px solid #e5e7eb',
        padding: '8px 12px',
        fontSize: 13,
      }}
    >
      <h2 style={{ fontSize: 14, margin: '4px 0 8px' }}>Editor — propriedades</h2>

      {selection === null && (
        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>
          <p style={{ margin: '4px 0' }}>Nada selecionado.</p>
          <ul style={{ paddingLeft: 18, margin: '4px 0' }}>
            <li><b>Selecionar</b>: clique num robô/barreira; arraste pra mover.</li>
            <li><b>+ Barreira</b>: arraste no mapa pra desenhar.</li>
            <li><b>+ Robô</b>: clique no mapa pra posicionar.</li>
            <li><b>+ Waypoint</b>: com um robô selecionado, clique no mapa
              (o robô entra em AUTO).</li>
            <li>Alças (quadradinhos) redimensionam a barreira selecionada;
              o ponto azul na seta gira o heading do robô.</li>
            <li><b>Delete</b> apaga o item selecionado.</li>
          </ul>
          <p style={{ margin: '4px 0' }}>
            A simulação fica pausada no modo Editar — você edita o estado
            INICIAL do cenário. “Salvar JSON” baixa o arquivo; “Carregar
            JSON” abre um cenário salvo.
          </p>
        </div>
      )}

      {selection?.kind === 'obstacle' && scenario.obstacles[selection.index] && (
        <ObstacleForm
          key={`o${selection.index}`}
          scenario={scenario}
          index={selection.index}
          onChange={onChange}
        />
      )}

      {selection?.kind === 'robot' && scenario.robots[selection.index] && (
        <RobotForm
          key={`r${selection.index}`}
          scenario={scenario}
          index={selection.index}
          onChange={onChange}
        />
      )}

      {selection !== null && (
        <button style={dangerBtn} onClick={onDelete}>
          Deletar {selection.kind === 'obstacle' ? 'barreira' : 'robô'}
        </button>
      )}
    </aside>
  );
}
