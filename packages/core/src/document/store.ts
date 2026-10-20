/**
 * Transactional record store (BOARD-204).
 *
 * - 204a: record map with structural sharing. A commit replaces only the changed records;
 *   other records keep the same object (identity preserved), so the document is never
 *   deep-cloned wholesale per transaction. The document snapshot object is created lazily when `getDocument`
 *   is called and cached until the next commit.
 * - 204b: changes are collected per ID during a transaction, then compared with the initial state
 *   on commit. The result is a net diff: a record created and then deleted does not appear, and repeated
 *   updates become one `updated` entry with the original `before` and the final `after`.
 * - 204c: changes are only written to state on commit, so rollback just discards the
 *   pending changes. Nested transactions use savepoints.
 */

import { deepClone, deepEqual, deepFreeze, setOwn } from '../utils/clone.js';
import type { BindingRecord, BoardDocument, BoardRecord } from '../types.js';
import { InvalidDocumentError, validateRecordShape } from './validate.js';

/**
 * Change origin carried by every transaction and `change` event.
 *
 * - `local`: user actions on this board (the only origin recorded in undo history).
 * - `remote`: changes from another peer or the server (sync).
 * - `undo` / `redo`: applied by the undo history.
 * - `load`: the document was replaced via `loadDocument`.
 * - `migration`: changes made by a schema migration.
 *
 * @public
 */
export type ChangeOrigin = 'local' | 'remote' | 'undo' | 'redo' | 'load' | 'migration';

/**
 * All valid {@link ChangeOrigin} values.
 *
 * @public
 */
export const CHANGE_ORIGINS: readonly ChangeOrigin[] = Object.freeze([
  'local',
  'remote',
  'undo',
  'redo',
  'load',
  'migration',
]);

/**
 * Change to a single record: its value before and after the transaction.
 *
 * @public
 */
export interface RecordUpdate<R extends BoardRecord = BoardRecord> {
  readonly before: Readonly<R>;
  readonly after: Readonly<R>;
}

/**
 * Net diff per record, keyed by record ID. An ID appears in at most one
 * of `added`, `updated`, or `removed`. `removed` carries the full record before deletion,
 * so the diff can be inverted (used by undo).
 *
 * @public
 */
export interface RecordsDiff {
  readonly added: Readonly<Record<string, Readonly<BoardRecord>>>;
  readonly updated: Readonly<Record<string, RecordUpdate>>;
  readonly removed: Readonly<Record<string, Readonly<BoardRecord>>>;
}

/**
 * Payload of the `change` event: a transaction's diff with its origin and label.
 *
 * @public
 */
export interface ChangeEvent extends RecordsDiff {
  readonly origin: ChangeOrigin;
  /** Transaction label for undo and logs; `undefined` when not provided. */
  readonly label: string | undefined;
  /**
   * Undo merge key from {@link TransactOptions.mergeKey} (BOARD-302). Present only when the
   * transaction was given one.
   */
  readonly mergeKey?: string;
  /**
   * Callbacks registered via `tx.onUndo` to run when this transaction is undone (BOARD-303).
   */
  readonly onUndoHooks?: readonly UndoHook[];
  /**
   * Callbacks registered via `tx.onRedo` to run when this transaction is redone (BOARD-303).
   */
  readonly onRedoHooks?: readonly UndoHook[];
}

/**
 * Context passed to {@link UndoHook} callbacks (BOARD-303).
 *
 * @public
 */
export interface UndoContext {
  /** Label of the transaction being reversed. */
  readonly label?: string;
}

/**
 * Hook invoked when a transaction step is reversed by undo or redone by redo (BOARD-303).
 *
 * @public
 */
export type UndoHook = (context: UndoContext) => void | Promise<void>;

/**
 * Options for `board.transact`.
 *
 * @public
 */
export interface TransactOptions {
  /** Label for undo history and the activity log. */
  label?: string;
  /** Change origin. Defaults to `'local'`. */
  origin?: ChangeOrigin;
  /**
   * Undo merge key (BOARD-302). A local transaction merges into the previous undo step when that
   * step has the same key, is still the latest step, and was last extended at most
   * `history.mergeWindowMs` ago (a pause longer than the window starts a new step). Any undo, redo,
   * remote change, or tool interaction in between also starts a new step. Use one key per continuous
   * gesture, for example `'text:' + elementId` while typing; change the key to split steps, for
   * example per word.
   */
  mergeKey?: string;
}

