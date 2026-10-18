/**
 * React hooks over board state (BOARD-1302).
 *
 * Every hook reads through `useSyncExternalStore`, so values are consistent within a render and
 * safe under concurrent rendering. Selectors are memoized: a component only re-renders when the
 * selected value changes according to `isEqual` (default `Object.is`).
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
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
  // The board may emit `dispose` once more; re-read so the hook sees the final state.
  offs.push(board.on('dispose', onChange));
  return () => {
    for (const off of offs) off();
  };
}

/**
 * Reads `getSnapshot()` from the board, re-reading on `types` events, and returns the memoized
 * `selector` result. `getSnapshot` must return the same value while nothing changed.
 */
function useBoardStore<S, T>(
  board: Board,
  types: readonly (keyof BoardEventMap)[],
  getSnapshot: () => S,
  selector: (snapshot: S) => T,
  isEqual: EqualityFn<T> = Object.is,
): T {
  // Compared by content, so an inline `types` array does not resubscribe on every render.
  const typesKey = types.join('|');
  const subscribe = useCallback(
    (onChange: () => void) =>
      subscribeTo(board, typesKey.split('|') as (keyof BoardEventMap)[], onChange),
    [board, typesKey],
  );

  // Latest selector and equality in refs: changing them does not resubscribe, and an inline
  // selector does not break memoization.
  const selectorRef = useRef(selector);
  const isEqualRef = useRef(isEqual);
  selectorRef.current = selector;
  isEqualRef.current = isEqual;
  const memo = useRef<{ snapshot: S; selector: (s: S) => T; value: T } | null>(null);

  const getSelection = useCallback((): T => {
    const snapshot = getSnapshot();
    const current = memo.current;
    if (current && current.snapshot === snapshot && current.selector === selectorRef.current) {
      return current.value;
    }
    const next = selectorRef.current(snapshot);
    // Keep the previous value when it is equal, so React sees no change and skips the render.
    const value = current && isEqualRef.current(current.value, next) ? current.value : next;
    memo.current = { snapshot, selector: selectorRef.current, value };
    return value;
  }, [getSnapshot]);

  return useSyncExternalStore(subscribe, getSelection, getSelection);
}

const identity = <T>(value: T): T => value;

/**
 * IDs of the selected elements (BOARD-1302). Re-renders only when the selection changes.
 *
 * @example
 * ```tsx
 * const selection = useSelection(board);
 * return <span>{selection.length} dipilih</span>;
 * ```
 * @public
 */
export function useSelection(board: Board): readonly string[];
/**
 * A value derived from the selected IDs. Re-renders only when the derived value changes.
 *
 * @public
 */
export function useSelection<T>(
  board: Board,
  selector: (selection: readonly string[]) => T,
  isEqual?: EqualityFn<T>,
): T;
export function useSelection<T>(
  board: Board,
  selector: (selection: readonly string[]) => T = identity as never,
  isEqual?: EqualityFn<T>,
): T {
  const getSnapshot = useCallback(() => board.selection, [board]);
  return useBoardStore(board, ['selection'], getSnapshot, selector, isEqual);
}

/**
 * Camera state, or a value selected from it (BOARD-1302). With a selector, the component only
 * re-renders when the selected value changes, not on every pan frame.
 *
 * @example
 * ```tsx
 * const zoom = useCamera(board, (c) => c.zoom);
 * ```
 * @public
 */
export function useCamera(board: Board): Readonly<CameraState>;
/** @public */
export function useCamera<T>(
  board: Board,
  selector: (camera: Readonly<CameraState>) => T,
  isEqual?: EqualityFn<T>,
): T;
export function useCamera<T>(
  board: Board,
  selector: (camera: Readonly<CameraState>) => T = identity as never,
  isEqual?: EqualityFn<T>,
): T {
  const getSnapshot = useCallback(() => board.camera.get(), [board]);
  return useBoardStore(board, ['camera'], getSnapshot, selector, isEqual);
}

/**
 * ID of the active tool, or `null` when none is active (BOARD-1302).
 *
 * @public
 */
export function useTool(board: Board): string | null {
  const getSnapshot = useCallback(() => board.tool, [board]);
  return useBoardStore(board, ['tool'], getSnapshot, identity);
}

/**
 * Undo and redo state with bound actions (BOARD-1302).
 *
 * @public
 */
export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * Undo and redo availability, with `undo` and `redo` bound to the board (BOARD-1302). Re-renders
 * only when `canUndo` or `canRedo` changes.
 *
 * @example
 * ```tsx
 * const { canUndo, undo } = useHistory(board);
 * return <button disabled={!canUndo} onClick={undo}>Urungkan</button>;
 * ```
 * @public
 */
export function useHistory(board: Board): HistoryState {
  // Encoded as a primitive so the snapshot is stable without caching an object.
  const getSnapshot = useCallback(
    () => (board.disposed ? 0 : (board.history.canUndo ? 1 : 0) | (board.history.canRedo ? 2 : 0)),
    [board],
  );
  const flags = useBoardStore(board, ['history'], getSnapshot, identity);
  const undo = useCallback(() => board.undo(), [board]);
  const redo = useCallback(() => board.redo(), [board]);
  return {
    canUndo: (flags & 1) !== 0,
    canRedo: (flags & 2) !== 0,
    undo,
    redo,
  };
}

/**
 * Listens to a board event while the component is mounted (BOARD-1302). The latest `listener`
 * is always called, so an inline function does not resubscribe on every render.
 *
 * @example
 * ```tsx
 * useBoardEvent(board, 'action', (e) => {
 *   if (e.name === 'demo.open') openPanel(e.payload);
 * });
 * ```
 * @public
 */
export function useBoardEvent<K extends keyof BoardEventMap>(
  board: Board,
  type: K,
  listener: (event: BoardEventMap[K]) => void,
): void {
  const listenerRef = useRef(listener);
  useEffect(() => {
    listenerRef.current = listener;
  });
  useEffect(() => {
    if (board.disposed) return;
    return board.on(type, (event) => listenerRef.current(event));
  }, [board, type]);
}
