/**
 * In-memory {@link WorkerStore} for the demo and tests. A real server keeps the same four
 * operations on its database: the board state column, a placement table, and object storage.
 */

import type { CardPlacementReference } from '@kujam/server';
import type { PlacementDiff, WorkerStore } from './worker.js';

export interface MemoryStore extends WorkerStore {
  readonly states: Map<string, Uint8Array>;
  readonly placements: Map<string, CardPlacementReference[]>;
  readonly thumbnails: Map<string, Uint8Array>;
}

export function createMemoryStore(): MemoryStore {
  const states = new Map<string, Uint8Array>();
  const placements = new Map<string, CardPlacementReference[]>();
  const thumbnails = new Map<string, Uint8Array>();
  return {
    states,
    placements,
    thumbnails,
    async loadState(boardId) {
      return states.get(boardId) ?? null;
    },
    async loadPlacements(boardId) {
      return placements.get(boardId) ?? [];
    },
    async savePlacements(boardId, diff: PlacementDiff) {
      const removed = new Set(diff.removed);
      const next = (placements.get(boardId) ?? []).filter((ref) => !removed.has(ref));
      placements.set(boardId, [...next, ...diff.added]);
    },
    async saveThumbnail(boardId, png) {
      thumbnails.set(boardId, png);
    },
  };
}
