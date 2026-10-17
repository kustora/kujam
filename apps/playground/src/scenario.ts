/**
 * Playground scenario contract (BOARD-2401). One scenario = one file in `src/scenarios/`,
 * registered automatically via `import.meta.glob`.
 */
export interface ScenarioState {
  get(key: string): string | null;
  /** Stores scenario state in the query string (without a new history entry). `null` removes the key. */
  set(key: string, value: string | null): void;
}

export interface ScenarioContext {
  /** Center area: the board or the lab content. */
  main: HTMLElement;
  /** Left panel: scenario-specific controls. */
  controls: HTMLElement;
  /** Right panel: debug information (can be hidden by the user). */
  debug: HTMLElement;
  state: ScenarioState;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  /** Order in the scenario picker. */
  order: number;
  /** `board`: center area with a board grid background. `lab`: free center area for test tools. */
  layout: 'board' | 'lab';
  /** Mounts the scenario; returns a cleanup function called when switching scenarios. */
  mount(ctx: ScenarioContext): void | (() => void);
}

export function defineScenario(scenario: Scenario): Scenario {
  return scenario;
}
