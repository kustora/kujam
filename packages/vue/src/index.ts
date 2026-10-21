/**
 * `@kujam/vue` — Thin `Board` component adapter and composables for Vue 3.
 *
 * @packageDocumentation
 */

export {
  Board,
  defineVueElement,
  type CustomVueComponent,
  type CustomVueElementProps,
  type DefineVueElementOptions,
  type ElementDataStatus,
} from './board.js';
export {
  useBoardEvent,
  useCamera,
  useHistory,
  useResolved,
  useSelection,
  useTool,
  type EqualityFn,
  type HistoryState,
} from './composables.js';
