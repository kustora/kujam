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
 *
 * Coalescing (BOARD-302): tool interactions already commit as one step (BOARD-501). Other continuous
 * edits merge through a merge key: a local transaction with the same `mergeKey` as the latest step
 * is folded into that step while the pauses between them stay within `mergeWindowMs`, and
 * `history.batch(key, fn)` folds every local transaction of `fn` into one step. Merging stops at
 * any undo, redo, change by another party, tool interaction, or `clear`, so a merged step never
 * spans a conflict mark and keeps the sequence number of its first transaction.
 */

import { deepEqual } from '../utils/clone.js';
import type { ChangeEvent, RecordsDiff, RecordStore, RecordUpdate, Transaction } from '../document/store.js';
import type { BoardRecord } from '../types.js';

/**
 * Default maximum number of stored undo steps.
 *
 * @public
 */
export const DEFAULT_HISTORY_LIMIT = 200;

/**
 * Default maximum pause, in milliseconds, between transactions with the same merge key that
 * still merge into one undo step (BOARD-302).
 *
 * @public
 */
export const DEFAULT_MERGE_WINDOW_MS = 1000;

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
  /**
   * Maximum pause in milliseconds between transactions with the same merge key that still merge
   * into one undo step (BOARD-302). A number `>= 0` or `Infinity`. Defaults to
   * {@link DEFAULT_MERGE_WINDOW_MS}.
   */
  mergeWindowMs?: number;
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
  /** Merge window in use (see {@link HistoryOptions.mergeWindowMs}). */
  readonly mergeWindowMs: number;
  /** Clears the undo and redo stacks. The document is unchanged. */
  clear(): void;
  /**
   * Runs `fn` and folds every local transaction it makes into one undo step with merge key `key`
   * (BOARD-302), regardless of their own merge keys and of the merge window. The first transaction
   * may also merge into the latest step when that step has the same key and is within the window.
   * Nested batches join the outermost one.
   *
   * `fn` must be synchronous. Transactions committed before `fn` throws stay applied and recorded;
   * use `board.transact` when the changes must be atomic.
   *
   * @throws `TypeError` when `key` is not a string or `fn` is not a function or returns a `Promise`,
   *   or `Error` when called inside a transaction or after `dispose`.
   * @beta
   */
  batch<T>(key: string, fn: () => T): T;
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
  mergeWindowMs?: number;
  onStateChange: (event: HistoryEvent) => void;
  /** Clock for the merge window. Defaults to `Date.now`. */
  now?: () => number;
}

/** A single history step: the transaction diff and its sequence number when recorded. */
interface Entry {
  diff: ChangeEvent;
  readonly seq: number;
}

