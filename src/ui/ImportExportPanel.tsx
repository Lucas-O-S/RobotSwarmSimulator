// Ferramenta de Importar / Exportar cenário.
//
// Um cenário guarda a configuração COMPLETA e replicável: tamanho do mapa
// (arena), grid, obstáculos, rede (network_id/gateway), parâmetros da
// simulação (tick, advertise, bateria, PDR/latência/jitter) e todos os robôs
// (endereço, aplicação, modo, pose inicial, bateria, waypoints, loop e cor do
// LED). Exportar gera um .json; importar aceita arquivo OU texto colado.
//
// A validação é a mesma do núcleo (parseScenarioFile → loadScenario), então um
// arquivo importado é sempre um cenário válido e normalizado.

import { useRef, useState } from 'react';
import { Scenario } from '../core/types';
import { downloadJson } from './fileio';
import { parseScenarioFile } from './editorModel';

const btn = {
  padding: '4px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
} as const;

export interface ImportExportPanelProps {
  scenario: Scenario;
  name: string;
  /** Chamado com um cenário válido importado (arquivo ou colado). */
  onImport: (scenario: Scenario, name?: string) => void;
}

export default function ImportExportPanel({ scenario, name, onImport }: ImportExportPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const json = JSON.stringify(scenario, null, 2);
  const nRobots = scenario.robots.length;
  const nObst = scenario.obstacles.length;
  const arena = scenario.arena;

  const apply = (text: string, fileName?: string) => {
    const res = parseScenarioFile(text);
    if (res.ok) {
      onImport(res.scenario, fileName?.replace(/\.json$/i, ''));
      setMsg({ kind: 'ok', text: 'Cenário importado.' });
    } else {
      setMsg({ kind: 'err', text: res.error });
    }
  };

  const exportFile = () => {
    downloadJson(`${name || 'cenario'}.json`, scenario);
    setMsg({ kind: 'ok', text: `Exportado ${name || 'cenario'}.json` });
  };

  const copy = () => {
    navigator.clipboard
      ?.writeText(json)
      .then(() => setMsg({ kind: 'ok', text: 'JSON copiado para a área de transferência.' }))
      .catch(() => setMsg({ kind: 'err', text: 'Não foi possível copiar.' }));
  };

  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* Exportar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
          <strong>Exportar</strong>
          <span style={{ color: '#6b7280', fontSize: 12 }}>
            Mapa {arena.width_mm}×{arena.height_mm} mm · {nRobots} robô(s) · {nObst} barreira(s)
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btn} onClick={exportFile}>
              Baixar .json
            </button>
            <button style={btn} onClick={copy}>
              Copiar JSON
            </button>
          </div>
        </div>

        {/* Importar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 260 }}>
          <strong>Importar</strong>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btn} onClick={() => fileRef.current?.click()}>
              Carregar arquivo…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = '';
                if (!file) return;
                file
                  .text()
                  .then((text) => apply(text, file.name))
                  .catch(() => setMsg({ kind: 'err', text: 'Não foi possível ler o arquivo.' }));
              }}
            />
          </div>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="…ou cole o JSON de um cenário aqui"
            rows={3}
            style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          />
          <button style={btn} disabled={!paste.trim()} onClick={() => apply(paste)}>
            Aplicar JSON colado
          </button>
        </div>
      </div>

      {msg && (
        <div style={{ marginTop: 8, color: msg.kind === 'ok' ? '#047857' : '#b91c1c' }}>{msg.text}</div>
      )}
    </div>
  );
}
