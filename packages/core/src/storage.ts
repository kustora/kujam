/**
 * Loading and debounced autosave through a {@link StorageAdapter} (BOARD-1601).
 *
 * `attachStorage` only uses the public {@link Board} API, so it works with any adapter
 * (`@kujam/storage-*` or consumer-written). Flow:
 *
 * 1. `adapter.load(boardId)`; a document is applied with `board.loadDocument`. Autosave starts only
 *    after a successful load, so a failed load never overwrites stored data with an empty board.
 * 2. Every change with origin `local`, `undo`, `redo`, or `migration` marks the board dirty and
 *    (re)starts the debounce timer. `remote` and `load` changes are never saved by this client.
 * 3. One save runs at a time. Changes made during a save trigger another save afterwards.
 * 4. A failed save is retried with exponential backoff. After the last attempt the board stays
 *    dirty and the next change schedules a new save.
 * 5. `pagehide` and `board.dispose()` save immediately (best effort, a single attempt).
 */

import type { Board } from './index.js';
import { createEmitter, reportUnhandled, type Listener, type Unsubscribe } from './events.js';
import type { ChangeOrigin } from './store.js';
import type { BoardDocument, StorageAdapter } from './types.js';

/**
 * Default autosave debounce delay in milliseconds.
 *
 * @public
 */
export const DEFAULT_SAVE_DEBOUNCE_MS = 1000;

/** Change origins that are saved by autosave. */
const SAVED_ORIGINS: ReadonlySet<ChangeOrigin> = new Set(['local', 'undo', 'redo', 'migration']);

/**
 * Retry policy for failed saves. The delay before attempt `n + 1` is
 * `min(baseDelayMs * 2 ** (n - 1), maxDelayMs)`.
 *
 * @beta
 */
export interface SaveRetryOptions {
  /** Total number of attempts per save, including the first. Defaults to `5`. `1` disables retries. */
  maxAttempts?: number;
  /** Delay before the first retry in milliseconds. Defaults to `1000`. */
  baseDelayMs?: number;
  /** Upper bound for the retry delay in milliseconds. Defaults to `30_000`. */
  maxDelayMs?: number;
}

/**
 * Minimal event target for page lifecycle events. In browsers this is `globalThis` (the window).
 *
 * @beta
 */
export interface PageLifecycleTarget {
  addEventListener(type: 'pagehide', listener: () => void): void;
  removeEventListener(type: 'pagehide', listener: () => void): void;
}

/**
 * Options for {@link attachStorage}.
 *
 * @beta
 */
export interface AttachStorageOptions {
  /** Board ID passed to `adapter.load` and `adapter.save`. */
  boardId: string;
  /**
   * Debounce delay in milliseconds. Defaults to `adapter.debounceMs`, then
   * {@link DEFAULT_SAVE_DEBOUNCE_MS}.
   */
  debounceMs?: number;
  /** Retry policy for failed saves. */
  retry?: SaveRetryOptions;
  /**
   * Target that emits `pagehide`. Defaults to `globalThis` when it has `addEventListener`
   * (browsers); `null` disables the `pagehide` save.
   */
  lifecycle?: PageLifecycleTarget | null;
}

/**
 * Payload of the `save:start` event.
 *
 * @beta
 */
export interface SaveStartEvent {
  readonly boardId: string;
  /** Attempt number for this save, starting at 1. */
  readonly attempt: number;
}

/**
 * Payload of the `save:success` event.
 *
 * @beta
 */
export interface SaveSuccessEvent {
  readonly boardId: string;
  /** The document snapshot that was saved. */
  readonly document: Readonly<BoardDocument>;
}

/**
 * Payload of the `save:error` event.
 *
 * @beta
 */
export interface SaveErrorEvent {
  readonly boardId: string;
  /** Value the adapter threw or rejected with. */
  readonly error: unknown;
  /** Attempt number that failed, starting at 1. */
  readonly attempt: number;
  /** Whether another attempt is scheduled. */
  readonly willRetry: boolean;
}

/**
 * Event map of a {@link StorageAttachment}.
 *
 * @beta
 */
export interface StorageEventMap {
  'save:start': SaveStartEvent;
  'save:success': SaveSuccessEvent;
  'save:error': SaveErrorEvent;
}

/**
 * Autosave state of a {@link StorageAttachment}.
 *
 * - `loading`: waiting for `adapter.load`.
 * - `idle`: everything is saved.
 * - `pending`: there are unsaved changes waiting for the debounce or a retry.
 * - `saving`: `adapter.save` is running.
 * - `error`: loading failed, or the last save gave up after all retries (changes stay unsaved).
 * - `detached`: autosave was stopped by `detach` or `board.dispose()`.
 *
 * @beta
 */
