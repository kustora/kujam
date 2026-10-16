/**
 * Store record bertransaksi (BOARD-204).
 *
 * - 204a: peta record dengan structural sharing. Commit hanya mengganti record yang berubah;
 *   record lain tetap objek yang sama (identitas terjaga), sehingga dokumen tidak pernah
 *   di-deep-clone utuh per transaksi. Objek snapshot dokumen dibuat malas saat `getDocument`
 *   dipanggil dan di-cache sampai commit berikutnya.
 * - 204b: perubahan dikumpulkan per ID selama transaksi, lalu dibandingkan dengan state awal
 *   saat commit. Hasilnya diff bersih: record yang dibuat lalu dihapus tidak muncul, update
 *   berulang menjadi satu `updated` dengan `before` awal dan `after` akhir.
 * - 204c: perubahan hanya ditulis ke state saat commit, jadi rollback cukup membuang
 *   perubahan yang tertunda. Transaksi bersarang memakai savepoint.
 */

import { deepClone, deepEqual, deepFreeze, setOwn } from './clone.js';
import type { BoardDocument, BoardRecord } from './types.js';
import { InvalidDocumentError, validateRecordShape } from './validate.js';

/**
 * Asal perubahan yang dibawa setiap transaksi dan event `change`.
 *
 * - `local`: aksi pengguna di papan ini (satu-satunya yang masuk riwayat undo).
 * - `remote`: perubahan dari peer lain atau server (sinkronisasi).
 * - `undo` / `redo`: diterapkan oleh riwayat undo.
 * - `load`: dokumen diganti lewat `loadDocument`.
 * - `migration`: perubahan oleh migrasi skema.
 *
 * @public
 */
export type ChangeOrigin = 'local' | 'remote' | 'undo' | 'redo' | 'load' | 'migration';

/**
 * Daftar semua {@link ChangeOrigin} yang valid.
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
 * Perubahan satu record: nilai sebelum transaksi dan nilai sesudahnya.
 *
 * @public
 */
export interface RecordUpdate<R extends BoardRecord = BoardRecord> {
  readonly before: Readonly<R>;
  readonly after: Readonly<R>;
}

/**
 * Diff bersih per record, dikunci dengan ID record. Satu ID muncul paling banyak di salah
 * satu dari `added`, `updated`, atau `removed`. `removed` membawa record utuh sebelum dihapus,
 * sehingga diff bisa dibalik (dipakai undo).
 *
 * @public
 */
export interface RecordsDiff {
  readonly added: Readonly<Record<string, Readonly<BoardRecord>>>;
  readonly updated: Readonly<Record<string, RecordUpdate>>;
  readonly removed: Readonly<Record<string, Readonly<BoardRecord>>>;
}

/**
 * Isi event `change`: diff satu transaksi beserta asal dan labelnya.
 *
 * @public
 */
export interface ChangeEvent extends RecordsDiff {
  readonly origin: ChangeOrigin;
  /** Label transaksi untuk undo dan log; `undefined` bila tidak diberikan. */
  readonly label: string | undefined;
}

/**
 * Opsi `board.transact`.
 *
 * @public
 */
export interface TransactOptions {
  /** Label untuk riwayat undo dan log aktivitas. */
  label?: string;
  /** Asal perubahan. Bawaan `'local'`. */
  origin?: ChangeOrigin;
}

/**
 * Handle tulis tingkat rendah yang hanya berlaku selama `fn` dari `board.transact` berjalan.
 * Pembacaan melihat perubahan yang sudah ditulis di transaksi yang sama.
 *
 * `put` dan `remove` hanya memeriksa struktur record (field wajib), tanpa skema props, index
 * otomatis, atau aturan `locked`. API `create`/`update`/`delete` (BOARD-205) dibangun di atasnya.
 *
 * @beta
 */
export interface Transaction {
  /** Asal transaksi terluar. */
  readonly origin: ChangeOrigin;
  /** Label transaksi terluar. */
  readonly label: string | undefined;
  /** Membaca record, termasuk perubahan yang belum di-commit. */
  get(id: string): Readonly<BoardRecord> | undefined;
  /** Memeriksa apakah record ada, termasuk perubahan yang belum di-commit. */
  has(id: string): boolean;
  /**
   * Menambah atau mengganti utuh record dengan ID yang sama. Record disalin, jadi objek masukan
   * boleh diubah setelahnya tanpa memengaruhi papan.
   *
   * @throws {@link InvalidDocumentError} bila struktur record tidak valid.
   */
  put(record: BoardRecord): void;
  /** Menghapus record. Mengembalikan `false` bila record tidak ada. */
  remove(id: string): boolean;
}

/**
 * Error yang dilempar saat transaksi berasal `local` dijalankan pada papan `readOnly`.
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
  /** Apakah sebuah transaksi sedang berjalan (`fn` belum selesai). */
  inTransaction(): boolean;
  /** Mengganti seluruh dokumen (sudah divalidasi) sebagai satu transaksi. */
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
 * Membuat store record. `initial` harus sudah divalidasi dan tidak dibagi dengan pemanggil
 * (store akan membekukannya bila `freeze` aktif).
 *
 * @internal
 */
export function createRecordStore(initial: BoardDocument, options: StoreOptions): RecordStore {
  const { freeze, readOnly, onChange } = options;
  const seal = <T>(value: T): T => (freeze ? deepFreeze(value) : value);
  const sealShallow = <T extends object>(value: T): T => (freeze ? Object.freeze(value) : value);

  // State internal: peta record (diubah hanya saat commit) dan snapshot dokumen yang dibuat
  // malas saat dibaca lalu di-cache sampai commit berikutnya. Dengan begitu satu transaksi
  // berbiaya sebanding jumlah record yang berubah, bukan ukuran dokumen.
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

  /** Commit perubahan tertunda. Mengembalikan event, atau `null` bila tidak ada perubahan bersih. */
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
        // Tidak ada perubahan bersih: pertahankan objek lama demi structural sharing.
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
    // Savepoint: bila fn dalam melempar, hanya perubahannya yang dibatalkan; transaksi luar
    // memutuskan sendiri apakah ikut gagal.
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
      // Transaksi bersarang digabung ke transaksi terluar; opsi transaksi dalam diabaikan.
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
        // Rollback total bila fn melempar: perubahan tertunda dibuang tanpa menyentuh state.
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
      // Penggantian dokumen selalu memancarkan satu event, walau diff record kosong,
      // karena meta dan versi skema bisa ikut berubah.
      onChange(buildEvent(origin, undefined, added, updated, removed));
    },
    dispose() {
      disposed = true;
    },
  };
}
