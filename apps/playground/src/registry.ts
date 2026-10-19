import type { Scenario } from './scenario.js';
import allElements from './scenarios/all-elements.js';
import lockedRotated from './scenarios/locked-rotated.js';
import textIme from './scenarios/text-ime.js';

export { allElements, lockedRotated, textIme };

const modules = import.meta.glob<{ default: Scenario }>('./scenarios/*.ts', { eager: true });

export const scenarios: Scenario[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export const DEFAULT_SCENARIO = 'empty';

export function findScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}

