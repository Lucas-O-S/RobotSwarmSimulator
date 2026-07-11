// Fase 3 — editor de cenário: alterna entre "Simular" (a visualização da
// Fase 2, agora em SimView) e "Editar" (ScenarioEditor). No modo Editar a
// simulação NÃO roda — edita-se o estado inicial do cenário, que pode ser
// salvo/carregado como arquivo .json (schema da seção 7 do PLANO).

import { useRef, useState } from 'react';
import { Scenario } from './core/types';
import ScenarioEditor from './ui/ScenarioEditor';
import SimView from './ui/SimView';
import { cloneScenario, parseScenarioFile } from './ui/editorModel';
import { downloadJson } from './ui/fileio';
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
  // O "draft" é o estado INICIAL do cenário (formato JSON da seção 7).
  // O editor muda o draft; Simular roda loadScenario(draft) do zero.
  const [scenario, setScenario] = useState<Scenario>(() => cloneScenario(SCENARIOS[0].data));
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isBuiltIn = SCENARIOS.some((s) => s.name === scenarioName);

  const pickBuiltIn = (name: string) => {
    const entry = SCENARIOS.find((s) => s.name === name);
    if (!entry) return;
    setScenarioName(name);
    setScenario(cloneScenario(entry.data));
    setLoadError(null);
  };

  const onSave = () => {
    downloadJson(`${scenarioName || 'cenario'}.json`, scenario);
  };

  const onFileText = (name: string, text: string) => {
    const res = parseScenarioFile(text);
    if (res.ok) {
      setScenario(res.scenario);
      setScenarioName(name.replace(/\.json$/i, ''));
      setLoadError(null);
      setMode('edit'); // carregou → entra no editor
    } else {
      setLoadError(res.error);
    }
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
        <span style={{ fontSize: 12, color: '#6b7280' }}>Fase 3 — editor de cenário</span>

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

        <button style={btnStyle} onClick={onSave} title="Baixa o cenário atual como .json">
          Salvar JSON
        </button>
        <button
          style={btnStyle}
          onClick={() => fileRef.current?.click()}
          title="Carrega um cenário de um arquivo .json"
        >
          Carregar JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.currentTarget.value = ''; // permite recarregar o mesmo arquivo
            if (!file) return;
            file
              .text()
              .then((text) => onFileText(file.name, text))
              .catch(() => setLoadError('Não foi possível ler o arquivo.'));
          }}
        />
      </header>

      {loadError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            background: '#fef2f2',
            color: '#b91c1c',
            fontSize: 13,
            borderBottom: '1px solid #fecaca',
          }}
        >
          <span>Erro ao carregar o cenário: {loadError}</span>
          <button
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'none',
              color: '#b91c1c',
              cursor: 'pointer',
              fontSize: 14,
            }}
            onClick={() => setLoadError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {mode === 'sim' ? (
        <SimView scenario={scenario} />
      ) : (
        <ScenarioEditor scenario={scenario} onChange={setScenario} />
      )}
    </div>
  );
}
