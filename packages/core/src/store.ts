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

import { deepClone, deepEqual, deepFreeze, setOwn } from './clone.js';
import type { BoardDocument, BoardRecord } from './types.js';
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
}

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
  readOnly: boolean;
  onChange: (event: ChangeEvent) => void;
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
  pending: Pending;
  closed: boolean;
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

/**
 * Creates a record store. `initial` must already be validated and not shared with the caller
 * (the store freezes it when `freeze` is enabled).
 *
 * @internal
 */
export function createRecordStore(initial: BoardDocument, options: StoreOptions): RecordStore {
  const { freeze, readOnly, onChange } = options;
  const seal = <T>(value: T): T => (freeze ? deepFreeze(value) : value);
  const sealShallow = <T extends object>(value: T): T => (freeze ? Object.freeze(value) : value);

  // Internal state: the record map (changed only on commit) and a document snapshot created
  // lazily on read and cached until the next commit. This way a transaction
  // costs in proportion to the number of changed records, not the document size.
  let snapshot: BoardDocument | null = seal(initial);
  let records = new Map<string, BoardRecord>(Object.entries(snapshot.records));
  let schemaVersion = snapshot.schemaVersion;
  let meta = snapshot.meta;
  let active: ActiveTransaction | null = null;
  let disposed = false;

  function assertUsable(): void {
    if (disposed) throw new Error('Papan sudah di-dispose.');
  }

  function getDocument(): BoardDocument {
    if (!snapshot) {
      const out: Record<string, BoardRecord> = {};
      for (const [id, rec] of records) setOwn(out, id, rec);
      snapshot = sealShallow({ schemaVersion, meta, records: sealShallow(out) });
    }
    return snapshot;
  }

  function openTransaction(origin: ChangeOrigin, label: string | undefined): ActiveTransaction {
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
    const state: ActiveTransaction = {
      origin,
      label,
      pending: new Map(),
      closed: false,
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
  ): ChangeEvent {
    return sealShallow({
      added: sealShallow(added),
      updated: sealShallow(updated),
      removed: sealShallow(removed),
      origin,
      label,
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
      if (rec === undefined) records.delete(id);
      else records.set(id, rec);
    }
    snapshot = null;
    return buildEvent(state.origin, state.label, added, updated, removed);
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
      if (readOnly && origin === 'local') throw new ReadOnlyBoardError();

      const state = openTransaction(origin, label);
      active = state;
      let result: T;
      try {
        result = fn(state.tx);
        if (isThenable(result)) throw asyncError();
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

      for (const [id, incoming] of Object.entries(doc.records)) {
        const before = records.get(id);
        if (before !== undefined && deepEqual(before, incoming)) {
          next.set(id, before);
          continue;
        }
        const after = seal(incoming);
        next.set(id, after);
        if (before === undefined) setOwn(added, id, after);
        else setOwn(updated, id, sealShallow({ before, after }));
      }
      for (const [id, before] of records) {
        if (!next.has(id)) setOwn(removed, id, before);
      }

      records = next;
      schemaVersion = doc.schemaVersion;
      meta = seal(doc.meta);
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
