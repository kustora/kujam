/**
 * `@kujam/storage-memory` — Adapter penyimpanan in-memory untuk pengujian dan demo.
 *
 * @packageDocumentation
 */

import type { BoardDocument } from '@kujam/core';

/**
 * Antarmuka adapter penyimpanan dokumen papan.
 *
 * @public
 */
export interface StorageAdapter {
  load(boardId: string): Promise<BoardDocument | Uint8Array | null>;
  save(
    boardId: string,
    change: { document?: BoardDocument; update?: Uint8Array },
  ): Promise<void>;
  debounceMs?: number;
}

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
      if (!value) return null;
      if (value instanceof Uint8Array) return new Uint8Array(value);
      return JSON.parse(JSON.stringify(value)) as BoardDocument;
    },
    async save(boardId: string, change) {
      if (change.document) {
        store.set(boardId, JSON.parse(JSON.stringify(change.document)) as BoardDocument);
      } else if (change.update) {
        store.set(boardId, new Uint8Array(change.update));
      }
    },
  };
}
