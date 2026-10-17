/**
 * `@kujam/storage-memory` — In-memory storage adapter for testing and demos (BOARD-1602).
 *
 * Nothing survives a page reload. Every save is recorded in {@link MemoryStorage.saved} so tests can
 * assert what `attachStorage` wrote, and {@link MemoryStorage.failNextSaves} simulates an offline
 * backend.
 *
 * @packageDocumentation
 */

import {
  deepClone,
  type BoardDocument,
  type StorageAdapter,
  type StorageChange,
} from '@kujam/core';

/**
 * Value stored per board: a JSON document or a binary update (for example Yjs state).
 *
 * @public
 */
export type StoredBoard = BoardDocument | Uint8Array;

/**
 * One recorded call to {@link MemoryStorage.save}.
 *
 * @public
 */
export interface SavedChange {
  readonly boardId: string;
  /** Deep copy of the change as it was passed to `save`. */
  readonly change: StorageChange;
}

/**
 * Options for {@link createMemoryStorage}.
 *
 * @public
 */
export interface MemoryStorageOptions {
  /** Boards available before the first save, keyed by board ID. Copied, never mutated. */
  initial?: Readonly<Record<string, StoredBoard>>;
  /** Autosave debounce delay advertised to `attachStorage`. Defaults to core's 1000 ms. */
  debounceMs?: number;
}

/**
 * In-memory {@link StorageAdapter} that can be inspected.
 *
 * @public
 */
export interface MemoryStorage extends StorageAdapter {
  /** Every successful save in call order, deep-copied so later board changes do not leak in. */
  readonly saved: readonly SavedChange[];
  /** Copy of what is currently stored for `boardId`, or `null` when nothing is stored. */
  peek(boardId: string): StoredBoard | null;
  /** IDs of every stored board, in first-save order. */
  boards(): string[];
  /**
   * Makes the next `count` saves reject with `error` (default: a generic error) without storing
   * anything or recording them in {@link MemoryStorage.saved}. Useful for testing retries.
   */
  failNextSaves(count: number, error?: unknown): void;
  /** Removes every stored board, the save log, and pending failures. */
  clear(): void;
}

/**
 * Creates a Map-backed in-memory storage adapter.
 *
 * @example
 * ```ts
 * const storage = createMemoryStorage();
 * const attachment = attachStorage(board, storage, { boardId: 'b1' });
 * await attachment.flush();
 * expect(storage.saved.at(-1)?.change.document).toEqual(board.getDocument());
 * ```
 *
 * @public
 */
export function createMemoryStorage(options: MemoryStorageOptions = {}): MemoryStorage {
  const store = new Map<string, StoredBoard>();
  for (const [id, value] of Object.entries(options.initial ?? {})) {
    store.set(id, deepClone(value));
  }
  const saved: SavedChange[] = [];
  let failures = 0;
  let failure: unknown;

  return {
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    get saved() {
      return saved;
    },
    async load(boardId: string) {
      const value = store.get(boardId);
      return value === undefined ? null : deepClone(value);
    },
    async save(boardId: string, change: StorageChange) {
      if (failures > 0) {
        failures--;
        throw failure ?? new Error('Penyimpanan memori gagal (disimulasikan).');
      }
      const copy = deepClone(change);
      // A JSON document wins over a binary update when both are given.
      const value = copy.document ?? copy.update;
      if (value !== undefined) store.set(boardId, value);
      saved.push(Object.freeze({ boardId, change: copy }));
    },
    peek(boardId: string) {
      const value = store.get(boardId);
      return value === undefined ? null : deepClone(value);
    },
    boards() {
      return [...store.keys()];
    },
    failNextSaves(count: number, error?: unknown) {
      if (!Number.isInteger(count) || count < 0) {
        throw new TypeError('count wajib berupa bilangan bulat tidak negatif.');
      }
      failures = count;
      failure = error;
    },
    clear() {
      store.clear();
      saved.length = 0;
      failures = 0;
      failure = undefined;
    },
  };
}
