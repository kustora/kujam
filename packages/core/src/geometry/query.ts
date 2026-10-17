/**
 * Whiteboard element search, filter, and hit-test module (`board.query`, `board.hitTest`,
 * BOARD-206, BOARD-404).
 *
 * @packageDocumentation
 */

import { containsPoint, type Geometry, type Point } from './geometry.js';
import { compareIndex } from '../document/indexing.js';
import type { Bounds, SpatialIndex } from './spatial.js';
import type { BoardDocument, ElementRecord } from '../types.js';

/**
 * Element search filter for `board.query` (BOARD-206).
 *
 * @public
 */
export interface QueryFilter {
  /** Filter by a specific element type (for example `'sticky'`, `'draw'`). */
  readonly type?: string;
  /** Filter by target page ID. `board.query` defaults to the current page (BOARD-208). */
  readonly pageId?: string;
  /** With `board.query`, search every page instead of the current one when `pageId` is omitted. */
  readonly allPages?: boolean;
  /** Filter by parent container ID (frame or group); use `null` for elements at the canvas root. */
  readonly parentId?: string | null;
  /** Spatial bounds filter (only intersecting elements are returned). */
  readonly inBounds?: Bounds;
}

/**
 * Runs an element query on the document with optional filters, using the spatial index.
 *
 * @internal
 */
export function queryElements<P = Record<string, unknown>>(
  doc: Readonly<BoardDocument>,
  spatialIndex: SpatialIndex,
  filter?: QueryFilter,
): readonly Readonly<ElementRecord<P>>[] {
  let candidates: ElementRecord[];

  if (filter?.inBounds !== undefined) {
    const ids = spatialIndex.search(filter.inBounds);
    candidates = [];
    for (const id of ids) {
      const rec = doc.records[id];
      if (rec && rec.kind === 'element') {
        candidates.push(rec);
      }
    }
  } else {
    candidates = [];
    for (const rec of Object.values(doc.records)) {
      if (rec.kind === 'element') {
        candidates.push(rec);
      }
    }
  }

  if (filter) {
    if (filter.type !== undefined) {
      candidates = candidates.filter((el) => el.type === filter.type);
    }
    if (filter.pageId !== undefined) {
      candidates = candidates.filter((el) => el.pageId === filter.pageId);
    }
    if (filter.parentId !== undefined) {
      candidates = candidates.filter((el) => el.parentId === filter.parentId);
    }
  }

  // Always sort deterministically from the bottom layer to the top (z-order)
  candidates.sort((a, b) => compareIndex(a.index, b.index));

  return Object.freeze(candidates as unknown as Readonly<ElementRecord<P>>[]);
}

/**
 * Options for `board.hitTest` (BOARD-404).
 *
 * @beta
 */
export interface HitTestOptions {
  /**
   * Extra hit distance around elements, in screen pixels. Converted to board units with the
   * current camera zoom. Defaults to 0.
   */
  readonly tolerance?: number;
  /** Only consider elements on this page. `board.hitTest` defaults to the current page (BOARD-208). */
  readonly pageId?: string;
  /** With `board.hitTest`, consider every page instead of the current one when `pageId` is omitted. */
  readonly allPages?: boolean;
  /** Also hit `locked` elements. Defaults to `false`, so locked elements are not picked by clicks. */
  readonly includeLocked?: boolean;
}

/**
 * Chain of layer indexes from the outermost ancestor down to the element. Comparing chains gives
 * the paint order: siblings by index, and every container below its own children.
 */
function paintKey(doc: Readonly<BoardDocument>, element: ElementRecord): string[] {
  const key = [element.index];
  const seen = new Set([element.id]);
  let parentId = element.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = doc.records[parentId];
    if (!parent || parent.kind !== 'element') break;
    seen.add(parentId);
    key.unshift(parent.index);
    parentId = parent.parentId;
  }
  return key;
}

function comparePaintKeys(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareIndex(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/**
 * Finds the topmost element whose geometry contains `point` (board coordinates), using the
 * spatial index for candidates. `tolerance` is already in board units.
 *
 * @internal
 */
export function hitTestElements(
  doc: Readonly<BoardDocument>,
  spatialIndex: SpatialIndex,
  getGeometry: (el: ElementRecord) => Geometry,
  point: Point,
  tolerance: number,
  options: HitTestOptions = {},
): Readonly<ElementRecord> | undefined {
  const ids = spatialIndex.search({
    minX: point.x - tolerance,
    minY: point.y - tolerance,
    maxX: point.x + tolerance,
    maxY: point.y + tolerance,
  });

  let best: { element: ElementRecord; key: string[] } | undefined;
  for (const id of ids) {
    const rec = doc.records[id];
    if (!rec || rec.kind !== 'element') continue;
    if (rec.locked && options.includeLocked !== true) continue;
    if (options.pageId !== undefined && rec.pageId !== options.pageId) continue;
    if (!containsPoint(getGeometry(rec), point, { element: rec, tolerance })) continue;
    const key = paintKey(doc, rec);
    // Equal keys (for example the first element on two pages) are broken by ID, so the result
    // never depends on the spatial index's internal order.
    const order = best ? comparePaintKeys(key, best.key) : 1;
    if (order > 0 || (order === 0 && rec.id > best!.element.id)) best = { element: rec, key };
  }
  return best?.element;
}
