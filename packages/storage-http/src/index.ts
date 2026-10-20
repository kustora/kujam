/**
 * `@kujam/storage-http` — HTTP REST storage adapter for `@kujam/core` (BOARD-1604).
 *
 * `load` sends `GET` and `save` sends `PUT` to `url(boardId)`. JSON documents are sent as
 * `application/json`, binary updates (for example Yjs state) as `application/octet-stream`; on load,
 * the kind is taken from the response `Content-Type`.
 *
 * Version conflicts use HTTP conditional requests: the `ETag` of the last load or save is sent back
 * as `If-Match`, and a `409 Conflict` or `412 Precondition Failed` response is reported as a
 * conflict. `401`, `403`, and conflicts emit adapter events and reject with {@link HttpStorageError};
 * errors that cannot succeed on retry carry `retryable: false`, so `attachStorage` stops retrying.
 *
 * @packageDocumentation
 */

import type { BoardDocument, StorageAdapter, StorageChange } from '@kujam/core';

const JSON_TYPE = 'application/json';
const BINARY_TYPE = 'application/octet-stream';

/**
 * Storage operation that sent a request.
 *
 * @public
 */
export type HttpStorageOperation = 'load' | 'save';

/**
 * Context passed to a {@link HttpStorageOptions.headers} function.
 *
 * @public
 */
export interface HttpStorageRequestContext {
  readonly boardId: string;
  readonly operation: HttpStorageOperation;
}

/**
 * Options for {@link createHttpStorage}.
 *
 * @public
 */
export interface HttpStorageOptions {
  /**
   * Endpoint of a board, for example `(id) => \`/api/boards/${encodeURIComponent(id)}\``. The board
   * ID is passed as is: encode it yourself.
   */
  url: (boardId: string) => string | URL;
  /**
   * Extra request headers. A function is called before every request and may be async, so a fresh
   * access token can be returned after it was refreshed (for example in an `unauthorized`
   * listener). Headers given here override the adapter's `Accept` and `Content-Type`.
   */
  headers?:
    HeadersInit | ((context: HttpStorageRequestContext) => HeadersInit | Promise<HeadersInit>);
  /**
   * `fetch` implementation. Defaults to `globalThis.fetch`, looked up on every request. Use it to
   * add credentials, timeouts, or logging, or in tests.
   */
  fetch?: (input: string | URL, init: RequestInit) => Promise<Response>;
  /** Autosave debounce delay advertised to `attachStorage`. Defaults to core's 1000 ms. */
  debounceMs?: number;
}

/**
 * Kind of {@link HttpStorageError}.
 *
 * - `unauthorized`: `401`. Retried by `attachStorage`, so a refreshed token is used next time.
 * - `forbidden`: `403`. Not retried.
 * - `conflict`: `409` or `412`, the stored board changed since it was loaded. Not retried.
 * - `http`: any other failed status. Retried for `408`, `425`, `429`, and `5xx`.
 *
 * @public
 */
export type HttpStorageErrorKind = 'unauthorized' | 'forbidden' | 'conflict' | 'http';

/**
 * Error thrown by the HTTP adapter for a failed response. Network failures are rejected with the
 * error from `fetch` instead.
 *
 * @public
 */
export class HttpStorageError extends Error {
  override readonly name = 'HttpStorageError';
  /** What went wrong, derived from {@link HttpStorageError.status}. */
  readonly kind: HttpStorageErrorKind;
  /** HTTP status of the response. */
  readonly status: number;
  /** Operation that sent the request. */
  readonly operation: HttpStorageOperation;
  /** Board the request was for. */
  readonly boardId: string;
  /** Whether repeating the request can succeed. `attachStorage` does not retry when `false`. */
  readonly retryable: boolean;
  /** The failed response. Its body has not been read. */
  readonly response: Response;

  constructor(operation: HttpStorageOperation, boardId: string, response: Response) {
    const kind = errorKind(response.status);
    super(
      `Penyimpanan HTTP gagal ${operation === 'load' ? 'memuat' : 'menyimpan'} papan "${boardId}" ` +
        `(status ${response.status}).`,
    );
    this.kind = kind;
    this.status = response.status;
    this.operation = operation;
    this.boardId = boardId;
    this.retryable = isRetryableStatus(response.status);
    this.response = response;
  }
}

/**
 * Payload of the adapter events.
 *
 * @public
 */
export interface HttpStorageEvent {
  readonly boardId: string;
  readonly operation: HttpStorageOperation;
  readonly status: number;
  /** The error the operation rejects with. */
  readonly error: HttpStorageError;
}

/**
 * Event map of a {@link HttpStorage}.
 *
 * @public
 */
export interface HttpStorageEventMap {
  /** `401`: the access token is missing or expired. */
  unauthorized: HttpStorageEvent;
  /** `403`: the user may not read or write this board. */
  forbidden: HttpStorageEvent;
  /** `409` or `412`: the stored board changed since this client loaded or saved it. */
  conflict: HttpStorageEvent;
}

/**
 * HTTP {@link StorageAdapter} with auth and conflict events.
 *
 * @public
 */
