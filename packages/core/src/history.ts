/**
 * Diff-based local undo/redo history (BOARD-301).
 *
 * Each step is one transaction's {@link RecordsDiff}. Undo applies the inverse of the top
 * step's diff as a transaction with origin `undo`; the diff produced by that transaction becomes the
 * redo step, and redo applies its inverse again (origin `redo`). This keeps undo and redo
 * symmetric, and steps that can only be partially applied stay consistent.
 *
 * Conflict strategy in 0.1 (changes by another party, for example `remote`, between a local step and
 * its undo): the inverse diff is applied per record, and records changed by another party (created, updated,
 * or deleted) after the step was recorded are skipped, so the other party's changes always
 * win and records deleted by the other party are not resurrected. When no record at all
 * can be reversed, the step is dropped and undo continues with the next step. Because
 * local steps are reversed in order from newest (LIFO), local steps never conflict with
 * each other. True per-user undo comes in 0.2 via Yjs's `UndoManager` (BOARD-1507).
 *
 * Conflict tracking uses sequence numbers: each step stores its number when recorded, and every
 * change by another party tags the record IDs it touches with a new number. The cost is proportional to
 * the number of changed records, not the number of steps in the history.
 */

import type { ChangeEvent, RecordsDiff, RecordStore, Transaction } from './store.js';

/**
 * Default maximum number of stored undo steps.
 *
 * @public
 */
export const DEFAULT_HISTORY_LIMIT = 200;

/**
 * Undo history options for `createBoard({ history })`.
 *
 * @public
 */
export interface HistoryOptions {
  /**
   * Maximum number of undo steps; the oldest step is dropped when the limit is exceeded. An integer
   * `>= 0` or `Infinity`. `0` disables history. Defaults to {@link DEFAULT_HISTORY_LIMIT}.
   */
  limit?: number;
}

/**
 * Board undo history state (`board.history`).
 *
 * @public
 */
export interface BoardHistory {
  /** There is a step that can be undone. */
  readonly canUndo: boolean;
  /** There is a step that can be redone. */
  readonly canRedo: boolean;
  /** Step limit in use (see {@link HistoryOptions.limit}). */
  readonly limit: number;
  /** Clears the undo and redo stacks. The document is unchanged. */
  clear(): void;
}

/**
 * Payload of the `history` event: emitted only when `canUndo` or `canRedo` changes value.
 *
 * @public
 */
