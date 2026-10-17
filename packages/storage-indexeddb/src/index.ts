/**
 * `@kujam/storage-indexeddb` — Browser IndexedDB storage adapter for `@kujam/core` (BOARD-1603).
 *
 * Stores one value per `boardId`: the JSON document (or a binary update) in the `documents` object
 * store, and a small summary in the `boards` store so {@link IndexedDbStorage.list} never reads whole
 * documents. Where IndexedDB is unavailable or refuses writes (for example Safari private browsing,
 * or no `indexedDB` global at all), the adapter falls back to memory and warns once.
 *
 * @packageDocumentation
 */

import {
  deepClone,
  type BoardDocument,
  type StorageAdapter,
  type StorageChange,
} from '@kujam/core';

const DB_VERSION = 1;
const DOCUMENTS = 'documents';
const BOARDS = 'boards';
const PROBE_KEY = '__kujam_probe__';

/** Value stored per board: a JSON document or a binary update. */
type StoredValue = BoardDocument | Uint8Array;

/**
 * Options for creating the IndexedDB adapter.
 *
 * @public
 */
export interface IndexedDbStorageOptions {
  /** Database name. Defaults to `'kujam'`. Use different names to keep apps or tests apart. */
  databaseName?: string;
  /** Autosave debounce delay advertised to `attachStorage`. Defaults to core's 1000 ms. */
  debounceMs?: number;
  /**
   * IndexedDB factory. Defaults to `globalThis.indexedDB`. Pass another factory (for example
   * `fake-indexeddb` in tests), or `null` to always use the memory fallback.
   */
  indexedDB?: IDBFactory | null;
  /**
   * Called once when the adapter falls back to memory, with the reason. Defaults to a
   * `console.warn`. Data stored in fallback mode is lost when the page is reloaded.
   */
  onFallback?: (reason: unknown) => void;
}

/**
 * Where the adapter keeps data: IndexedDB, or memory after a fallback.
 *
 * @public
 */
export type IndexedDbStorageMode = 'indexeddb' | 'memory';

/**
 * Summary of a stored board, as returned by {@link IndexedDbStorage.list}.
 *
 * @public
 */
export interface StoredBoardInfo {
  readonly boardId: string;
  /** Time of the last save, in milliseconds since the epoch (`Date.now()`). */
  readonly updatedAt: number;
  /** Whether the stored value is a JSON document or a binary update. */
  readonly kind: 'document' | 'update';
}

/**
 * IndexedDB {@link StorageAdapter} with board listing for demos.
 *
 * @public
 */
export interface IndexedDbStorage extends StorageAdapter {
  /** Stored boards, most recently saved first (ties ordered by `boardId`). */
  list(): Promise<StoredBoardInfo[]>;
  /** Deletes a stored board. Resolves `false` when nothing was stored for `boardId`. */
  remove(boardId: string): Promise<boolean>;
  /** Resolves with the storage mode once IndexedDB has been opened (or has failed to open). */
  mode(): Promise<IndexedDbStorageMode>;
  /** Closes the database connection. The next call opens it again. */
  close(): void;
}

