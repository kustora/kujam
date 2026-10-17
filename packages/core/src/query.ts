/**
 * Whiteboard element search and filter module (`board.query`, BOARD-206).
 *
 * @packageDocumentation
 */

import { compareIndex } from './indexing.js';
import type { Bounds, SpatialIndex } from './spatial.js';
import type { BoardDocument, ElementRecord } from './types.js';

/**
 * Element search filter for `board.query` (BOARD-206).
 *
 * @public
 */
export interface QueryFilter {
  /** Filter by a specific element type (for example `'sticky'`, `'draw'`). */
  readonly type?: string;
  /** Filter by target page ID. */
  readonly pageId?: string;
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
