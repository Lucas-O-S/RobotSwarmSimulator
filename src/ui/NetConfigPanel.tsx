// Fase 7 — Peça 1: menu de "Configurações de rede" do modo Simular.
//
// Painel mínimo e funcional (fidelidade visual não é meta) pra ligar/
// desligar a degradação de rede e ajustar PDR (%), latência (ms) e jitter
// (ms) AO VIVO. Os valores editam o world.sim corrente (via setNetConfig do
// useWorld), que o SimGateway/netmodel lê por mensagem — o efeito é
// imediato em qualquer gateway pendurado no World. Valores iniciais vêm do
// `sim` do cenário; Reset volta pra eles.

import type { CSSProperties } from 'react';
import { NetConfigValues } from './useWorld';

export interface NetConfigPanelProps {
  value: NetConfigValues;
  onChange: (patch: Partial<NetConfigValues>) => void;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};

const numStyle: CSSProperties = {
  width: 64,
  padding: '2px 4px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 13,
};

function SliderRow({
  label,
  unit,
  min,
  max,
  step,
  value,
  disabled,
  title,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled: boolean;
  title: string;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ ...rowStyle, opacity: disabled ? 0.5 : 1 }} title={title}>
      <span style={{ width: 92 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ flex: 1, minWidth: 100 }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={numStyle}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      <span style={{ width: 24, color: '#6b7280' }}>{unit}</span>
    </label>
  );
}

export default function NetConfigPanel({ value, onChange }: NetConfigPanelProps) {
  const degraded =
    value.enabled &&
    (value.pdr_percent < 100 || value.slot_latency_ms > 0 || value.jitter_ms > 0);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 16px',
        borderBottom: '1px solid #f3f4f6',
        background: '#f9fafb',
        maxWidth: 560,
      }}
    >
      <div style={{ ...rowStyle, fontWeight: 600 }}>
        <span>Configurações de rede (PDR + latência)</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 600,
            color: degraded ? '#b45309' : '#047857',
          }}
        >
          {degraded ? 'DEGRADAÇÃO ATIVA' : 'REDE PERFEITA'}
        </span>
      </div>
      <label style={rowStyle} title="Kill-switch: desligado = sem perda nem atraso (ignora PDR/latência)">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        <span>degradação de rede ligada</span>
      </label>
      <SliderRow
        label="PDR"
        unit="%"
        min={0}
        max={100}
        step={1}
        value={value.pdr_percent}
        disabled={!value.enabled}
        title="Packet delivery ratio: cada mensagem (uplink e downlink) é descartada com probabilidade 1 − PDR/100"
        onChange={(v) => onChange({ pdr_percent: v })}
      />
      <SliderRow
        label="latência"
        unit="ms"
        min={0}
        max={1000}
        step={1}
        value={value.slot_latency_ms}
        disabled={!value.enabled}
        title="Atraso base de entrega por mensagem (latência de slot TSCH lógica; no Mari real ~63–150 ms)"
        onChange={(v) => onChange({ slot_latency_ms: v })}
      />
      <SliderRow
        label="jitter"
        unit="ms"
        min={0}
        max={500}
        step={1}
        value={value.jitter_ms}
        disabled={!value.enabled}
        title="Jitter uniforme em [0, jitter] somado à latência de cada mensagem entregue"
        onChange={(v) => onChange({ jitter_ms: v })}
      />
      <span style={{ fontSize: 11, color: '#6b7280' }}>
        Valores iniciais vêm do <code>sim</code> do cenário; Reset volta pra eles. As
        mudanças valem na hora pro gateway simulado (uplink e downlink).
      </span>
    </div>
  );
}
