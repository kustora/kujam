/**
 * `@kujam/vue` — Thin `Board` component adapter and composables for Vue 3.
 *
 * @packageDocumentation
 */

export { Board } from './board.js';
export {
  useBoardEvent,
  useCamera,
  useHistory,
  useSelection,
  useTool,
  type EqualityFn,
  type HistoryState,
} from './composables.js';