export type StorageStatus = 'loading' | 'idle' | 'pending' | 'saving' | 'error' | 'detached';

/**
 * Handle returned by {@link attachStorage}.
 *
 * @beta
 */
export interface StorageAttachment {
  /**
   * Settles when loading finishes. Rejects when `adapter.load` fails or returns a binary update
   * (binary state belongs to a sync adapter such as `@kujam/sync-yjs`); autosave then stays off.
   */
  readonly ready: Promise<void>;
  /** Current autosave state. */
  readonly status: StorageStatus;
  /** Whether there are changes that have not been saved successfully. */
  readonly dirty: boolean;
  /** Listens to save events. Listener errors are reported to `console.error`. */
  on<K extends keyof StorageEventMap>(type: K, listener: Listener<StorageEventMap[K]>): Unsubscribe;
  /**
   * Saves now instead of waiting for the debounce, then waits until no save is running.
   * Resolves `true` when everything is saved, `false` otherwise.
   */
  flush(): Promise<boolean>;
  /**
   * Stops autosave after a final save of unsaved changes (one attempt). Called automatically by
   * `board.dispose()`. Safe to call more than once. Resolves like {@link StorageAttachment.flush}.
   */
  detach(): Promise<boolean>;
}

interface ResolvedRetry {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

// Timer functions are accessed via `globalThis`: core targets ES2022 without DOM or Node types.
interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

function timers(): TimerApi {
  return globalThis as unknown as TimerApi;
}

function nonNegative(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} wajib berupa angka berhingga >= 0.`);
  }
  return value;
}

function resolveRetry(retry: SaveRetryOptions | undefined): ResolvedRetry {
  if (retry !== undefined && (typeof retry !== 'object' || retry === null)) {
    throw new TypeError('Opsi retry wajib berupa objek.');
  }
  const maxAttempts = nonNegative(retry?.maxAttempts, 'retry.maxAttempts', 5);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('retry.maxAttempts wajib berupa bilangan bulat >= 1.');
  }
  return {
    maxAttempts,
    baseDelayMs: nonNegative(retry?.baseDelayMs, 'retry.baseDelayMs', 1000),
    maxDelayMs: nonNegative(retry?.maxDelayMs, 'retry.maxDelayMs', 30_000),
  };
}

function resolveLifecycle(
  lifecycle: PageLifecycleTarget | null | undefined,
): PageLifecycleTarget | null {
  if (lifecycle === null) return null;
  const target = lifecycle ?? (globalThis as Partial<PageLifecycleTarget>);
  return typeof target.addEventListener === 'function' &&
    typeof target.removeEventListener === 'function'
    ? (target as PageLifecycleTarget)
    : null;
}

/**
 * Loads a board from a storage adapter and then saves it automatically with a debounce
 * (BOARD-1601).
 *
 * @example
 * ```ts
 * const board = createBoard({ plugins: [defaultElements, defaultTools] });
 * const storage = attachStorage(board, createIndexedDbStorage(), { boardId: 'board-1' });
 * storage.on('save:error', (e) => showOfflineBadge(e.willRetry));
 * await storage.ready;
 * ```
 *
 * @throws `TypeError` when the arguments or options are invalid, or `Error` when the board is
 *   already disposed.
 * @beta
 */
export function attachStorage(
  board: Board,
  adapter: StorageAdapter,
  options: AttachStorageOptions,
): StorageAttachment {
  if (board.disposed) throw new Error('Papan sudah di-dispose.');
  if (
    typeof adapter !== 'object' ||
    adapter === null ||
    typeof adapter.load !== 'function' ||
    typeof adapter.save !== 'function'
  ) {
    throw new TypeError('Adapter storage wajib memiliki method load() dan save().');
  }
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Opsi attachStorage wajib berupa objek.');
  }
  const { boardId } = options;
  if (typeof boardId !== 'string' || boardId.length === 0) {
    throw new TypeError('boardId wajib berupa string tidak kosong.');
  }
  const debounceMs = nonNegative(
    options.debounceMs ?? adapter.debounceMs,
    'debounceMs',
    DEFAULT_SAVE_DEBOUNCE_MS,
  );
  const retry = resolveRetry(options.retry);
  const lifecycle = resolveLifecycle(options.lifecycle);

  const events = createEmitter<StorageEventMap>((type, error) =>
    reportUnhandled(`[kujam] Listener event "${String(type)}" melempar error.`, error),
  );

  let status: StorageStatus = 'loading';
  let dirty = false;
  let detached = false;
  /** Pending debounce or retry timer. */
  let timer: unknown = null;
  /** The running save, if any. */
  let running: Promise<boolean> | null = null;
  /** Attempt number of the next save; reset after a success or a new change. */
  let attempt = 1;
  const offChange: Unsubscribe[] = [];

  function clearTimer(): void {
    if (timer !== null) timers().clearTimeout(timer);
    timer = null;
  }

  function schedule(delay: number): void {
    clearTimer();
    timer = timers().setTimeout(() => {
      timer = null;
      // A running save schedules the next one itself when it ends.
      if (!running) void runSave(!detached);
    }, delay);
  }

  /**
   * Runs one save attempt and resolves whether it succeeded. `allowRetry` is false for
   * best-effort final saves. Must not be called while another save is running.
   */
  function runSave(allowRetry: boolean): Promise<boolean> {
    const current = attempt;
    // Clear the flag first: changes during the save set it again and trigger another save.
    dirty = false;
    status = 'saving';
    const document = board.getDocument();
    events.emit('save:start', Object.freeze({ boardId, attempt: current }));
    running = (async () => {
      try {
        // Deferred call: a synchronous throw must still go through the rejection path below.
        await Promise.resolve().then(() => adapter.save(boardId, { document }));
        attempt = 1;
        events.emit('save:success', Object.freeze({ boardId, document }));
      } catch (error) {
        running = null;
        dirty = true;
        const willRetry = allowRetry && !detached && current < retry.maxAttempts;
        attempt = willRetry ? current + 1 : 1;
        events.emit('save:error', Object.freeze({ boardId, error, attempt: current, willRetry }));
        if (willRetry) {
          status = 'pending';
          schedule(Math.min(retry.baseDelayMs * 2 ** (current - 1), retry.maxDelayMs));
        } else {
          status = detached ? 'detached' : 'error';
        }
        return false;
      }
      running = null;
      if (detached) {
        status = 'detached';
      } else if (dirty) {
        status = 'pending';
        if (timer === null) schedule(debounceMs);
      } else {
        status = 'idle';
      }
      return true;
    })();
    return running;
  }

  /**
   * Saves until nothing is dirty, without waiting for the debounce or a retry delay. Stops at
   * the first failed attempt (which schedules a retry when allowed).
   */
  async function saveNow(allowRetry: boolean): Promise<boolean> {
    for (;;) {
      if (running) {
        if (!(await running)) return false;
        continue;
      }
      if (!dirty) return true;
      clearTimer();
      if (!(await runSave(allowRetry))) return false;
    }
  }

  function onPageHide(): void {
    void saveNow(true);
  }

  let detachPromise: Promise<boolean> | null = null;
  function detach(): Promise<boolean> {
    if (detachPromise) return detachPromise;
    detached = true;
    clearTimer();
    for (const off of offChange) off();
    lifecycle?.removeEventListener('pagehide', onPageHide);
    // A save that is waiting for a retry gets one last attempt.
    detachPromise = saveNow(false).then((saved) => {
      status = 'detached';
      return saved;
    });
    return detachPromise;
  }

  // Detach on dispose, before plugins tear down, while the document is still readable.
  offChange.push(board.on('dispose', () => void detach()));

  const ready = (async () => {
    const loaded = await adapter.load(boardId);
    if (detached) return;
    if (loaded instanceof Uint8Array) {
      throw new TypeError(
        'adapter.load mengembalikan update biner; gunakan adapter sinkronisasi (misalnya @kujam/sync-yjs).',
      );
    }
    if (loaded !== null && loaded !== undefined) board.loadDocument(loaded);
    if (detached) return;
    offChange.push(
      board.on('change', (event) => {
        if (!SAVED_ORIGINS.has(event.origin)) return;
        dirty = true;
        // A running save, or a retry waiting for its backoff delay, picks this change up.
        if (running || (attempt > 1 && timer !== null)) return;
        attempt = 1;
        status = 'pending';
        schedule(debounceMs);
      }),
    );
    lifecycle?.addEventListener('pagehide', onPageHide);
    status = 'idle';
  })();
  ready.catch(() => {
    if (!detached) status = 'error';
  });

  return {
    ready,
    get status() {
      return status;
    },
    get dirty() {
      return dirty;
    },
    on(type, listener) {
      return events.on(type, listener);
    },
    flush() {
      return saveNow(!detached);
    },
    detach,
  };
}
