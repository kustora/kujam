/**
 * `@kujam/storage-http` — Adapter penyimpanan HTTP REST untuk `@kujam/core`.
 *
 * @packageDocumentation
 */

import type { BoardDocument } from '@kujam/core';

/**
 * Opsi konfigurasi untuk adapter penyimpanan HTTP.
 *
 * @public
 */
export interface HttpStorageOptions {
  baseUrl: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  debounceMs?: number;
}

/**
 * Antarmuka adapter penyimpanan HTTP.
 *
 * @public
 */
export interface HttpStorageAdapter {
  load(boardId: string): Promise<BoardDocument | Uint8Array | null>;
  save(
    boardId: string,
    change: { document?: BoardDocument; update?: Uint8Array },
  ): Promise<void>;
  debounceMs?: number;
}

/**
 * Membuat adapter penyimpanan berbasis HTTP fetch.
 *
 * @public
 */
export function createHttpStorage(options: HttpStorageOptions): HttpStorageAdapter {
  return {
    debounceMs: options.debounceMs ?? 1000,
    async load(boardId: string) {
      const customHeaders =
        typeof options.headers === 'function' ? options.headers() : (options.headers ?? {});
      const response = await fetch(
        `${options.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(boardId)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json', ...customHeaders },
        },
      );
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`HTTP load failed with status ${response.status}`);
      }
      return (await response.json()) as BoardDocument;
    },
    async save(boardId: string, change) {
      const customHeaders =
        typeof options.headers === 'function' ? options.headers() : (options.headers ?? {});
      const response = await fetch(
        `${options.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(boardId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...customHeaders },
          body: JSON.stringify(change.document ?? null),
        },
      );
      if (!response.ok) {
        throw new Error(`HTTP save failed with status ${response.status}`);
      }
    },
  };
}

