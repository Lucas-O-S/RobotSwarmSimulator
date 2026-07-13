// Registro de cenários embutidos no bundle (via resolveJsonModule).
// Desde a Fase 3 o cenário JSON persiste `mode`/`waypoints` por robô, então
// não existe mais o `setup` que injetava rota na carga (gambiarra da Fase 2):
// o exemplo.json já declara o 1º robô em AUTO com a rota completa.

import exemploJson from '../../scenarios/exemplo.json';
import enxameJson from '../../scenarios/enxame.json';
import { Scenario } from '../core/types';

export interface ScenarioEntry {
  name: string;
  data: Scenario;
}

export const SCENARIOS: ScenarioEntry[] = [
  { name: 'exemplo', data: exemploJson as Scenario },
  // Fase 6 — enxame: 6 robôs (AUTO em loop, AUTO sem loop e MANUAL) + 3
  // barreiras, pra exercitar o comportamento de frota em N robôs.
  { name: 'enxame', data: enxameJson as Scenario },
];
