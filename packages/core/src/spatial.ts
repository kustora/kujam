/**
 * R-tree (rbush) spatial index module for element area queries (BOARD-404, BOARD-206).
 *
 * @packageDocumentation
 */

import RBush from 'rbush';
import { geometryBounds, resolveElementGeometry, type Geometry } from './geometry.js';
import type { ElementRecord } from './types.js';

/**
 * Axis-aligned box bounds in min/max coordinate format.
 *
 * @public
 */
export interface BoxBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Axis-aligned box bounds in position-and-size format (x, y, w, h).
 *
 * @public
 */
export interface RectBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Spatial query box bounds; supports either the BoxBounds or RectBounds format.
 *
 * @public
 */
export type Bounds = BoxBounds | RectBounds;

/**
 * Internal entry in the R-tree index.
 *
 * @internal
 */
export interface SpatialItem extends BoxBounds {
  readonly id: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Checks whether an object is in {@link BoxBounds} format.
 *
 * @public
 */
export function isBoxBounds(bounds: unknown): bounds is BoxBounds {
  if (typeof bounds !== 'object' || bounds === null) return false;
  const b = bounds as Record<string, unknown>;
  return (
    isFiniteNumber(b.minX) &&
    isFiniteNumber(b.minY) &&
    isFiniteNumber(b.maxX) &&
    isFiniteNumber(b.maxY)
  );
}

/**
 * Checks whether an object is in {@link RectBounds} format.
 *
 * @public
 */
export function isRectBounds(bounds: unknown): bounds is RectBounds {
  if (typeof bounds !== 'object' || bounds === null) return false;
  const b = bounds as Record<string, unknown>;
  return isFiniteNumber(b.x) && isFiniteNumber(b.y) && isFiniteNumber(b.w) && isFiniteNumber(b.h);
}

/**
 * Smallest box enclosing every given box, skipping `undefined` entries. Frozen; `null` when there
 * is none.
 *
 * @internal
 */
export function unionBounds(boxes: Iterable<BoxBounds | undefined>): Readonly<BoxBounds> | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return minX === Infinity ? null : Object.freeze({ minX, minY, maxX, maxY });
}

/**
 * Normalizes input {@link Bounds} into valid {@link BoxBounds} (`minX <= maxX` and `minY <= maxY`).
 *
 * @throws `TypeError` when the argument is in neither `BoxBounds` nor `RectBounds` format.
 * @public
 */
export function normalizeBounds(bounds: Bounds): BoxBounds {
  if (isBoxBounds(bounds)) {
    return {
      minX: Math.min(bounds.minX, bounds.maxX),
      minY: Math.min(bounds.minY, bounds.maxY),
      maxX: Math.max(bounds.minX, bounds.maxX),
      maxY: Math.max(bounds.minY, bounds.maxY),
    };
  }
  if (isRectBounds(bounds)) {
    return {
      minX: Math.min(bounds.x, bounds.x + bounds.w),
      minY: Math.min(bounds.y, bounds.y + bounds.h),
      maxX: Math.max(bounds.x, bounds.x + bounds.w),
      maxY: Math.max(bounds.y, bounds.y + bounds.h),
    };
  }
  throw new TypeError(
    'Bounds harus berupa objek { minX, minY, maxX, maxY } atau { x, y, w, h } dengan angka berhingga.',
  );
}

/**
 * Computes an element's AABB (axis-aligned bounding box) in global board coordinates,
 * accounting for its base size, local geometry (when present), and rotation (BOARD-404).
 *
 * @public
 */
export function computeElementAABB(
  element: ElementRecord,
  getGeometry?: (el: ElementRecord) => Geometry | undefined,
): BoxBounds {
  return geometryBounds(
    resolveElementGeometry(element, getGeometry && (() => getGeometry(element))),
    element,
  );
}

/**
 * Whiteboard spatial index interface for fast element lookups (BOARD-404, BOARD-206).
 *
 * @public
 */
export interface SpatialIndex {
  /** Inserts an element into the spatial index. */
  insert(element: ElementRecord): void;
  /** Updates an element in the spatial index when its position/bounds change. */
  update(element: ElementRecord): void;
  /** Removes an element from the spatial index by ID. */
  remove(id: string): void;
  /** Finds the IDs of all elements intersecting the `bounds` coordinates. */
  search(bounds: Bounds): readonly string[];
  /** Clears the entire spatial index. */
  clear(): void;
  /** Loads a set of elements into the index at once (bulk load). */
  load(elements: Iterable<ElementRecord>): void;
  /** Number of elements registered in the index. */
  size(): number;
  /** Gets an element's AABB bounds by ID, or `undefined` when absent. */
  getBounds(id: string): BoxBounds | undefined;
}

/**
 * Creates a new {@link SpatialIndex} backed by an R-tree (`rbush`).
 *
 * @param getGeometry - Optional callback that extracts custom geometry per element.
 * @public
 */
export function createSpatialIndex(
  getGeometry?: (el: ElementRecord) => Geometry | undefined,
): SpatialIndex {
  const tree = new RBush<SpatialItem>();
  const itemsById = new Map<string, SpatialItem>();

  function makeItem(el: ElementRecord): SpatialItem {
    const aabb = computeElementAABB(el, getGeometry);
    return { ...aabb, id: el.id };
  }

  return {
    insert(element: ElementRecord): void {
      if (itemsById.has(element.id)) {
        this.update(element);
        return;
      }
      const item = makeItem(element);
      itemsById.set(element.id, item);
      tree.insert(item);
    },
    update(element: ElementRecord): void {
      const oldItem = itemsById.get(element.id);
      const newItem = makeItem(element);

      if (
        oldItem &&
        oldItem.minX === newItem.minX &&
        oldItem.minY === newItem.minY &&
        oldItem.maxX === newItem.maxX &&
        oldItem.maxY === newItem.maxY
      ) {
        return;
      }

      if (oldItem) {
        tree.remove(oldItem);
      }
      itemsById.set(element.id, newItem);
      tree.insert(newItem);
    },
    remove(id: string): void {
      const item = itemsById.get(id);
      if (item) {
        tree.remove(item);
        itemsById.delete(id);
      }
    },
    search(bounds: Bounds): readonly string[] {
      const norm = normalizeBounds(bounds);
      const hits = tree.search(norm);
      return hits.map((h) => h.id);
    },
    clear(): void {
      tree.clear();
      itemsById.clear();
    },
    load(elements: Iterable<ElementRecord>): void {
      const items: SpatialItem[] = [];
      for (const el of elements) {
        if (el.kind === 'element') {
          const item = makeItem(el);
          itemsById.set(el.id, item);
          items.push(item);
        }
      }
      tree.load(items);
    },
    size(): number {
      return itemsById.size;
    },
    getBounds(id: string): BoxBounds | undefined {
      const item = itemsById.get(id);
      if (!item) return undefined;
      return {
        minX: item.minX,
        minY: item.minY,
        maxX: item.maxX,
        maxY: item.maxY,
      };
    },
  };
}