/** The latest step, while later transactions may still merge into it. */
interface Mergeable {
  readonly entry: Entry;
  readonly key: string;
  /** Batch the step was last extended in, or `0` outside a batch. */
  batch: number;
  /** Time of the step's last transaction. */
  at: number;
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

/**
 * Validates `history.mergeWindowMs`.
 *
 * @internal
 */
export function resolveMergeWindow(options: HistoryOptions | undefined): number {
  const windowMs = options?.mergeWindowMs;
  if (windowMs === undefined) return DEFAULT_MERGE_WINDOW_MS;
  if (typeof windowMs === 'number' && windowMs >= 0 && !Number.isNaN(windowMs)) return windowMs;
  throw new RangeError('history.mergeWindowMs wajib angka >= 0 atau Infinity.');
}

/**
 * Composes two consecutive diffs into the net diff from the state before `first` to the state
 * after `next`. Returns `null` when the changes cancel out.
 *
 * @internal
 */
export function composeDiffs(first: ChangeEvent, next: ChangeEvent): ChangeEvent | null {
  const spans = new Map<
    string,
    { before: BoardRecord | undefined; after: BoardRecord | undefined }
  >();
  function track(
    id: string,
    before: BoardRecord | undefined,
    after: BoardRecord | undefined,
  ): void {
    const span = spans.get(id);
    if (span) span.after = after;
    else spans.set(id, { before, after });
  }
  for (const diff of [first, next]) {
    for (const [id, rec] of Object.entries(diff.added)) track(id, undefined, rec);
    for (const [id, { before, after }] of Object.entries(diff.updated)) track(id, before, after);
    for (const [id, rec] of Object.entries(diff.removed)) track(id, rec, undefined);
  }
  const added: Record<string, BoardRecord> = {};
  const updated: Record<string, RecordUpdate> = {};
  const removed: Record<string, BoardRecord> = {};
  let empty = true;
  for (const [id, { before, after }] of spans) {
    // `Object.defineProperty` keeps IDs such as `__proto__` as own keys.
    const set = (target: object, value: unknown): void => {
      Object.defineProperty(target, id, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      empty = false;
    };
    if (before === undefined && after !== undefined) set(added, after);
    else if (before !== undefined && after === undefined) set(removed, before);
    else if (before !== undefined && after !== undefined && !deepEqual(before, after)) {
      set(updated, Object.freeze({ before, after }));
    }
  }
  if (empty) return null;
  return Object.freeze({
    added: Object.freeze(added),
    updated: Object.freeze(updated),
    removed: Object.freeze(removed),
    origin: first.origin,
    label: first.label ?? next.label,
    ...(next.mergeKey !== undefined ? { mergeKey: next.mergeKey } : {}),
  });
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
  const mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
  const now = options.now ?? Date.now;
  const undoStack: Entry[] = [];
  const redoStack: Entry[] = [];
  /** Record ID -> sequence number of the last change by another party that touched it. */
  const foreign = new Map<string, number>();
  let seq = 0;
  let capture: Capture | null = null;
  let reported: HistoryEvent = { canUndo: false, canRedo: false };
  let disposed = false;
  let mergeable: Mergeable | null = null;
  /** Key and ID of the running outermost batch. */
  let batch: { readonly key: string; readonly id: number } | null = null;
  let batchCount = 0;

  function push(stack: Entry[], diff: ChangeEvent, entrySeq = ++seq): Entry {
    const entry: Entry = { diff, seq: entrySeq };
    stack.push(entry);
    while (stack.length > limit) stack.shift();
    return entry;
  }

  function clear(): void {
    undoStack.length = 0;
    redoStack.length = 0;
    foreign.clear();
    mergeable = null;
  }

  /** Records a local transaction, merging it into the latest step when allowed (BOARD-302). */
  function recordLocal(event: ChangeEvent): void {
    redoStack.length = 0;
    const key = batch?.key ?? event.mergeKey;
    const time = now();
    const batchId = batch?.id ?? 0;
    const target = mergeable;
    if (
      key !== undefined &&
      target !== null &&
      target.key === key &&
      undoStack[undoStack.length - 1] === target.entry &&
      ((batchId !== 0 && target.batch === batchId) || time - target.at <= mergeWindowMs)
    ) {
      const merged = composeDiffs(target.entry.diff, event);
      if (merged === null) {
        // The changes cancelled out: the step disappears entirely.
        undoStack.pop();
        mergeable = null;
        return;
      }
      target.entry.diff = merged;
      target.batch = batchId;
      target.at = time;
      return;
    }
    const entry = push(undoStack, event);
    mergeable =
      key !== undefined && undoStack[undoStack.length - 1] === entry
        ? { entry, key, batch: batchId, at: time }
        : null;
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
    mergeWindowMs,
    clear() {
      clear();
      flush();
    },
    batch<T>(key: string, fn: () => T): T {
      if (disposed) throw new Error('Papan sudah di-dispose.');
      if (typeof key !== 'string') throw new TypeError('Kunci history.batch wajib berupa string.');
      if (typeof fn !== 'function') throw new TypeError('history.batch wajib menerima fungsi.');
      if (store.inTransaction()) {
        throw new Error('history.batch tidak boleh dipanggil di dalam transaksi.');
      }
      if (batch !== null) return fn();
      batch = { key, id: ++batchCount };
      try {
        const result = fn();
        if (
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          typeof (result as { then?: unknown }).then === 'function'
        ) {
          throw new TypeError('fn history.batch wajib sinkron; jangan mengembalikan Promise.');
        }
        return result;
      } finally {
        batch = null;
      }
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
        mergeable = null;
        return;
      }
      if (event.origin === 'local') {
        recordLocal(event);
        return;
      }
      mergeable = null;
      if (event.origin === 'load' || event.origin === 'migration') {
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
      mergeable = null;
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
