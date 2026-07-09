// Registro de cenários disponíveis na UI (Fase 2 — read-only).
// O JSON é importado no bundle (resolveJsonModule); nas próximas fases o
// editor (Fase 3) vai permitir carregar/salvar arquivos arbitrários.

import exemploJson from '../../scenarios/exemplo.json';
import { Scenario } from '../core/types';
import { ScenarioEntry } from './useWorld';

export const SCENARIOS: ScenarioEntry[] = [
  {
    name: 'exemplo',
    data: exemploJson as Scenario,
    // O exemplo.json declara os dois robôs em MANUAL parados; pra "ver o
    // robô andar" a UI injeta, via API do core, a MESMA rota AUTO do
    // demo headless (src/demo.ts): contornar a barreira pela direita.
    setup: (world) => {
      const r1 = world.robots[0];
      if (r1) {
        r1.setWaypoints(
          [
            { x: 1500, y: 300 },
            { x: 1500, y: 1700 },
          ],
          50,
        );
      }
    },
  },
];
