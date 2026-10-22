/**
 * Plain-text export (BOARD-1704, BOARD-1212).
 *
 * Text of every element with `export.text` (sticky notes, text, shape and connector labels, frame
 * names, image alt text, and custom elements), ordered per container and then by reading position:
 * a frame's name is followed by its content, and siblings are read in rows from top to bottom,
 * left to right — the same order as the accessibility tree (BOARD-1901).
 */

import { sortReadingOrder, type Board, type ElementRecord } from '@kujam/core';
import { ExportError } from './errors.js';
import { buildScene, elementBounds } from './scene.js';

/**
 * Options for {@link exportText}.
 *
 * @beta
 */
export interface ExportTextOptions {
  /** Element IDs to export, with their descendants. When omitted, the whole page is exported. */
  readonly ids?: readonly string[];
  /** Exports one frame: its name and its content. Wins over `ids`. */
  readonly frameId?: string;
  /** Page to export; defaults to the current page (or the page of `ids` / `frameId`). */
  readonly pageId?: string;
  /** Text between two elements. Defaults to an empty line (`'\n\n'`). */
  readonly separator?: string;
}

/**
 * Exports the text content of the board (or a selection, or one frame) as plain text
 * (BOARD-1704), for summaries and search. Elements use their type's `export.text(el, data)`;
 * `data` is the element's external data when it is already loaded (BOARD-604). Empty texts are
 * skipped, and a failing exporter only loses its own element's text.
 *
 * @returns The text, or `''` when there is nothing to export.
 * @throws {@link ExportError} `frame-not-found` or `invalid-options`.
 * @beta
 */
export function exportText(board: Board, options: ExportTextOptions = {}): string {
  const separator = options.separator ?? '\n\n';
  if (typeof separator !== 'string') {
    throw new ExportError('invalid-options', 'Opsi separator wajib berupa string.');
  }
  let elements: readonly ElementRecord[];
  try {
    elements = buildScene(board, options, 0).elements;
  } catch (error) {
    if (error instanceof ExportError && error.code === 'nothing-to-export') return '';
    throw error;
  }
  const byId = new Map(elements.map((el) => [el.id, el]));
  const order = sortReadingOrder(
    elements.map((el) => ({ id: el.id, parentId: el.parentId, bounds: elementBounds(board, el) })),
  );
  const parts: string[] = [];
  for (const id of order) {
    const el = byId.get(id)!;
    const text = elementText(board, el);
    if (text.trim() !== '') parts.push(text.replace(/\r\n?/g, '\n').trim());
  }
  return parts.join(separator);
}

/** Text of one element from its `export.text`, or `''`. */
function elementText(board: Board, el: ElementRecord): string {
  const def = board.elements.get(el.type);
  const exporter = def?.export?.text;
  if (typeof exporter !== 'function') return '';
  let data: unknown;
  if (def?.resolve) {
    const state = board.getElementData(el.id, { load: false });
    data = state.status === 'ready' ? state.data : undefined;
  }
  try {
    const text = def!.export!.text!(el as never, data as never);
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}
