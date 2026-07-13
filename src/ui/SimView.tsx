// Modo SIMULAR (a visualização da Fase 2, agora como componente):
// roda o World em tempo real a partir do cenário recebido — inclusive robôs
// em AUTO já seguindo os waypoints persistidos no JSON.
//
// Fase 7: botão "Configurações de rede" abre o painel de PDR/latência/jitter
// (NetConfigPanel), que edita o world.sim AO VIVO via useWorld.

import { useState } from 'react';
import Inspector from './Inspector';
import MapView from './MapView';
import NetConfigPanel from './NetConfigPanel';
import { Scenario } from '../core/types';
import { useWorld } from './useWorld';

const btnStyle = {
  padding: '4px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
} as const;

export default function SimView({ scenario }: { scenario: Scenario }) {
  const {
    world,
    robots,
    trails,
    time,
    playing,
    play,
    pause,
    reset,
    injectMoveRawTest,
    setRobotOnline,
    netConfig,
    setNetConfig,
  } = useWorld(scenario);
  const [showNetConfig, setShowNetConfig] = useState(false);

  const netDegraded =
    netConfig.enabled &&
    (netConfig.pdr_percent < 100 ||
      netConfig.slot_latency_ms > 0 ||
      netConfig.jitter_ms > 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 16px',
          borderBottom: '1px solid #f3f4f6',
          flexWrap: 'wrap',
        }}
      >
        <button style={btnStyle} onClick={playing ? pause : play}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button style={btnStyle} onClick={reset}>
          Reset
        </button>
        <button
          style={btnStyle}
          onClick={injectMoveRawTest}
          title="Injeta CMD_MOVE_RAW(0,80,0,80) no 1º robô em MANUAL (demonstração)"
        >
          Move-raw teste
        </button>
        <button
          style={{
            ...btnStyle,
            border: `1px solid ${showNetConfig ? '#2563eb' : netDegraded ? '#f59e0b' : '#d1d5db'}`,
            background: showNetConfig ? '#dbeafe' : netDegraded ? '#fffbeb' : '#fff',
          }}
          onClick={() => setShowNetConfig((v) => !v)}
          title="Fase 7 — liga/desliga e ajusta a degradação de rede (PDR, latência, jitter) ao vivo"
        >
          Configurações de rede
          {netDegraded &&
            ` · ${netConfig.pdr_percent}% / ${netConfig.slot_latency_ms} ms` +
              (netConfig.jitter_ms > 0 ? ` +${netConfig.jitter_ms} ms` : '')}
        </button>
        <span style={{ fontSize: 13, color: '#374151', marginLeft: 'auto' }}>
          t = {time.toFixed(1)} s · tick {world.sim.tick_hz} Hz · arena{' '}
          {world.arena.width}×{world.arena.height} mm
        </span>
      </div>

      {showNetConfig && <NetConfigPanel value={netConfig} onChange={setNetConfig} />}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <MapView arena={world.arena} obstacles={world.obstacles} robots={robots} trails={trails} />
        <Inspector robots={robots} onSetOnline={setRobotOnline} />
      </div>
    </div>
  );
}
