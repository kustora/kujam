/**
 * `@kujam/storage-indexeddb` — Adapter penyimpanan browser IndexedDB untuk `@kujam/core`.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from '@kujam/core';

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
 * Membuat adapter penyimpanan berbasis IndexedDB.
 *
 * @public
 */
export function createIndexedDbStorage(options: IndexedDbStorageOptions = {}): StorageAdapter {
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
