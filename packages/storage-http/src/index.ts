/**
 * `@kujam/storage-http` — Adapter penyimpanan HTTP REST untuk `@kujam/core`.
 *
 * Dokumen JSON dikirim sebagai `application/json`, update biner (misalnya state Yjs)
 * sebagai `application/octet-stream`. Saat memuat, jenis respons ditentukan dari `Content-Type`.
 *
 * @packageDocumentation
 */

import type { BoardDocument, StorageAdapter, StorageChange } from '@kujam/core';

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

const BINARY_TYPE = 'application/octet-stream';

/**
 * Membuat adapter penyimpanan berbasis HTTP fetch.
 *
 * @public
 */
export function createHttpStorage(options: HttpStorageOptions): StorageAdapter {
  const urlFor = (boardId: string): string =>
    `${options.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(boardId)}`;
  const customHeaders = (): Record<string, string> =>
    typeof options.headers === 'function' ? options.headers() : (options.headers ?? {});

  return {
    debounceMs: options.debounceMs ?? 1000,
    async load(boardId: string) {
      const response = await fetch(urlFor(boardId), {
        method: 'GET',
        headers: { Accept: `application/json, ${BINARY_TYPE}`, ...customHeaders() },
      });
      if (response.status === 404 || response.status === 204) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`HTTP load failed with status ${response.status}`);
      }
      const contentType = response.headers.get('Content-Type') ?? '';
      if (contentType.includes(BINARY_TYPE)) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return bytes.byteLength === 0 ? null : bytes;
      }
      const text = await response.text();
      if (text.trim() === '') {
        return null;
      }
      return JSON.parse(text) as BoardDocument;
    },
    async save(boardId: string, change: StorageChange) {
      let body: BodyInit;
      let contentType: string;
      if (change.document) {
        body = JSON.stringify(change.document);
        contentType = 'application/json';
      } else if (change.update) {
        // Salinan ber-ArrayBuffer (bukan SharedArrayBuffer) agar sah sebagai BodyInit.
        body = change.update.slice();
        contentType = BINARY_TYPE;
      } else {
        throw new TypeError('save() membutuhkan change.document atau change.update.');
      }
      const response = await fetch(urlFor(boardId), {
        method: 'PUT',
        headers: { 'Content-Type': contentType, ...customHeaders() },
        body,
      });
      if (!response.ok) {
        throw new Error(`HTTP save failed with status ${response.status}`);
      }
    },
  };
}
