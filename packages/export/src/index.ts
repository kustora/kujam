/**
 * `@kujam/export` — Utilities for exporting board documents to JSON, PNG, SVG, PDF, and plain text.
 *
 * @packageDocumentation
 */

import { deepClone, type Board, type BoardDocument } from '@kujam/core';

/**
 * Exports a board document as a cloned JSON object.
 *
 * @public
 */
export function exportJSON(board: Board): BoardDocument {
  return deepClone(board.getDocument()) as BoardDocument;
}