/** Storage operations shared by the IndexedDB and memory backends. */
interface Backend {
  readonly mode: IndexedDbStorageMode;
  get(boardId: string): Promise<StoredValue | null>;
  put(boardId: string, value: StoredValue, info: StoredBoardInfo): Promise<void>;
  list(): Promise<StoredBoardInfo[]>;
  remove(boardId: string): Promise<boolean>;
  close(): void;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaksi IndexedDB dibatalkan.'));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS)) db.createObjectStore(DOCUMENTS);
      if (!db.objectStoreNames.contains(BOARDS))
        db.createObjectStore(BOARDS, { keyPath: 'boardId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Writes and deletes a sentinel value. Some private browsing modes open the database but reject
 * every write, which must be detected before the board relies on it.
 */
async function probeWrites(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(DOCUMENTS, 'readwrite');
  const store = tx.objectStore(DOCUMENTS);
  store.put(0, PROBE_KEY);
  store.delete(PROBE_KEY);
  await transactionDone(tx);
}

function sortInfos(infos: StoredBoardInfo[]): StoredBoardInfo[] {
  return infos.sort(
    (a, b) =>
      b.updatedAt - a.updatedAt || (a.boardId < b.boardId ? -1 : a.boardId > b.boardId ? 1 : 0),
  );
}

function indexedDbBackend(db: IDBDatabase, onClose: () => void): Backend {
  // Another tab upgrading the database: let it proceed and reopen on the next call.
  db.onversionchange = () => {
    db.close();
    onClose();
  };
  return {
    mode: 'indexeddb',
    async get(boardId) {
      const tx = db.transaction(DOCUMENTS, 'readonly');
      const value = await requestResult(tx.objectStore(DOCUMENTS).get(boardId));
      return (value as StoredValue | undefined) ?? null;
    },
    async put(boardId, value, info) {
      const tx = db.transaction([DOCUMENTS, BOARDS], 'readwrite');
      tx.objectStore(DOCUMENTS).put(value, boardId);
      tx.objectStore(BOARDS).put(info);
      await transactionDone(tx);
    },
    async list() {
      const tx = db.transaction(BOARDS, 'readonly');
      const infos = await requestResult(tx.objectStore(BOARDS).getAll());
      return sortInfos(infos as StoredBoardInfo[]);
    },
    async remove(boardId) {
      const tx = db.transaction([DOCUMENTS, BOARDS], 'readwrite');
      const existed = (await requestResult(tx.objectStore(BOARDS).count(boardId))) > 0;
      tx.objectStore(DOCUMENTS).delete(boardId);
      tx.objectStore(BOARDS).delete(boardId);
      await transactionDone(tx);
      return existed;
    },
    close() {
      db.close();
    },
  };
}

function memoryBackend(): Backend {
  const values = new Map<string, StoredValue>();
  const infos = new Map<string, StoredBoardInfo>();
  return {
    mode: 'memory',
    async get(boardId) {
      const value = values.get(boardId);
      return value === undefined ? null : deepClone(value);
    },
    async put(boardId, value, info) {
      values.set(boardId, deepClone(value));
      infos.set(boardId, info);
    },
    async list() {
      return sortInfos([...infos.values()]);
    },
    async remove(boardId) {
      infos.delete(boardId);
      return values.delete(boardId);
    },
    close() {},
  };
}

function defaultFallbackWarning(reason: unknown): void {
  const console = (globalThis as { console?: { warn?: (...args: unknown[]) => void } }).console;
  console?.warn?.(
    '[kujam] IndexedDB tidak tersedia (misalnya mode privat Safari); papan disimpan di memori dan ' +
      'hilang saat halaman dimuat ulang.',
    reason,
  );
}

function assertBoardId(boardId: unknown): asserts boardId is string {
  if (typeof boardId !== 'string' || boardId.length === 0) {
    throw new TypeError('boardId wajib berupa string tidak kosong.');
  }
}

/**
 * Creates an IndexedDB-backed storage adapter.
 *
 * The database is opened lazily on the first call. When opening it or a test write fails, the
 * adapter switches to an in-memory store for the rest of its life, calls `onFallback` once, and
 * keeps working, so the board stays usable in Safari private browsing.
 *
 * @example
 * ```ts
 * const storage = createIndexedDbStorage({ databaseName: 'my-app' });
 * attachStorage(board, storage, { boardId: 'retro-2026' });
 * const boards = await storage.list(); // [{ boardId: 'retro-2026', updatedAt, kind: 'document' }]
 * ```
 *
 * @public
 */
export function createIndexedDbStorage(options: IndexedDbStorageOptions = {}): IndexedDbStorage {
  const name = options.databaseName ?? 'kujam';
  const factory =
    options.indexedDB === undefined
      ? (globalThis as { indexedDB?: IDBFactory }).indexedDB
      : options.indexedDB;
  const onFallback = options.onFallback ?? defaultFallbackWarning;
  /** Set once IndexedDB has failed; every later call uses it. */
  let fallback: Backend | null = null;
  let opening: Promise<Backend> | null = null;

  async function connect(): Promise<Backend> {
    if (!factory) throw new Error('IndexedDB tidak tersedia di lingkungan ini.');
    const db = await openDatabase(factory, name);
    try {
      await probeWrites(db);
    } catch (error) {
      db.close();
      throw error;
    }
    return indexedDbBackend(db, () => {
      opening = null;
    });
  }

  function backend(): Promise<Backend> {
    if (fallback) return Promise.resolve(fallback);
    opening ??= connect().catch((reason: unknown) => {
      // A newer version of the database exists (another tab runs a newer app): falling back would
      // make that data look missing, so fail this call and try again next time.
      if ((reason as { name?: unknown } | null)?.name === 'VersionError') {
        opening = null;
        throw reason;
      }
      fallback = memoryBackend();
      onFallback(reason);
      return fallback;
    });
    return opening;
  }

  return {
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    async load(boardId: string) {
      assertBoardId(boardId);
      return (await backend()).get(boardId);
    },
    async save(boardId: string, change: StorageChange) {
      assertBoardId(boardId);
      // A JSON document wins over a binary update when both are given.
      const value = change.document ?? change.update;
      if (value === undefined) return;
      const info: StoredBoardInfo = {
        boardId,
        updatedAt: Date.now(),
        kind: change.document !== undefined ? 'document' : 'update',
      };
      await (await backend()).put(boardId, value, info);
    },
    async list() {
      return (await backend()).list();
    },
    async remove(boardId: string) {
      assertBoardId(boardId);
      return (await backend()).remove(boardId);
    },
    async mode() {
      return (await backend()).mode;
    },
    close() {
      const current = opening;
      opening = null;
      void current?.then((b) => b.close());
    },
  };
}
