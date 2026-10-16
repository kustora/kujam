/**
 * `@kujam/sync-yjs` — Adapter sinkronisasi Yjs dan awareness presence untuk `@kujam/core`.
 *
 * @packageDocumentation
 */

import type { Board } from '@kujam/core';

/**
 * Status koneksi sinkronisasi papan.
 *
 * @public
 */
export type SyncStatus = 'offline' | 'connecting' | 'synced';

/**
 * Antarmuka adapter sinkronisasi untuk papan.
 *
 * @public
 */
export interface SyncAdapter {
  readonly status: SyncStatus;
  connect(board: Board): void;
  disconnect(): void;
}

/**
 * Membuat adapter sinkronisasi berbasis Yjs.
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
