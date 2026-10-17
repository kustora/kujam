/**
 * `@kujam/storage-indexeddb` — Browser IndexedDB storage adapter for `@kujam/core`.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from '@kujam/core';

/**
 * Options for creating the IndexedDB adapter.
 *
 * @public
 */
export interface IndexedDbStorageOptions {
  databaseName?: string;
  debounceMs?: number;
}

/**
 * Creates an IndexedDB-backed storage adapter.
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
      // Persist to the IndexedDB objectStore
    },
  };
}
