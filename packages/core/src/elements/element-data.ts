/**
 * Runtime of the `resolve` contract (BOARD-604): external data for custom elements.
 *
 * - An element's `resolve(el, ctx)` runs the first time its data is asked for
 *   (`board.getElementData`), usually when the renderer brings it into view.
 * - Calls to `ctx.resolvers[name](id)` go through a cache per `(name, id)` that also shares
 *   requests still in flight, and are recorded in a reverse index `(name, id) → element IDs`.
 * - `board.invalidate(name, id?)` drops cached values and resets only the elements that used them,
 *   announcing them in one `data` event; they resolve again when asked for.
 * - Element changes reset its data only when its props change, so moving or resizing never
 *   resolves again. Deleted elements are forgotten.
 */

import type { ChangeEvent } from '../document/store.js';
import type { ElementRecord } from '../types.js';
import type {
  AnyElementDefinition,
  ElementResolveContext,
  ResolveError,
  ResolveErrorStatus,
} from './elements.js';

/**
 * Data state of an element (BOARD-604). Elements without `resolve` are always `ready` with
 * `data: undefined`.
 *
 * @beta
 */
export type ElementDataState<D = unknown> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: D }
  | { readonly status: ResolveErrorStatus; readonly message?: string };

/**
 * Payload of the `data` event: elements whose data state changed (loaded, failed, or reset by
 * `invalidate`). Ask `board.getElementData` again to get the new state.
 *
 * @beta
 */
export interface ElementDataEvent {
  readonly ids: readonly string[];
}

const ERROR_STATUSES = new Set<unknown>(['forbidden', 'not-found', 'error']);

/**
 * Whether `value` is a {@link ResolveError}: an object with only `status` (one of the error
 * statuses) and optionally a string `message`. Data objects with other keys are never errors.
 *
 * @beta
 */
export function isResolveError(value: unknown): value is ResolveError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!ERROR_STATUSES.has(v.status)) return false;
  for (const key of Object.keys(v)) {
    if (key !== 'status' && key !== 'message') return false;
  }
  return v.message === undefined || typeof v.message === 'string';
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  (typeof v === 'object' || typeof v === 'function') &&
  v !== null &&
  typeof (v as { then?: unknown }).then === 'function';

const READY_EMPTY: ElementDataState = Object.freeze({ status: 'ready', data: undefined });
const LOADING: ElementDataState = Object.freeze({ status: 'loading' });

function errorState(error: unknown): ElementDataState {
  if (isResolveError(error)) {
    return Object.freeze(
      error.message === undefined
        ? { status: error.status }
        : { status: error.status, message: error.message },
    );
  }
  const message = error instanceof Error ? error.message : undefined;
  return Object.freeze(
    message ? { status: 'error' as const, message } : { status: 'error' as const },
  );
}

type CacheEntry = { readonly value: unknown } | { readonly promise: PromiseLike<unknown> };

export interface ElementDataRuntimeOptions {
  getElement(id: string): Readonly<ElementRecord> | undefined;
  getDefinition(type: string): AnyElementDefinition | undefined;
  readonly resolvers: Readonly<Record<string, (id: string) => unknown>>;
  /** Context fields other than `resolvers` (assets, asset lookup). */
  baseContext(): Omit<ElementResolveContext, 'resolvers'>;
  emit(event: ElementDataEvent): void;
  /** Reports an exception thrown by `resolve` or a resolver. */
  reportError(elementId: string, error: unknown): void;
}

export interface ElementDataRuntime {
  get(id: string, load?: boolean): ElementDataState;
  invalidate(resolver: string, id?: string): void;
  reload(elementId: string): void;
  observe(event: ChangeEvent): void;
  clear(): void;
}

const key = (resolver: string, id: string): string => `${resolver}\u0000${id}`;

