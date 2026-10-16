/**
 * `@kujam/storage-memory` — Adapter penyimpanan in-memory untuk pengujian dan demo.
 *
 * @packageDocumentation
 */

import { deepClone, type BoardDocument, type StorageAdapter } from '@kujam/core';

/**
 * Membuat adapter penyimpanan berbasis Map di memori.
 *
 * @public
 */
export function createMemoryStorage(): StorageAdapter {
  const store = new Map<string, BoardDocument | Uint8Array>();

  return {
    async load(boardId: string) {
      const value = store.get(boardId);
      return value === undefined ? null : deepClone(value);
    },
    async save(boardId: string, change) {
      if (change.document) {
        store.set(boardId, deepClone(change.document));
      } else if (change.update) {
        store.set(boardId, deepClone(change.update));
      }
    },
  };
}
