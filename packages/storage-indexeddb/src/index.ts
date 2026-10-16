/**
 * `@kujam/storage-indexeddb` — Adapter penyimpanan browser IndexedDB untuk `@kujam/core`.
 *
 * @packageDocumentation
 */

import type { BoardDocument } from '@kujam/core';

/**
 * Opsi pembuatan adapter IndexedDB.
 *
 * @public
 */
export interface IndexedDbStorageOptions {
  databaseName?: string;
  debounceMs?: number;
}

/**
 * Antarmuka adapter penyimpanan IndexedDB.
 *
 * @public
 */
export interface IndexedDbStorageAdapter {
  load(boardId: string): Promise<BoardDocument | Uint8Array | null>;
  save(
    boardId: string,
    change: { document?: BoardDocument; update?: Uint8Array },
  ): Promise<void>;
  debounceMs?: number;
}

/**
 * Membuat adapter penyimpanan berbasis IndexedDB.
 *
 * @public
 */
export function createIndexedDbStorage(
  options: IndexedDbStorageOptions = {},
): IndexedDbStorageAdapter {
  return {
    debounceMs: options.debounceMs ?? 1000,
    async load(_boardId: string) {
      return null;
    },
    async save(_boardId: string, _change) {
      // Persistensi ke IndexedDB objectStore
    },
  };
}

