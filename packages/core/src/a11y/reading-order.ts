/**
 * Reading order and keyboard navigation for the parallel accessibility tree (BOARD-1901,
 * BOARD-1902).
 *
 * Core stays DOM-free: it decides the order elements are read and navigated in, and the renderer
 * builds the hidden DOM from it. Order is per container first (a frame or group is followed by
 * its children), then by reading position: rows from top to bottom, and left to right in a row.
 */

import type { Board } from '../index.js';
import type { BoxBounds } from '../geometry/spatial.js';
import type { ElementRecord } from '../types.js';

/**
 * Input of {@link sortReadingOrder}: an element's ID, its container, and its board bounds.
 *
 * @beta
 */
export interface ReadingOrderItem {
  readonly id: string;
  /** Container (frame or group) ID, or `null` for a top-level element. */
  readonly parentId: string | null;
  /** Axis-aligned bounds in board coordinates. */
  readonly bounds: BoxBounds;
}

/**
 * Reading order of the current page (see {@link getReadingOrder}).
 *
 * @beta
 */
export interface ReadingOrder {
  /** Element IDs of the current page in reading order. Frozen. */
  readonly ids: readonly string[];
  /** Position of `id` in {@link ReadingOrder.ids}, or `-1` when it is not on the current page. */
  indexOf(id: string): number;
}

