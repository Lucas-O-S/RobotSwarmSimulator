// Casca da aplicação: alterna entre "Simular" (SimView) e "Editar"
// (ScenarioEditor), escolhe cenários embutidos e abre a ferramenta de
// Importar/Exportar. No modo Editar a simulação NÃO roda — edita-se o estado
// inicial do cenário (o "draft"), que Simular carrega do zero.

import { useState } from 'react';
import { Scenario } from './core/types';
import ScenarioEditor from './ui/ScenarioEditor';
import SimView from './ui/SimView';
import ImportExportPanel from './ui/ImportExportPanel';
import { cloneScenario } from './ui/editorModel';
import { SCENARIOS } from './ui/scenarios';

const btnStyle = {
  padding: '4px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
} as const;

const modeBtn = (active: boolean) =>
  ({
    ...btnStyle,
    border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`,
    background: active ? '#dbeafe' : '#fff',
    fontWeight: active ? 600 : 400,
  }) as const;

export default function App() {
  const [mode, setMode] = useState<'sim' | 'edit'>('sim');
  const [scenarioName, setScenarioName] = useState(SCENARIOS[0].name);
  // O "draft" é o estado INICIAL do cenário (formato JSON). O editor muda o
  // draft; Simular roda loadScenario(draft) do zero.
  const [scenario, setScenario] = useState<Scenario>(() => cloneScenario(SCENARIOS[0].data));
  const [showIO, setShowIO] = useState(false);

  const isBuiltIn = SCENARIOS.some((s) => s.name === scenarioName);

  const pickBuiltIn = (name: string) => {
    const entry = SCENARIOS.find((s) => s.name === name);
    if (!entry) return;
    setScenarioName(name);
    setScenario(cloneScenario(entry.data));
  };

  const onImport = (s: Scenario, name?: string) => {
    setScenario(s);
    if (name) setScenarioName(name);
    setMode('edit'); // importou → entra no editor pra conferir/ajustar
  };

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
        <span style={{ fontSize: 12, color: '#6b7280' }}>editor + simulador de enxame</span>

        <span style={{ display: 'inline-flex', gap: 4 }}>
          <button style={modeBtn(mode === 'edit')} onClick={() => setMode('edit')}>
            Editar
          </button>
          <button style={modeBtn(mode === 'sim')} onClick={() => setMode('sim')}>
            Simular
          </button>
        </span>

        <label style={{ fontSize: 13 }}>
          Cenário:{' '}
          <select value={scenarioName} onChange={(e) => pickBuiltIn(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
            {!isBuiltIn && <option value={scenarioName}>{scenarioName}</option>}
          </select>
        </label>

        <button
          style={modeBtn(showIO)}
          onClick={() => setShowIO((v) => !v)}
          title="Salvar/replicar a configuração completa: mapa, robôs, rota, rede e simulação"
        >
          Importar / Exportar
        </button>
      </header>

      {showIO && <ImportExportPanel scenario={scenario} name={scenarioName} onImport={onImport} />}

      {mode === 'sim' ? (
        <SimView scenario={scenario} />
      ) : (
        <ScenarioEditor scenario={scenario} onChange={setScenario} />
      )}
    </div>
  );
}
