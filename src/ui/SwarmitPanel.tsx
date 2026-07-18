// Fase 7 (Peça 2) — painel swarmit no navegador. Aqui o usuário faz o papel
// do BACKEND (control plane): liga a camada e manda START/STOP/RESET/flash
// pra cada robô; o simulador (respondedor) reage e mostra o estado do
// dispositivo (Bootloader/Programming/Running + progresso de flash).
//
// No hardware real quem manda esses comandos é o backend via MQTT; este
// painel é só um "backend de bolso" pra exercitar/visualizar a camada sem
// precisar do NestJS rodando.

import { SwarmitStatusType, swarmitStatusName } from '../protocol';
import { SwarmitView } from './useWorld';

const box = {
  padding: '8px 16px',
  borderBottom: '1px solid #e5e7eb',
  background: '#faf5ff',
  fontSize: 13,
} as const;

const btn = {
  padding: '2px 8px',
  border: '1px solid #d1d5db',
  borderRadius: 5,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 12,
} as const;

const statusColor: Record<SwarmitStatusType, string> = {
  [SwarmitStatusType.Bootloader]: '#6b7280',
  [SwarmitStatusType.Running]: '#059669',
  [SwarmitStatusType.Stopping]: '#d97706',
  [SwarmitStatusType.Resetting]: '#d97706',
  [SwarmitStatusType.Programming]: '#2563eb',
};

export interface SwarmitPanelProps {
  enabled: boolean;
  list: SwarmitView[];
  onToggle: (on: boolean) => void;
  onStart: (address: string) => void;
  onStop: (address: string) => void;
  onReset: (address: string) => void;
  onFlash: (address: string) => void;
}

export default function SwarmitPanel({
  enabled,
  list,
  onToggle,
  onStart,
  onStop,
  onReset,
  onFlash,
}: SwarmitPanelProps) {
  return (
    <div style={box}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        Camada swarmit (você = backend)
      </label>

      {!enabled && (
        <span style={{ marginLeft: 8, color: '#6b7280' }}>
          — desligada; o simulador só faz o app DotBot.
        </span>
      )}

      {enabled && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map((s) => (
            <div key={s.address} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <code style={{ fontSize: 12 }}>{s.address.slice(-4)}</code>
              <span
                style={{
                  color: '#fff',
                  background: statusColor[s.status],
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontSize: 11,
                }}
              >
                {swarmitStatusName(s.status)}
              </span>
              {s.status === SwarmitStatusType.Programming && (
                <span style={{ color: '#2563eb', fontSize: 11 }}>
                  flash {Math.round(s.flashProgress * 100)}%
                </span>
              )}
              <button style={btn} onClick={() => onFlash(s.address)} title="Simula OTA_START + chunks">
                Flash
              </button>
              <button style={btn} onClick={() => onStart(s.address)}>
                Start
              </button>
              <button style={btn} onClick={() => onStop(s.address)}>
                Stop
              </button>
              <button style={btn} onClick={() => onReset(s.address)} title="RESET(0,0) → Bootloader">
                Reset
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
