// Fase 2 — mapa 2D READ-ONLY: carrega um cenário JSON, roda o World em tempo
// real (passo fixo de 1/tick_hz) e desenha a vista de topo + telemetria.
// Sem edição, sem MQTT (fases 3+).

import Inspector from './ui/Inspector';
import MapView from './ui/MapView';
import { SCENARIOS } from './ui/scenarios';
import { useWorld } from './ui/useWorld';

const btnStyle = {
  padding: '4px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
} as const;

export default function App() {
  const {
    world,
    robots,
    trails,
    time,
    playing,
    play,
    pause,
    reset,
    scenarioName,
    setScenario,
    injectMoveRawTest,
  } = useWorld(SCENARIOS);

  return (
    <div
      style={{
        fontFamily: 'sans-serif',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          borderBottom: '1px solid #e5e7eb',
          flexWrap: 'wrap',
        }}
      >
        <strong>RobotSwarmSimulator</strong>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Fase 2 — mapa 2D (read-only)</span>

        <label style={{ fontSize: 13 }}>
          Cenário:{' '}
          <select value={scenarioName} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

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
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <MapView arena={world.arena} obstacles={world.obstacles} robots={robots} trails={trails} />
        <Inspector robots={robots} />
      </div>
    </div>
  );
}
