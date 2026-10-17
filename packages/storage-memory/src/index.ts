/**
 * `@kujam/storage-memory` — In-memory storage adapter for testing and demos.
 *
 * @packageDocumentation
 */

import { deepClone, type BoardDocument, type StorageAdapter } from '@kujam/core';

/**
 * Creates a Map-backed in-memory storage adapter.
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
