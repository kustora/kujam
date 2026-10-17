/**
 * `@kujam/sync-yjs` — Yjs sync adapter and awareness presence for `@kujam/core`.
 *
 * @packageDocumentation
 */

import type { Board } from '@kujam/core';

/**
 * Board sync connection status.
 *
 * @public
 */
export type SyncStatus = 'offline' | 'connecting' | 'synced';

/**
 * Sync adapter interface for a board.
 *
 * @public
 */
export interface SyncAdapter {
  readonly status: SyncStatus;
  connect(board: Board): void;
  disconnect(): void;
}

/**
 * Creates a Yjs-based sync adapter.
 *
 * @public
 */
export function createYjsSyncAdapter(): SyncAdapter {
  let currentStatus: SyncStatus = 'offline';

  return {
    get status(): SyncStatus {
      return currentStatus;
    },
    connect(_board: Board): void {
      currentStatus = 'synced';
    },
    disconnect(): void {
      currentStatus = 'offline';
    },
  };
}
