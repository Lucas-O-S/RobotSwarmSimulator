// Painel lateral READ-ONLY: telemetria por robô (Fase 2).

import type { CSSProperties } from 'react';
import { RAD_TO_DEG } from '../core/scenario';
import { ControlModeType, RobotState } from '../core/types';
import { robotColor } from './MapView';

export interface InspectorProps {
  robots: RobotState[];
}

function modeName(mode: ControlModeType): string {
  return mode === ControlModeType.Auto ? 'AUTO' : 'MANUAL';
}

const cellStyle: CSSProperties = {
  padding: '2px 8px',
  borderBottom: '1px solid #f3f4f6',
  whiteSpace: 'nowrap',
};

export default function Inspector({ robots }: InspectorProps) {
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
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            padding: '6px 8px',
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: robotColor(r, i),
                display: 'inline-block',
              }}
            />
            <code style={{ fontSize: 12 }}>{r.address}</code>
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
                <td style={cellStyle}>{modeName(r.mode)}</td>
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
                      (r.waypoint_idx >= r.waypoints.length ? ' (fim)' : '')
                    : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </aside>
  );
}