export interface HistoryEvent {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/** @internal */
export interface LocalHistory {
  readonly api: BoardHistory;
  undo(): boolean;
  redo(): boolean;
  /** Called for every board `change` event, before consumer listeners. */
  observe(event: ChangeEvent): void;
  /** Calls `onStateChange` when `canUndo`/`canRedo` changed since the last report. */
  flush(): void;
  /**
   * Reserves a sequence number for a step that will be recorded later (tool interactions, BOARD-501).
   * Changes by another party after this number count as conflicts when the step is undone.
   */
  reserveSeq(): number;
  /**
   * Records the combined diff as a single local step with the reserved sequence number,
   * then clears the redo stack (like a regular local transaction).
   */
  record(diff: ChangeEvent, seq: number): void;
  dispose(): void;
}

/** @internal */
export interface LocalHistoryOptions {
  limit: number;
  onStateChange: (event: HistoryEvent) => void;
}

/** A single history step: the transaction diff and its sequence number when recorded. */
interface Entry {
  readonly diff: ChangeEvent;
  readonly seq: number;
}

interface Capture {
  readonly origin: 'undo' | 'redo';
  readonly target: Entry[];
  applied: boolean;
}

/**
 * Validates `history.limit`.
 *
 * @internal
 */
export function resolveHistoryLimit(options: HistoryOptions | undefined): number {
  const limit = options?.limit;
  if (limit === undefined) return DEFAULT_HISTORY_LIMIT;
  if (limit === Number.POSITIVE_INFINITY || (Number.isInteger(limit) && limit >= 0)) return limit;
  throw new RangeError('history.limit wajib bilangan bulat >= 0 atau Infinity.');
}

/** Applies the inverse of `diff` to records that pass `keep`. */
function applyInverse(tx: Transaction, diff: RecordsDiff, keep: (id: string) => boolean): void {
  for (const id of Object.keys(diff.added)) {
    if (keep(id)) tx.remove(id);
  }
  for (const [id, rec] of Object.entries(diff.removed)) {
    if (keep(id)) tx.put(rec);
  }
  for (const [id, { before }] of Object.entries(diff.updated)) {
    if (keep(id)) tx.put(before);
  }
}

function touchedIds(diff: RecordsDiff): string[] {
  return [...Object.keys(diff.added), ...Object.keys(diff.updated), ...Object.keys(diff.removed)];
}

/**
 * Creates a local undo history connected to the store.
 *
 * @internal
 */
export function createLocalHistory(store: RecordStore, options: LocalHistoryOptions): LocalHistory {
  const { limit, onStateChange } = options;
  const undoStack: Entry[] = [];
  const redoStack: Entry[] = [];
  /** Record ID -> sequence number of the last change by another party that touched it. */
  const foreign = new Map<string, number>();
  let seq = 0;
  let capture: Capture | null = null;
  let reported: HistoryEvent = { canUndo: false, canRedo: false };
  let disposed = false;

  function push(stack: Entry[], diff: ChangeEvent, entrySeq = ++seq): void {
    stack.push({ diff, seq: entrySeq });
    while (stack.length > limit) stack.shift();
  }

  function clear(): void {
    undoStack.length = 0;
    redoStack.length = 0;
    foreign.clear();
  }

  function flush(): void {
    const canUndo = undoStack.length > 0;
    const canRedo = redoStack.length > 0;
    if (canUndo === reported.canUndo && canRedo === reported.canRedo) return;
    reported = Object.freeze({ canUndo, canRedo });
    onStateChange(reported);
  }

  function step(from: Entry[], to: Entry[], origin: 'undo' | 'redo'): boolean {
    if (disposed) throw new Error('Papan sudah di-dispose.');
    if (store.inTransaction()) {
      throw new Error(`${origin} tidak boleh dipanggil di dalam transaksi.`);
    }
    let applied = false;
    while (!applied && from.length > 0) {
      const entry = from.pop() as Entry;
      const token: Capture = { origin, target: to, applied: false };
      // Records touched by another party after this step was recorded are not reversed.
      const keep = (id: string): boolean => (foreign.get(id) ?? 0) < entry.seq;
      capture = token;
      try {
        store.transact((tx) => applyInverse(tx, entry.diff, keep), {
          origin,
          label: entry.diff.label,
        });
      } finally {
        if (capture === token) capture = null;
      }
      // When every record has been changed by another party, this step is dropped (not added to `to`).
      applied = token.applied;
    }
    if (undoStack.length === 0 && redoStack.length === 0) foreign.clear();
    flush();
    return applied;
  }

  const api: BoardHistory = {
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    limit,
    clear() {
      clear();
      flush();
    },
  };

  return {
    api,
    undo: () => step(undoStack, redoStack, 'undo'),
    redo: () => step(redoStack, undoStack, 'redo'),
    observe(event) {
      // Only this history's own undo/redo transactions are captured; other transactions that
      // use the `undo`/`redo` origin manually are treated like non-local changes.
      if (capture && event.origin === capture.origin) {
        capture.applied = true;
        push(capture.target, event);
        capture = null;
        return;
      }
      if (event.origin === 'local') {
        push(undoStack, event);
        redoStack.length = 0;
      } else if (event.origin === 'load' || event.origin === 'migration') {
        // Old diffs no longer apply to a replaced or migrated document.
        clear();
      } else if (undoStack.length > 0 || redoStack.length > 0) {
        // Changes by another party (remote, or manual undo/redo): tag the records they touched.
        const mark = ++seq;
        for (const id of touchedIds(event)) foreign.set(id, mark);
      }
    },
    flush,
    reserveSeq: () => ++seq,
    record(diff, entrySeq) {
      if (disposed) return;
      push(undoStack, diff, entrySeq);
      redoStack.length = 0;
      flush();
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
