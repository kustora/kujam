/**
 * `@kujam/react` — Thin `<Board>` component adapter and hooks for React.
 *
 * @packageDocumentation
 */

export {
  Board,
  type BoardProps,
  type CustomElementComponent,
  type CustomElementComponentProps,
  type ElementDataStatus,
} from './board.js';
export {
  defineReactElement,
  type DefineReactElementOptions,
} from './elements.js';
export {
  useBoardEvent,
  useCamera,
  useHistory,
  useSelection,
  useTool,
  type EqualityFn,
  type HistoryState,
} from './hooks.js';
