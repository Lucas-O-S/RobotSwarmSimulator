// Modo SIMULAR (a visualização da Fase 2, agora como componente):
// roda o World em tempo real a partir do cenário recebido — inclusive robôs
// em AUTO já seguindo os waypoints persistidos no JSON.

import Inspector from './Inspector';
import MapView from './MapView';
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
  } = useWorld(scenario);

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
        <span style={{ fontSize: 13, color: '#374151', marginLeft: 'auto' }}>
          t = {time.toFixed(1)} s · tick {world.sim.tick_hz} Hz · arena{' '}
          {world.arena.width}×{world.arena.height} mm
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <MapView arena={world.arena} obstacles={world.obstacles} robots={robots} trails={trails} />
        <Inspector robots={robots} onSetOnline={setRobotOnline} />
      </div>
    </div>
  );
}