/** Top-to-bottom, then left-to-right comparison of two items' top-left corners. */
function byTopLeft(a: ReadingOrderItem, b: ReadingOrderItem): number {
  return (
    a.bounds.minY - b.bounds.minY ||
    a.bounds.minX - b.bounds.minX ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function byLeft(a: ReadingOrderItem, b: ReadingOrderItem): number {
  return a.bounds.minX - b.bounds.minX || byTopLeft(a, b);
}

/**
 * Sorts siblings into rows: an item joins the current row when its top edge is above the vertical
 * center of the row's first item, so elements laid out side by side with slightly different tops
 * are read left to right.
 */
function sortRows(items: ReadingOrderItem[]): ReadingOrderItem[] {
  items.sort(byTopLeft);
  const out: ReadingOrderItem[] = [];
  let i = 0;
  while (i < items.length) {
    const first = items[i]!;
    const limit = (first.bounds.minY + first.bounds.maxY) / 2;
    let j = i + 1;
    while (j < items.length && items[j]!.bounds.minY <= limit) j++;
    const row = items.slice(i, j).sort(byLeft);
    for (const item of row) out.push(item);
    i = j;
  }
  return out;
}

/**
 * Sorts elements into reading order (BOARD-1901): containers first, each followed by its own
 * children, and siblings in rows from top to bottom, left to right within a row. An item whose
 * `parentId` is not in `items` counts as top-level. Deterministic for equal positions (by ID).
 *
 * Runs in O(n log n).
 *
 * @returns Element IDs in reading order.
 * @beta
 */
export function sortReadingOrder(items: readonly ReadingOrderItem[]): string[] {
  const present = new Set(items.map((item) => item.id));
  const byParent = new Map<string | null, ReadingOrderItem[]>();
  for (const item of items) {
    const key = item.parentId !== null && present.has(item.parentId) ? item.parentId : null;
    const group = byParent.get(key);
    if (group) group.push(item);
    else byParent.set(key, [item]);
  }

  const out: string[] = [];
  const visited = new Set<string>();
  // Iterative depth-first walk, so deeply nested containers cannot overflow the stack.
  const stack: ReadingOrderItem[] = [...sortRows(byParent.get(null) ?? [])].reverse();
  const drain = (): void => {
    while (stack.length > 0) {
      const item = stack.pop()!;
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      out.push(item.id);
      const children = byParent.get(item.id);
      if (children) {
        for (const child of sortRows(children).reverse()) stack.push(child);
      }
    }
  };
  drain();
  if (visited.size < present.size) {
    // Items in a parent cycle are never reached from the top level: read them last.
    const rest = items.filter((item) => !visited.has(item.id));
    for (const item of sortRows(rest).reverse()) stack.push(item);
    drain();
  }
  return out;
}

function elementBounds(board: Board, el: Readonly<ElementRecord>): BoxBounds {
  const indexed = board.spatial.getBounds(el.id);
  if (indexed) return indexed;
  return { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h };
}

const GEOMETRY_FIELDS = ['x', 'y', 'w', 'h', 'rotation', 'parentId'] as const;

/** Whether an element kept its reading position: same record, or only props changed. */
function samePosition(a: Readonly<ElementRecord>, b: Readonly<ElementRecord>): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  // Props-only updates (text, color) keep the order; geometry from props, such as stroke
  // points, also changes the element box.
  for (const field of GEOMETRY_FIELDS) if (a[field] !== b[field]) return false;
  return true;
}

interface OrderCache {
  readonly document: unknown;
  readonly pageId: string;
  /** Element records the order was computed from, in `board.query()` order. */
  readonly elements: readonly Readonly<ElementRecord>[];
  readonly order: ReadingOrder;
}

/** Last order per board. No board listeners: validity is checked against the snapshot. */
const caches = new WeakMap<Board, OrderCache>();

function computeOrder(board: Board, elements: readonly Readonly<ElementRecord>[]): ReadingOrder {
  const items = elements.map((el) => ({
    id: el.id,
    parentId: el.parentId,
    bounds: elementBounds(board, el),
  }));
  const ids = Object.freeze(sortReadingOrder(items));
  const positions = new Map<string, number>();
  ids.forEach((id, i) => positions.set(id, i));
  return Object.freeze({ ids, indexOf: (id: string) => positions.get(id) ?? -1 });
}

/**
 * Reading order of the board's current page (BOARD-1901), as sorted by {@link sortReadingOrder}
 * from the elements' spatial bounds.
 *
 * Cached per board without listening to it: the same object is returned while the document
 * snapshot and current page are unchanged. After a change, an O(n) check reuses the order when no
 * element was added, removed, moved, resized, rotated, or re-parented (text edits keep it), and
 * only otherwise sorts again in O(n log n).
 *
 * @throws `Error` when the board is disposed.
 * @beta
 */
export function getReadingOrder(board: Board): ReadingOrder {
  if (board.disposed) throw new Error('Papan sudah di-dispose.');
  const document = board.getDocument();
  const pageId = board.pages.current;
  const cache = caches.get(board);
  if (cache && cache.document === document && cache.pageId === pageId) return cache.order;

  const elements = board.query();
  let order: ReadingOrder | undefined;
  if (cache && cache.pageId === pageId && cache.elements.length === elements.length) {
    const unchanged = elements.every((el, i) => samePosition(el, cache.elements[i]!));
    if (unchanged) order = cache.order;
  }
  order ??= computeOrder(board, elements);
  caches.set(board, { document, pageId, elements, order });
  return order;
}

/**
 * Direction for {@link nextInReadingOrder}.
 *
 * @beta
 */
export type ReadingDirection = 'next' | 'previous';

/**
 * The element after (or before) `fromId` in the reading order of the current page (BOARD-1902).
 * With `fromId` `null` or not on the current page, `'next'` returns the first element and
 * `'previous'` returns `undefined`, so Shift+Tab can leave the board.
 *
 * @returns An element ID, or `undefined` at either end of the order.
 * @beta
 */
export function nextInReadingOrder(
  board: Board,
  fromId: string | null,
  direction: ReadingDirection = 'next',
): string | undefined {
  const order = getReadingOrder(board);
  const index = fromId === null ? -1 : order.indexOf(fromId);
  if (index < 0) return direction === 'next' ? order.ids[0] : undefined;
  return order.ids[direction === 'next' ? index + 1 : index - 1];
}

/**
 * Options for {@link revealBounds}.
 *
 * @beta
 */
export interface RevealOptions {
  /** Free space kept between the bounds and the viewport edge, in screen pixels. Defaults to 48. */
  readonly padding?: number;
}

/** Default padding of {@link revealBounds}, in screen pixels. */
const REVEAL_PADDING = 48;

/**
 * Camera shift along one axis that brings `[min, max]` into the visible `[start, end]`, kept
 * `pad` away from the edges. Nothing moves while the span is already fully visible.
 */
function shift(min: number, max: number, start: number, end: number, pad: number): number {
  if (min >= start && max <= end) return 0;
  const lo = start + pad;
  const hi = end - pad;
  // Larger than the padded span: center it.
  if (max - min > hi - lo) return (min + max) / 2 - (lo + hi) / 2;
  if (min < lo) return min - lo;
  if (max > hi) return max - hi;
  return 0;
}

/**
 * Pans the camera by the smallest amount that brings `bounds` (board coordinates) into the
 * viewport with `padding` around it, so the camera follows keyboard focus (BOARD-1902). Each axis
 * only moves when the bounds are not fully visible on it, and bounds larger than the viewport are
 * centered. The zoom never changes, and the camera jumps without
 * animation.
 *
 * @returns `true` when the camera moved; `false` when the bounds were already visible or the
 *   viewport size is not reported yet.
 * @beta
 */
export function revealBounds(
  board: Board,
  bounds: BoxBounds,
  options: RevealOptions = {},
): boolean {
  const { width, height } = board.camera.viewport;
  if (width <= 0 || height <= 0) return false;
  const camera = board.camera.get();
  const view = board.camera.getViewportBounds();
  const requested = options.padding ?? REVEAL_PADDING;
  const pixels = Number.isFinite(requested) && requested > 0 ? requested : 0;
  // Never pad more than a quarter of the viewport, so small views still fit the bounds.
  const padX = Math.min(pixels, width / 4) / camera.zoom;
  const padY = Math.min(pixels, height / 4) / camera.zoom;
  const dx = shift(bounds.minX, bounds.maxX, view.minX, view.maxX, padX);
  const dy = shift(bounds.minY, bounds.maxY, view.minY, view.maxY, padY);
  if (dx === 0 && dy === 0) return false;
  board.camera.set({ x: camera.x + dx, y: camera.y + dy });
  return true;
}
