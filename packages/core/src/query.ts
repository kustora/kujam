/**
 * Modul pencarian dan filter elemen papan tulis (`board.query`, BOARD-206).
 *
 * @packageDocumentation
 */

import { compareIndex } from './indexing.js';
import type { Bounds, SpatialIndex } from './spatial.js';
import type { BoardDocument, ElementRecord } from './types.js';

/**
 * Filter pencarian elemen untuk `board.query` (BOARD-206).
 *
 * @public
 */
export interface QueryFilter {
  /** Filter berdasarkan tipe elemen tertentu (misalnya `'sticky'`, `'draw'`). */
  readonly type?: string;
  /** Filter berdasarkan ID halaman target. */
  readonly pageId?: string;
  /** Filter berdasarkan ID kontainer induk (frame atau grup); gunakan `null` untuk elemen di root kanvas. */
  readonly parentId?: string | null;
  /** Filter batas kotak koordinat spasial (hanya elemen yang bersinggungan yang dikembalikan). */
  readonly inBounds?: Bounds;
}

/**
 * Menjalankan kueri elemen pada dokumen dengan filter opsional dan memanfaatkan indeks spasial.
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

  // Urutkan selalu deterministik dari lapisan terbawah ke teratas (z-order)
  candidates.sort((a, b) => compareIndex(a.index, b.index));

  return Object.freeze(candidates as unknown as Readonly<ElementRecord<P>>[]);
}
