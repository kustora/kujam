/**
 * Vue composables over board state (BOARD-1303).
 *
 * Each composable returns a read-only `shallowRef` that follows the board through its events, and
 * stops listening in `onScopeDispose` (component unmount, or `effectScope().stop()`). The board can
 * be a plain value, a ref, or a getter; when it changes, the composable resubscribes. Selectors
 * only update the ref when the selected value changes according to `isEqual` (default
 * `Object.is`), so dependent effects and renders do not run for unrelated changes.
 */

import {
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';
import type { Board, BoardEventMap, CameraState } from '@kujam/core';

/**
 * Equality function for selector results.
 *
 * @public
 */
export type EqualityFn<T> = (a: T, b: T) => boolean;

/** Subscribes to board events; a disposed board has nothing to subscribe to. */
function subscribeTo(
  board: Board,
  types: readonly (keyof BoardEventMap)[],
  onChange: () => void,
): () => void {
  if (board.disposed) return () => {};
  const offs = types.map((type) => board.on(type, onChange));
  offs.push(board.on('dispose', onChange));
  return () => {
    for (const off of offs) off();
  };
}

/** Stops `stop` with the active effect scope, when there is one. */
function stopWithScope(stop: () => void): void {
  if (getCurrentScope()) onScopeDispose(stop);
}

/**
 * Shared implementation: a shallow ref holding `selector(read(board))`, refreshed on `types`
 * events and when the board changes.
 */
function useBoardState<S, T>(
  board: MaybeRefOrGetter<Board>,
  types: readonly (keyof BoardEventMap)[],
  read: (board: Board) => S,
  selector: (snapshot: S) => T,
  isEqual: EqualityFn<T> = Object.is,
): Readonly<Ref<T>> {
  const state = shallowRef(selector(read(toValue(board))));

  const stop = watch(
    () => toValue(board),
    (current, _previous, onCleanup) => {
      const refresh = (): void => {
        const next = selector(read(current));
        if (!isEqual(state.value, next)) state.value = next;
      };
      refresh();
      onCleanup(subscribeTo(current, types, refresh));
    },
    { immediate: true },
  );
  stopWithScope(stop);

  return readonly(state) as Readonly<Ref<T>>;
}

const identity = <T>(value: T): T => value;

/**
 * IDs of the selected elements (BOARD-1303).
 *
 * @example
 * ```ts
 * const selection = useSelection(board);
 * const count = useSelection(board, (ids) => ids.length);
 * ```
 * @public
 */
export function useSelection(board: MaybeRefOrGetter<Board>): Readonly<Ref<readonly string[]>>;
/** @public */
export function useSelection<T>(
  board: MaybeRefOrGetter<Board>,
  selector: (selection: readonly string[]) => T,
  isEqual?: EqualityFn<T>,
): Readonly<Ref<T>>;
export function useSelection<T>(
  board: MaybeRefOrGetter<Board>,
  selector: (selection: readonly string[]) => T = identity as never,
  isEqual?: EqualityFn<T>,
): Readonly<Ref<T>> {
  return useBoardState(board, ['selection'], (b) => b.selection, selector, isEqual);
}

/**
 * Camera state, or a value selected from it (BOARD-1303). With a selector, the ref only changes
 * when the selected value changes, not on every pan frame.
 *
 * @example
 * ```ts
 * const zoom = useCamera(board, (c) => c.zoom);
 * ```
 * @public
 */
export function useCamera(board: MaybeRefOrGetter<Board>): Readonly<Ref<Readonly<CameraState>>>;
/** @public */
export function useCamera<T>(
  board: MaybeRefOrGetter<Board>,
  selector: (camera: Readonly<CameraState>) => T,
  isEqual?: EqualityFn<T>,
): Readonly<Ref<T>>;
export function useCamera<T>(
  board: MaybeRefOrGetter<Board>,
  selector: (camera: Readonly<CameraState>) => T = identity as never,
  isEqual?: EqualityFn<T>,
): Readonly<Ref<T>> {
  return useBoardState(board, ['camera'], (b) => b.camera.get(), selector, isEqual);
}

/**
 * ID of the active tool, or `null` when none is active (BOARD-1303).
 *
 * @public
 */
export function useTool(board: MaybeRefOrGetter<Board>): Readonly<Ref<string | null>> {
  return useBoardState(board, ['tool'], (b) => b.tool, identity);
}

/**
 * Undo and redo state with bound actions (BOARD-1303).
 *
 * @public
 */
export interface HistoryState {
  readonly canUndo: Readonly<Ref<boolean>>;
  readonly canRedo: Readonly<Ref<boolean>>;
  undo(): void;
  redo(): void;
}

/**
 * Undo and redo availability, with `undo` and `redo` acting on the current board (BOARD-1303).
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const { canUndo, undo } = useHistory(board);
 * </script>
 * <template><button :disabled="!canUndo" @click="undo">Urungkan</button></template>
 * ```
 * @public
 */
export function useHistory(board: MaybeRefOrGetter<Board>): HistoryState {
  const canUndo = useBoardState(
    board,
    ['history'],
    (b) => !b.disposed && b.history.canUndo,
    identity,
  );
  const canRedo = useBoardState(
    board,
    ['history'],
    (b) => !b.disposed && b.history.canRedo,
    identity,
  );
  return {
    canUndo,
    canRedo,
    undo: () => toValue(board).undo(),
    redo: () => toValue(board).redo(),
  };
}

/**
 * Listens to a board event until the current scope is disposed (BOARD-1303). Follows the board
 * when it is a ref or getter.
 *
 * @example
 * ```ts
 * useBoardEvent(board, 'action', (e) => {
 *   if (e.name === 'demo.open') openPanel(e.payload);
 * });
 * ```
 * @public
 */
export function useBoardEvent<K extends keyof BoardEventMap>(
  board: MaybeRefOrGetter<Board>,
  type: K,
  listener: (event: BoardEventMap[K]) => void,
): void {
  const stop = watch(
    () => toValue(board),
    (current, _previous, onCleanup) => {
      if (current.disposed) return;
      onCleanup(current.on(type, listener));
    },
    { immediate: true },
  );
  stopWithScope(stop);
}