export function createElementDataRuntime(options: ElementDataRuntimeOptions): ElementDataRuntime {
  const cache = new Map<string, CacheEntry>();
  const states = new Map<string, ElementDataState>();
  /** `(resolver, id)` key → elements whose last resolve used it. */
  const users = new Map<string, Set<string>>();
  /** Element → keys its last resolve used. */
  const uses = new Map<string, Set<string>>();
  /** Bumped when an element is reset, so late results of an older resolve are ignored. */
  const generation = new Map<string, number>();

  function forgetUses(elementId: string): void {
    const keys = uses.get(elementId);
    if (!keys) return;
    for (const k of keys) {
      const set = users.get(k);
      set?.delete(elementId);
      if (set && set.size === 0) users.delete(k);
    }
    uses.delete(elementId);
  }

  function reset(elementId: string): boolean {
    const had = states.delete(elementId);
    forgetUses(elementId);
    generation.set(elementId, (generation.get(elementId) ?? 0) + 1);
    return had;
  }

  /** Calls resolver `name` for `id` through the cache, sharing requests in flight. */
  function cachedCall(name: string, id: string): unknown {
    const k = key(name, id);
    const entry = cache.get(k);
    if (entry) return 'value' in entry ? entry.value : entry.promise;
    const fn = options.resolvers[name];
    if (typeof fn !== 'function') {
      throw new TypeError(`Resolver "${name}" tidak terdaftar.`);
    }
    const result = fn(id);
    if (!isThenable(result)) {
      cache.set(k, { value: result });
      return result;
    }
    // Only the entry this request created is settled (an invalidate may have dropped it).
    const owns = (): boolean => {
      const current = cache.get(k);
      return current !== undefined && 'promise' in current && current.promise === promise;
    };
    const promise: PromiseLike<unknown> = Promise.resolve(result).then(
      (value) => {
        if (owns()) cache.set(k, { value });
        return value;
      },
      (error: unknown) => {
        // Failures are not cached: the next request tries again.
        if (owns()) cache.delete(k);
        throw error;
      },
    );
    cache.set(k, { promise });
    return promise;
  }

  function trackingContext(elementId: string): ElementResolveContext {
    const used = new Set<string>();
    uses.set(elementId, used);
    const resolvers: Record<string, (id: string) => unknown> = {};
    for (const name of Object.keys(options.resolvers)) {
      resolvers[name] = (id: string) => {
        const k = key(name, String(id));
        used.add(k);
        let set = users.get(k);
        if (!set) users.set(k, (set = new Set()));
        set.add(elementId);
        return cachedCall(name, String(id));
      };
    }
    return Object.freeze({ ...options.baseContext(), resolvers: Object.freeze(resolvers) });
  }

  function settle(elementId: string, gen: number, state: ElementDataState): void {
    if ((generation.get(elementId) ?? 0) !== gen || !options.getElement(elementId)) return;
    states.set(elementId, state);
    options.emit(Object.freeze({ ids: Object.freeze([elementId]) }));
  }

  function get(id: string, load = true): ElementDataState {
    const existing = states.get(id);
    if (existing) return existing;
    const el = options.getElement(id);
    const def = el ? options.getDefinition(el.type) : undefined;
    if (!el || !def?.resolve) return READY_EMPTY;
    if (!load) return LOADING;

    forgetUses(id);
    const gen = generation.get(id) ?? 0;
    let result: unknown;
    try {
      result = def.resolve(el as never, trackingContext(id));
    } catch (error) {
      options.reportError(id, error);
      const state = errorState(error);
      states.set(id, state);
      return state;
    }
    if (!isThenable(result)) {
      const state = isResolveError(result)
        ? errorState(result)
        : Object.freeze({ status: 'ready' as const, data: result });
      states.set(id, state);
      return state;
    }
    states.set(id, LOADING);
    Promise.resolve(result).then(
      (value) =>
        settle(
          id,
          gen,
          isResolveError(value)
            ? errorState(value)
            : Object.freeze({ status: 'ready' as const, data: value }),
        ),
      (error: unknown) => {
        options.reportError(id, error);
        settle(id, gen, errorState(error));
      },
    );
    return LOADING;
  }

  function invalidate(resolver: string, id?: string): void {
    if (typeof resolver !== 'string' || resolver === '') {
      throw new TypeError('Nama resolver wajib berupa string tidak kosong.');
    }
    const keys: string[] = [];
    if (id === undefined) {
      const prefix = `${resolver}\u0000`;
      for (const k of new Set([...cache.keys(), ...users.keys()]))
        if (k.startsWith(prefix)) keys.push(k);
    } else keys.push(key(resolver, String(id)));

    const affected = new Set<string>();
    for (const k of keys) {
      cache.delete(k);
      for (const elementId of users.get(k) ?? []) affected.add(elementId);
    }
    const ids = [...affected].filter((elementId) => reset(elementId));
    if (ids.length > 0) options.emit(Object.freeze({ ids: Object.freeze(ids) }));
  }

  /** Drops the cached values `elementId` used and resets every element that shares them. */
  function reload(elementId: string): void {
    const keys = [...(uses.get(elementId) ?? [])];
    const affected = new Set<string>([elementId]);
    for (const k of keys) {
      cache.delete(k);
      for (const other of users.get(k) ?? []) affected.add(other);
    }
    const ids = [...affected].filter((id) => reset(id));
    if (ids.length > 0) options.emit(Object.freeze({ ids: Object.freeze(ids) }));
  }

  function observe(event: ChangeEvent): void {
    for (const { before, after } of Object.values(event.updated)) {
      if (after.kind !== 'element' || before.kind !== 'element') continue;
      if (!states.has(after.id) && !uses.has(after.id)) continue;
      if (before.type !== after.type || !sameProps(before.props, after.props)) reset(after.id);
    }
    for (const rec of Object.values(event.removed)) {
      if (rec.kind !== 'element') continue;
      reset(rec.id);
      generation.delete(rec.id);
    }
  }

  function clear(): void {
    cache.clear();
    states.clear();
    users.clear();
    uses.clear();
    generation.clear();
  }

  return { get, invalidate, reload, observe, clear };
}

function sameProps(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
