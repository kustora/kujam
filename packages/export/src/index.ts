/**
 * `@kujam/export` — Utilitas ekspor dokumen papan ke JSON, PNG, SVG, PDF, dan teks polos.
 *
 * @packageDocumentation
 */

import { deepClone, type Board, type BoardDocument } from '@kujam/core';

/**
 * Mengekspor dokumen papan sebagai objek JSON terkloning.
 *
 * @public
 */
export function exportJSON(board: Board): BoardDocument {
  return deepClone(board.getDocument()) as BoardDocument;
}
