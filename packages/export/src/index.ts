/**
 * `@kujam/export` — Utilitas ekspor dokumen papan ke JSON, PNG, SVG, PDF, dan teks polos.
 *
 * @packageDocumentation
 */

import type { Board, BoardDocument } from '@kujam/core';

/**
 * Mengekspor dokumen papan sebagai objek JSON terkloning.
 *
 * @public
 */
export function exportJSON(board: Board): BoardDocument {
  return JSON.parse(JSON.stringify(board.getDocument())) as BoardDocument;
}
