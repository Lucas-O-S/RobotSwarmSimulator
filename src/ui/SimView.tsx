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
import SwarmitPanel from './SwarmitPanel';
import { Scenario } from '../core/types';
import { serializeScenario } from '../core/scenario';
import { downloadJson } from './fileio';
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
  // Ponte com a API: quando ligada, a frota da tela vira a frota que o backend
  // enxerga (telemetria sobe e comandos descem pelo broker MQTT). Desligada,
  // a simulação roda 100% local, como antes.
  const [connectOn, setConnectOn] = useState(false);
  const [brokerUrl, setBrokerUrl] = useState('ws://localhost:9001');
  const connectUrl = connectOn ? brokerUrl : null;

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
    swarmitEnabled,
    setSwarmitEnabled,
    swarmit,
    swarmitStart,
    swarmitStop,
    swarmitReset,
    swarmitFlash,
    connStatus,
  } = useWorld(scenario, connectUrl);
  const [showNetConfig, setShowNetConfig] = useState(false);
  const [showSwarmit, setShowSwarmit] = useState(false);

  const connColor =
    connStatus === 'connected' ? '#16a34a' :
    connStatus === 'connecting' ? '#f59e0b' :
    connStatus === 'error' ? '#dc2626' : '#9ca3af';
  const connLabel =
    connStatus === 'connected' ? 'conectado' :
    connStatus === 'connecting' ? 'conectando…' :
    connStatus === 'error' ? 'erro (broker no ar?)' : 'offline';

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
          onClick={() => downloadJson('cenario-estado.json', serializeScenario(world))}
          title="Exporta o ESTADO ATUAL da simulação (poses correntes) como cenário .json"
        >
          Exportar estado
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
        <button
          style={{
            ...btnStyle,
            border: `1px solid ${showSwarmit ? '#7c3aed' : swarmitEnabled ? '#7c3aed' : '#d1d5db'}`,
            background: showSwarmit ? '#ede9fe' : swarmitEnabled ? '#f5f3ff' : '#fff',
          }}
          onClick={() => setShowSwarmit((v) => !v)}
          title="Fase 7 — camada swarmit: você faz o papel do backend (flash/start/stop/reset)"
        >
          Swarmit{swarmitEnabled ? ' · on' : ''}
        </button>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginLeft: 'auto',
            paddingLeft: 12,
            borderLeft: '1px solid #e5e7eb',
          }}
        >
          <button
            style={{
              ...btnStyle,
              border: `1px solid ${connectOn ? '#16a34a' : '#d1d5db'}`,
              background: connectOn ? '#dcfce7' : '#fff',
              fontWeight: connectOn ? 600 : 400,
            }}
            onClick={() => setConnectOn((v) => !v)}
            title="Liga a ponte MQTT: a frota desta tela passa a ser a que o backend (API) enxerga"
          >
            {connectOn ? 'Desconectar da API' : 'Conectar à API'}
          </button>
          <input
            value={brokerUrl}
            onChange={(e) => setBrokerUrl(e.target.value)}
            disabled={connectOn}
            title="URL do broker MQTT (WebSocket) — Mosquitto na porta 9001"
            style={{
              width: 170,
              fontSize: 12,
              padding: '4px 6px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
            }}
          />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151' }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: connColor,
                display: 'inline-block',
              }}
            />
            {connLabel}
          </span>
        </span>

        <span style={{ fontSize: 13, color: '#374151', marginLeft: 12 }}>
          t = {time.toFixed(1)} s · tick {world.sim.tick_hz} Hz · arena{' '}
          {world.arena.width}×{world.arena.height} mm
        </span>
      </div>

      {showNetConfig && <NetConfigPanel value={netConfig} onChange={setNetConfig} />}

      {showSwarmit && (
        <SwarmitPanel
          enabled={swarmitEnabled}
          list={swarmit}
          onToggle={setSwarmitEnabled}
          onStart={swarmitStart}
          onStop={swarmitStop}
          onReset={(addr) => swarmitReset(addr, 0, 0)}
          onFlash={swarmitFlash}
        />
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <MapView arena={world.arena} obstacles={world.obstacles} robots={robots} trails={trails} />
        <Inspector robots={robots} onSetOnline={setRobotOnline} />
      </div>
    </div>
  );
}