/**
 * Low-level write handle valid only while the `fn` passed to `board.transact` runs.
 * Reads see changes already written in the same transaction.
 *
 * `put` and `remove` only check record structure (required fields), with no props schema, automatic
 * indexing, or `locked` rules. The `create`/`update`/`delete` API (BOARD-205) is built on top of it.
 *
 * @beta
 */
export interface Transaction {
  /** Origin of the outermost transaction. */
  readonly origin: ChangeOrigin;
  /** Label of the outermost transaction. */
  readonly label: string | undefined;
  /** Reads a record, including uncommitted changes. */
  get(id: string): Readonly<BoardRecord> | undefined;
  /** Checks whether a record exists, including uncommitted changes. */
  has(id: string): boolean;
  /**
   * Adds a record, or fully replaces the record with the same ID. The record is copied, so the input object
   * may be changed afterwards without affecting the board.
   *
   * @throws {@link InvalidDocumentError} when the record structure is invalid.
   */
  put(record: BoardRecord): void;
  /** Removes a record. Returns `false` when the record does not exist. */
  remove(id: string): boolean;
  /**
   * Registers a callback invoked after this transaction's changes are reversed by undo (BOARD-303).
   *
   * @param hook - Callback receiving the transaction context.
   */
  onUndo(hook: UndoHook): void;
  /**
   * Registers a callback invoked after this transaction's changes are reapplied by redo (BOARD-303).
   *
   * @param hook - Callback receiving the transaction context.
   */
  onRedo(hook: UndoHook): void;
}

/**
 * Error thrown when a transaction with origin `local` runs on a `readOnly` board.
 *
 * @public
 */
export class ReadOnlyBoardError extends Error {
  constructor() {
    super('Papan dalam mode baca saja: transaksi lokal ditolak.');
    this.name = 'ReadOnlyBoardError';
  }
}

/** @internal */
export interface StoreOptions {
  freeze: boolean;
  /** Read on every transaction, since a board can become read-only after loading (BOARD-703). */
  isReadOnly: () => boolean;
  onChange: (event: ChangeEvent) => void;
  /** Optional hook run inside a transaction right before commit to synchronize reactive records (e.g. bindings). */
  beforeCommit?: (
    tx: Transaction,
    pending: ReadonlyMap<string, BoardRecord | undefined>,
    records: ReadonlyMap<string, BoardRecord>,
    bindings: ReadonlyMap<string, BindingRecord>,
  ) => void;
}

/** @internal */
export interface RecordStore {
  getDocument(): BoardDocument;
  getRecord(id: string): BoardRecord | undefined;
  transact<T>(fn: (tx: Transaction) => T, options?: TransactOptions): T;
  /** Whether a transaction is running (`fn` has not finished). */
  inTransaction(): boolean;
  /** Replaces the whole (already validated) document as a single transaction. */
  replaceDocument(doc: BoardDocument, origin: ChangeOrigin): void;
  dispose(): void;
}

type Pending = Map<string, BoardRecord | undefined>;

interface ActiveTransaction {
  readonly origin: ChangeOrigin;
  readonly label: string | undefined;
  readonly mergeKey: string | undefined;
  pending: Pending;
  closed: boolean;
  readonly undoHooks: UndoHook[];
  readonly redoHooks: UndoHook[];
  readonly tx: Transaction;
}

function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function resolveOrigin(origin: unknown): ChangeOrigin {
  if (origin === undefined) return 'local';
  if ((CHANGE_ORIGINS as readonly unknown[]).includes(origin)) return origin as ChangeOrigin;
  throw new RangeError(`origin "${String(origin)}" tidak dikenal (${CHANGE_ORIGINS.join(', ')}).`);
}

function resolveLabel(label: unknown): string | undefined {
  if (label === undefined || typeof label === 'string') return label;
  throw new TypeError('label transaksi wajib berupa string.');
}

function resolveMergeKey(mergeKey: unknown): string | undefined {
  if (mergeKey === undefined || typeof mergeKey === 'string') return mergeKey;
  throw new TypeError('mergeKey transaksi wajib berupa string.');
}

/**
 * Creates a record store. `initial` must already be validated and not shared with the caller
 * (the store freezes it when `freeze` is enabled).
 *
 * @internal
 */
