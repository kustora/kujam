/**
 * IndexedDB persistence support for Yjs sync adapter using y-indexeddb (BOARD-1508).
 *
 * @packageDocumentation
 */

import type * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export { IndexeddbPersistence };

/**
 * Configuration options for IndexedDB persistence in Yjs sync adapter (BOARD-1508).
 *
 * @public
 */
export interface YjsIndexedDbOptions {
  /**
   * Database name for IndexedDB storage.
   * Defaults to `'kujam-yjs'`.
   */
  name?: string;
}

/**
 * Callable promise interface for awaiting persistence readiness (BOARD-1508).
 *
 * Can be awaited directly as a promise (`await adapter.whenLoaded`) or called as a method (`await adapter.whenLoaded()`).
 *
 * @public
 */
export interface WhenLoadedPromise extends Promise<void> {
  (): Promise<void>;
}

/**
 * Checks whether IndexedDB is available in the current runtime environment.
 *
 * @returns `true` if `indexedDB` global is defined; `false` in Node/SSR without polyfills.
 * @public
 */
export function isIndexedDbSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Determines whether IndexedDB persistence should be enabled based on environment and options.
 *
 * @param options - Option value from `YjsSyncOptions.indexeddb`.
 * @returns `true` if IndexedDB is supported and not explicitly disabled.
 * @public
 */
export function resolveIndexedDbEnabled(options?: boolean | YjsIndexedDbOptions): boolean {
  if (options === false) {
    return false;
  }
  return isIndexedDbSupported();
}

/**
 * Resolves the database name to use for IndexedDB persistence.
 *
 * @param options - Option value from `YjsSyncOptions.indexeddb`.
 * @returns Resolved database name.
 * @public
 */
export function resolveIndexedDbName(options?: boolean | YjsIndexedDbOptions): string {
  if (typeof options === 'object' && options?.name) {
    return options.name;
  }
  return 'kujam-yjs';
}

/**
 * Creates an IndexedDB persistence instance for a Y.Doc if supported and enabled.
 *
 * @param doc - Y.Doc to persist.
 * @param options - Persistence configuration options.
 * @returns `IndexeddbPersistence` instance, or `null` if disabled / unsupported.
 * @public
 */
export function createYjsPersistence(
  doc: Y.Doc,
  options?: boolean | YjsIndexedDbOptions,
): IndexeddbPersistence | null {
  if (!resolveIndexedDbEnabled(options)) {
    return null;
  }
  const name = resolveIndexedDbName(options);
  return new IndexeddbPersistence(name, doc);
}

/**
 * Creates a callable thenable for awaiting persistence and initial synchronization (BOARD-1508).
 *
 * @param getPersistence - Getter for the current persistence instance.
 * @param getSyncPromise - Getter for any active sync promise.
 * @returns WhenLoadedPromise instance.
 * @public
 */
export function createWhenLoaded(
  getPersistence: () => IndexeddbPersistence | null | undefined,
  getSyncPromise?: () => Promise<void> | null | undefined,
): WhenLoadedPromise {
  const promise = (async () => {
    const persistence = getPersistence();
    if (persistence) {
      await persistence.whenSynced.catch(() => {});
    }
    const syncPromise = getSyncPromise?.();
    if (syncPromise) {
      await syncPromise.catch(() => {});
    }
  })();

  const fn = (() => promise) as WhenLoadedPromise;
  fn.then = promise.then.bind(promise);
  fn.catch = promise.catch.bind(promise);
  fn.finally = promise.finally.bind(promise);
  return fn;
}
