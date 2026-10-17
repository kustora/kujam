/**
 * Local selection state (BOARD-405).
 *
 * The selection is per-board UI state: it is not part of the document, is never saved, and never
 * enters undo history. It always holds IDs of existing elements only: selecting unknown IDs is
 * ignored, and elements deleted by any origin (local, remote, undo, load) drop out automatically.
 */

import type { SelectionEvent } from '../events/events.js';
import { unionBounds, type BoxBounds } from '../geometry/spatial.js';
import type { ChangeEvent } from '../document/store.js';

/**
 * IDs accepted by the selection API: a single ID or a list of IDs.
 *
 * @beta
 */
export type SelectionInput = string | readonly string[];

/** @internal */
export interface SelectionOptions {
  /** Whether `id` is a selectable element: it exists and is on the current page. */
  isElement(id: string): boolean;
  /** Rotation-aware AABB of an element, or `undefined` when unknown. */
  getBounds(id: string): BoxBounds | undefined;
  /** Called after every actual change. */
  onChange(event: SelectionEvent): void;
}

/** @internal */
export interface SelectionRuntime {
  readonly ids: readonly string[];
  readonly bounds: Readonly<BoxBounds> | null;
  select(ids: SelectionInput): void;
  add(ids: SelectionInput): void;
  remove(ids: SelectionInput): void;
  clear(): void;
  /** Drops IDs that are no longer elements after a document change. */
  observe(event: ChangeEvent): void;
}

const EMPTY: readonly string[] = Object.freeze([]);

function toList(ids: SelectionInput, method: string): readonly string[] {
  if (typeof ids === 'string') return [ids];
  if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) return ids;
  throw new TypeError(`Argumen ${method} wajib berupa ID string atau array ID string.`);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** @internal */
export function createSelection(options: SelectionOptions): SelectionRuntime {
  let ids = EMPTY;

  function commit(next: string[]): void {
    if (sameList(next, ids)) return;
    const previous = ids;
    ids = next.length === 0 ? EMPTY : Object.freeze(next);
    options.onChange(Object.freeze({ ids, previous }));
  }

  /** Existing element IDs from `list`, deduplicated, in first-seen order. */
  function existing(list: readonly string[], skip: ReadonlySet<string> = new Set()): string[] {
    const seen = new Set(skip);
    const out: string[] = [];
    for (const id of list) {
      if (seen.has(id) || !options.isElement(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  return {
    get ids() {
      return ids;
    },
    get bounds() {
      return unionBounds(ids.map((id) => options.getBounds(id)));
    },
    select(input) {
      commit(existing(toList(input, 'select')));
    },
    add(input) {
      const list = toList(input, 'addToSelection');
      commit([...ids, ...existing(list, new Set(ids))]);
    },
    remove(input) {
      const drop = new Set(toList(input, 'removeFromSelection'));
      commit(ids.filter((id) => !drop.has(id)));
    },
    clear() {
      commit([]);
    },
    observe(event) {
      if (ids.length === 0) return;
      if (event.origin === 'load') {
        commit(ids.filter((id) => options.isElement(id)));
        return;
      }
      commit(
        ids.filter((id) => {
          // `Object.hasOwn`, not `in`: IDs such as `toString` must not match prototype keys.
          if (Object.hasOwn(event.removed, id)) return false;
          // Updated records may have stopped being elements or moved to another page.
          return !Object.hasOwn(event.updated, id) || options.isElement(id);
        }),
      );
    },
  };
}