export function createRecordStore(initial: BoardDocument, options: StoreOptions): RecordStore {
  const { freeze, isReadOnly, onChange, beforeCommit } = options;
  const seal = <T>(value: T): T => (freeze ? deepFreeze(value) : value);
  const sealShallow = <T extends object>(value: T): T => (freeze ? Object.freeze(value) : value);

  // Internal state: the record map (changed only on commit) and a document snapshot created
  // lazily on read and cached until the next commit. This way a transaction
  // costs in proportion to the number of changed records, not the document size.
  let snapshot: BoardDocument | null = seal(initial);
  let records = new Map<string, BoardRecord>(Object.entries(snapshot.records));
  let bindings = new Map<string, BindingRecord>();
  for (const [id, rec] of records) {
    if (rec.kind === 'binding') bindings.set(id, rec);
  }
  let schemaVersion = snapshot.schemaVersion;
  let meta = snapshot.meta;
  let pluginVersions = snapshot.pluginVersions;
  let active: ActiveTransaction | null = null;
  let inBeforeCommit = false;
  let disposed = false;

  function assertUsable(): void {
    if (disposed) throw new Error('Papan sudah di-dispose.');
  }

  function getDocument(): BoardDocument {
    if (inBeforeCommit && active && active.pending.size > 0) {
      const out: Record<string, BoardRecord> = {};
      for (const [id, rec] of records) {
        if (!active.pending.has(id)) setOwn(out, id, rec);
      }
      for (const [id, rec] of active.pending) {
        if (rec !== undefined) setOwn(out, id, rec);
      }
      const doc: BoardDocument = { schemaVersion, meta, records: sealShallow(out) };
      if (pluginVersions !== undefined) doc.pluginVersions = pluginVersions;
      return sealShallow(doc);
    }
    if (!snapshot) {
      const out: Record<string, BoardRecord> = {};
      for (const [id, rec] of records) setOwn(out, id, rec);
      const doc: BoardDocument = { schemaVersion, meta, records: sealShallow(out) };
      // Only present when set, so documents without plugin migrations keep their exact shape.
      if (pluginVersions !== undefined) doc.pluginVersions = pluginVersions;
      snapshot = sealShallow(doc);
    }
    return snapshot;
  }

  function openTransaction(
    origin: ChangeOrigin,
    label: string | undefined,
    mergeKey: string | undefined,
  ): ActiveTransaction {
    function check(): void {
      if (state.closed) {
        throw new Error(
          'Transaksi sudah selesai; objek transaksi hanya boleh dipakai di dalam fn.',
        );
      }
    }
    function get(id: string): BoardRecord | undefined {
      check();
      return state.pending.has(id) ? state.pending.get(id) : records.get(id);
    }
    const undoHooks: UndoHook[] = [];
    const redoHooks: UndoHook[] = [];
    const state: ActiveTransaction = {
      origin,
      label,
      mergeKey,
      pending: new Map(),
      closed: false,
      undoHooks,
      redoHooks,
      tx: {
        origin,
        label,
        get,
        has: (id) => get(id) !== undefined,
        put(record) {
          check();
          const errors = validateRecordShape(record);
          if (errors.length > 0) throw new InvalidDocumentError(errors);
          state.pending.set(record.id, seal(deepClone(record)));
        },
        remove(id) {
          if (get(id) === undefined) return false;
          state.pending.set(id, undefined);
          return true;
        },
        onUndo(hook) {
          check();
          if (typeof hook !== 'function') throw new TypeError('onUndo hook wajib berupa fungsi.');
          undoHooks.push(hook);
        },
        onRedo(hook) {
          check();
          if (typeof hook !== 'function') throw new TypeError('onRedo hook wajib berupa fungsi.');
          redoHooks.push(hook);
        },
      },
    };
    return state;
  }

  function buildEvent(
    origin: ChangeOrigin,
    label: string | undefined,
    added: Record<string, BoardRecord>,
    updated: Record<string, RecordUpdate>,
    removed: Record<string, BoardRecord>,
    mergeKey?: string,
    onUndoHooks?: readonly UndoHook[],
    onRedoHooks?: readonly UndoHook[],
  ): ChangeEvent {
    return sealShallow({
      added: sealShallow(added),
      updated: sealShallow(updated),
      removed: sealShallow(removed),
      origin,
      label,
      ...(mergeKey !== undefined ? { mergeKey } : {}),
      ...(onUndoHooks !== undefined && onUndoHooks.length > 0 ? { onUndoHooks } : {}),
      ...(onRedoHooks !== undefined && onRedoHooks.length > 0 ? { onRedoHooks } : {}),
    });
  }

  /** Commits pending changes. Returns the event, or `null` when there is no net change. */
  function commit(state: ActiveTransaction): ChangeEvent | null {
    const added: Record<string, BoardRecord> = {};
    const updated: Record<string, RecordUpdate> = {};
    const removed: Record<string, BoardRecord> = {};
    const writes: [string, BoardRecord | undefined][] = [];

    for (const [id, after] of state.pending) {
      const before = records.get(id);
      if (before === after) continue;
      if (before === undefined) {
        setOwn(added, id, after);
      } else if (after === undefined) {
        setOwn(removed, id, before);
      } else if (deepEqual(before, after)) {
        // No net change: keep the old object for structural sharing.
        continue;
      } else {
        setOwn(updated, id, sealShallow({ before, after }));
      }
      writes.push([id, after]);
    }
    if (writes.length === 0) return null;

    for (const [id, rec] of writes) {
      if (rec === undefined) {
        records.delete(id);
        bindings.delete(id);
      } else {
        records.set(id, rec);
        if (rec.kind === 'binding') bindings.set(id, rec);
        else bindings.delete(id);
      }
    }
    snapshot = null;
    return buildEvent(
      state.origin,
      state.label,
      added,
      updated,
      removed,
      state.mergeKey,
      state.undoHooks.length > 0 ? sealShallow([...state.undoHooks]) : undefined,
      state.redoHooks.length > 0 ? sealShallow([...state.redoHooks]) : undefined,
    );
  }

  function runNested<T>(state: ActiveTransaction, fn: (tx: Transaction) => T): T {
    // Savepoint: when the inner fn throws, only its changes are rolled back; the outer transaction
    // decides on its own whether to fail too.
    const savepoint = new Map(state.pending);
    try {
      const result = fn(state.tx);
      if (isThenable(result)) throw asyncError();
      return result;
    } catch (error) {
      state.pending = savepoint;
      throw error;
    }
  }

  function asyncError(): TypeError {
    return new TypeError('fn transaksi wajib sinkron; jangan mengembalikan Promise.');
  }

  return {
    getDocument,
    getRecord(id) {
      if (inBeforeCommit && active && active.pending.has(id)) {
        return active.pending.get(id);
      }
      return records.get(id);
    },
    inTransaction() {
      return active !== null;
    },
    transact<T>(fn: (tx: Transaction) => T, txOptions: TransactOptions = {}): T {
      assertUsable();
      if (typeof fn !== 'function') throw new TypeError('transact wajib menerima fungsi.');
      // Nested transactions are merged into the outermost one; inner transaction options are ignored.
      if (active) return runNested(active, fn);

      const origin = resolveOrigin(txOptions.origin);
      const label = resolveLabel(txOptions.label);
      const mergeKey = resolveMergeKey(txOptions.mergeKey);
      if (origin === 'local' && isReadOnly()) throw new ReadOnlyBoardError();

      const state = openTransaction(origin, label, mergeKey);
      active = state;
      let result: T;
      try {
        result = fn(state.tx);
        if (isThenable(result)) throw asyncError();
        if (beforeCommit && origin !== 'undo' && origin !== 'redo' && state.pending.size > 0) {
          inBeforeCommit = true;
          try {
            beforeCommit(state.tx, state.pending, records, bindings);
          } finally {
            inBeforeCommit = false;
          }
        }
      } finally {
        // Full rollback when fn throws: pending changes are discarded without touching state.
        active = null;
        state.closed = true;
      }
      const event = commit(state);
      if (event) onChange(event);
      return result;
    },
    replaceDocument(doc, origin) {
      assertUsable();
      if (active) throw new Error('loadDocument tidak boleh dipanggil di dalam transaksi.');
      const added: Record<string, BoardRecord> = {};
      const updated: Record<string, RecordUpdate> = {};
      const removed: Record<string, BoardRecord> = {};
      const next = new Map<string, BoardRecord>();
      const nextBindings = new Map<string, BindingRecord>();

      for (const [id, incoming] of Object.entries(doc.records)) {
        const before = records.get(id);
        if (before !== undefined && deepEqual(before, incoming)) {
          next.set(id, before);
          if (before.kind === 'binding') nextBindings.set(id, before);
          continue;
        }
        const after = seal(incoming);
        next.set(id, after);
        if (after.kind === 'binding') nextBindings.set(id, after);
        if (before === undefined) setOwn(added, id, after);
        else setOwn(updated, id, sealShallow({ before, after }));
      }
      for (const [id, before] of records) {
        if (!next.has(id)) setOwn(removed, id, before);
      }

      records = next;
      bindings = nextBindings;
      schemaVersion = doc.schemaVersion;
      meta = seal(doc.meta);
      pluginVersions = doc.pluginVersions === undefined ? undefined : seal(doc.pluginVersions);
      snapshot = null;
      // Replacing the document always emits one event, even when the record diff is empty,
      // because meta and the schema version may change too.
      onChange(buildEvent(origin, undefined, added, updated, removed));
    },
    dispose() {
      disposed = true;
    },
  };
}
