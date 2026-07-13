// Painel lateral: telemetria por robô (Fase 2) + status online/offline e
// fault injection — derrubar/religar um robô durante a simulação (Fase 6).

import type { CSSProperties } from 'react';
import { RAD_TO_DEG } from '../core/scenario';
import { ControlModeType, RobotState } from '../core/types';
import { robotColor } from './MapView';

export interface InspectorProps {
  robots: RobotState[];
  /** Fault injection (Fase 6): derruba/religa o robô na rede. Se ausente,
   *  o painel fica read-only (comportamento das fases anteriores). */
  onSetOnline?: (address: string, online: boolean) => void;
}

function modeName(r: RobotState): string {
  if (r.mode !== ControlModeType.Auto) return 'MANUAL';
  return r.loop ? 'AUTO (loop)' : 'AUTO';
}

const cellStyle: CSSProperties = {
  padding: '2px 8px',
  borderBottom: '1px solid #f3f4f6',
  whiteSpace: 'nowrap',
};

export default function Inspector({ robots, onSetOnline }: InspectorProps) {
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
      <h2 style={{ fontSize: 14, margin: '4px 0 8px' }}>
        Robôs ({robots.length}) — telemetria
      </h2>
      {robots.map((r, i) => (
        <div
          key={r.address}
          style={{
            border: `1px solid ${r.online ? '#e5e7eb' : '#d1d5db'}`,
            borderRadius: 6,
            padding: '6px 8px',
            marginBottom: 8,
            background: r.online ? '#fff' : '#f3f4f6',
            opacity: r.online ? 1 : 0.75,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: r.online ? robotColor(r, i) : '#9ca3af',
                display: 'inline-block',
              }}
            />
            <code style={{ fontSize: 12 }}>{r.address}</code>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                fontWeight: 600,
                color: r.online ? '#047857' : '#b91c1c',
              }}
            >
              {r.online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <tr>
                <td style={cellStyle}>pos (mm)</td>
                <td style={cellStyle}>
                  x={r.pos_x.toFixed(0)} y={r.pos_y.toFixed(0)}
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>theta</td>
                <td style={cellStyle}>{(r.theta * RAD_TO_DEG).toFixed(1)}°</td>
              </tr>
              <tr>
                <td style={cellStyle}>modo</td>
                <td style={cellStyle}>{modeName(r)}</td>
              </tr>
              <tr>
                <td style={cellStyle}>bateria</td>
                <td style={cellStyle}>{r.battery.toFixed(1)}%</td>
              </tr>
              <tr>
                <td style={cellStyle}>pwm L/R</td>
                <td style={cellStyle}>
                  {r.pwm_left} / {r.pwm_right}
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>wp_idx</td>
                <td style={cellStyle}>
                  {r.waypoints.length > 0
                    ? `${r.waypoint_idx}/${r.waypoints.length}` +
                      (r.loop
                        ? ' (loop)'
                        : r.waypoint_idx >= r.waypoints.length
                          ? ' (fim)'
                          : '')
                    : '—'}
                </td>
              </tr>
            </tbody>
          </table>
          {onSetOnline && (
            <button
              style={{
                marginTop: 6,
                padding: '3px 10px',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
                border: `1px solid ${r.online ? '#fca5a5' : '#6ee7b7'}`,
                background: r.online ? '#fef2f2' : '#ecfdf5',
                color: r.online ? '#b91c1c' : '#047857',
              }}
              disabled={!r.online && r.battery <= 0}
              title={
                r.online
                  ? 'Injeta falha: o robô sai da rede (o gateway emite NODE_LEFT)'
                  : r.battery <= 0
                    ? 'Sem bateria — religar não ressuscita bateria zerada'
                    : 'Religa o robô (o gateway re-emite NODE_JOINED)'
              }
              onClick={() => onSetOnline(r.address, !r.online)}
            >
              {r.online ? 'Derrubar (falha)' : 'Religar'}
            </button>
          )}
        </div>
      ))}
    </aside>
  );
}