export interface HttpStorage extends StorageAdapter {
  /**
   * Listens to an adapter event. Events are emitted before the operation rejects. Listener errors
   * are reported to `console.error`. Returns a function that removes the listener.
   */
  on<K extends keyof HttpStorageEventMap>(
    type: K,
    listener: (event: HttpStorageEventMap[K]) => void,
  ): () => void;
  /** `ETag` of the last successful load or save of `boardId`, or `null` when none is known. */
  getVersion(boardId: string): string | null;
  /**
   * Sets the `ETag` sent as `If-Match` on the next save of `boardId`. `null` sends no `If-Match`,
   * so the next save overwrites the stored board (use it to resolve a conflict in favour of this
   * client). Loading the board again also refreshes the version.
   */
  setVersion(boardId: string, version: string | null): void;
}

function errorKind(status: number): HttpStorageErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409 || status === 412) return 'conflict';
  return 'http';
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function assertBoardId(boardId: unknown): asserts boardId is string {
  if (typeof boardId !== 'string' || boardId.length === 0) {
    throw new TypeError('boardId wajib berupa string tidak kosong.');
  }
}

function reportListenerError(type: string, error: unknown): void {
  const console = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console;
  console?.error?.(`[kujam] Listener event "${type}" melempar error.`, error);
}

/**
 * Creates an HTTP fetch-based storage adapter.
 *
 * @example
 * ```ts
 * const storage = createHttpStorage({
 *   url: (id) => `/api/boards/${encodeURIComponent(id)}`,
 *   headers: async () => ({ Authorization: `Bearer ${await auth.token()}` }),
 * });
 * storage.on('unauthorized', () => auth.refresh());
 * storage.on('conflict', () => showReloadPrompt());
 * attachStorage(board, storage, { boardId: 'retro-2026' });
 * ```
 *
 * @throws `TypeError` when `url` is not a function.
 * @public
 */
export function createHttpStorage(options: HttpStorageOptions): HttpStorage {
  if (typeof options !== 'object' || options === null || typeof options.url !== 'function') {
    throw new TypeError('Opsi url wajib berupa fungsi (boardId) => string | URL.');
  }
  const versions = new Map<string, string>();
  const listeners = new Map<keyof HttpStorageEventMap, Set<(event: HttpStorageEvent) => void>>();

  function emit(type: keyof HttpStorageEventMap, event: HttpStorageEvent): void {
    for (const listener of [...(listeners.get(type) ?? [])]) {
      try {
        listener(event);
      } catch (error) {
        reportListenerError(type, error);
      }
    }
  }

  async function request(
    operation: HttpStorageOperation,
    boardId: string,
    init: RequestInit & { headers: Headers },
  ): Promise<Response> {
    const custom =
      typeof options.headers === 'function'
        ? await options.headers({ boardId, operation })
        : options.headers;
    new Headers(custom).forEach((value, key) => init.headers.set(key, value));
    const fetchFn = options.fetch ?? (globalThis as { fetch?: HttpStorageOptions['fetch'] }).fetch;
    if (!fetchFn) throw new Error('fetch tidak tersedia; berikan opsi fetch.');
    return fetchFn(options.url(boardId), init);
  }

  /** Rejects with an {@link HttpStorageError} after emitting its event, if it has one. */
  function fail(operation: HttpStorageOperation, boardId: string, response: Response): never {
    const error = new HttpStorageError(operation, boardId, response);
    if (error.kind !== 'http') {
      emit(error.kind, Object.freeze({ boardId, operation, status: error.status, error }));
    }
    throw error;
  }

  function rememberVersion(boardId: string, response: Response): void {
    const etag = response.headers.get('ETag');
    if (etag) versions.set(boardId, etag);
    else versions.delete(boardId);
  }

  return {
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    async load(boardId: string) {
      assertBoardId(boardId);
      const response = await request('load', boardId, {
        method: 'GET',
        headers: new Headers({ Accept: `${JSON_TYPE}, ${BINARY_TYPE}` }),
      });
      if (response.status === 404 || response.status === 204) {
        versions.delete(boardId);
        return null;
      }
      if (!response.ok) fail('load', boardId, response);
      rememberVersion(boardId, response);
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
      assertBoardId(boardId);
      let body: BodyInit;
      let contentType: string;
      if (change.document) {
        body = JSON.stringify(change.document);
        contentType = JSON_TYPE;
      } else if (change.update) {
        // ArrayBuffer-backed copy (not SharedArrayBuffer) so it is valid as BodyInit.
        body = change.update.slice();
        contentType = BINARY_TYPE;
      } else {
        throw new TypeError('save() membutuhkan change.document atau change.update.');
      }
      const headers = new Headers({ 'Content-Type': contentType });
      const version = versions.get(boardId);
      if (version !== undefined) headers.set('If-Match', version);
      const response = await request('save', boardId, { method: 'PUT', headers, body });
      if (!response.ok) fail('save', boardId, response);
      // Without a new ETag the old one is stale: sending it again would report a false conflict.
      rememberVersion(boardId, response);
    },
    on(type, listener) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      const entry = listener as (event: HttpStorageEvent) => void;
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },
    getVersion(boardId: string) {
      return versions.get(boardId) ?? null;
    },
    setVersion(boardId: string, version: string | null) {
      assertBoardId(boardId);
      if (version === null) {
        versions.delete(boardId);
      } else if (typeof version === 'string' && version.length > 0) {
        versions.set(boardId, version);
      } else {
        throw new TypeError('version wajib berupa string tidak kosong atau null.');
      }
    },
  };
}
