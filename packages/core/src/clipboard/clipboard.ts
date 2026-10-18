/**
 * Board content for copy, cut, and paste (BOARD-906).
 *
 * Core has no DOM, so it only builds and reads clipboard payloads; the renderer moves them through
 * the system clipboard. A payload carries two formats:
 *
 * - board JSON: a {@link BoardDocument} subset inside a small envelope, so a paste can tell it
 *   apart from any other JSON;
 * - plain text: the `export.text` of every copied element, for pasting outside the board.
 *
 * Pasting always creates new IDs on the current page, remaps parents and bindings, and keeps
 * records of types the target board does not know as-is (BOARD-209).
 */

import { deepClone } from '../utils/clone.js';
import { compareIndex, indicesBetween } from '../document/indexing.js';
import { computeElementAABB } from '../geometry/spatial.js';
import type {
  AssetRecord,
  BindingRecord,
  BoardDocument,
  BoardRecord,
  ElementRecord,
} from '../types.js';
import type { Point } from '../geometry/geometry.js';
import type { DocumentTooNewReason } from '../document/migrations.js';
import type { Board } from '../index.js';

/**
 * Custom MIME type of the board JSON format on the system clipboard (BOARD-906).
 *
 * @public
 */
export const CLIPBOARD_MIME_TYPE = 'application/x-kujam+json';

/** Envelope marker of board JSON on the clipboard. */
const ENVELOPE_KIND = 'kujam/clipboard';

/** Envelope version; bump when the envelope shape changes. */
const ENVELOPE_VERSION = 1;

/**
 * Board content as written to the clipboard (BOARD-906).
 *
 * @public
 */
export interface ClipboardPayload {
  /** Board JSON envelope, for {@link CLIPBOARD_MIME_TYPE} and as text fallback. */
  readonly json: string;
  /** Plain text of the copied elements from `export.text`, one element per line. */
  readonly text: string;
  /** IDs of the copied elements (the requested ones and their descendants). */
  readonly ids: readonly string[];
}

/**
 * Options for {@link insertContent}.
 *
 * @public
 */
export interface InsertContentOptions {
  /** Board point where the center of the content is placed. When omitted, coordinates are kept. */
  readonly at?: Point;
  /** History label of the transaction. Defaults to `'paste'`. */
  readonly label?: string;
}

/**
 * Result of {@link insertContent}.
 *
 * @public
 */
export interface InsertContentResult {
  /** IDs of the new elements, in layer order. */
  readonly ids: readonly string[];
  /** IDs of the new elements without a parent among the pasted ones, in layer order. */
  readonly rootIds: readonly string[];
  /** Map from record IDs in the content to the new record IDs (assets keep their IDs). */
  readonly idMap: ReadonlyMap<string, string>;
  /** Records left out because they are invalid (BOARD-210), with the reasons. */
  readonly rejected: readonly { readonly id: string; readonly errors: readonly string[] }[];
}

/**
 * Codes for {@link ContentError}.
 *
 * - `read-only`: the board is read-only.
 * - `document-too-new`: the content was written by a newer version than this board understands.
 * - `limit-exceeded`: the paste would exceed `board.limits.maxElements`.
 * - `forbidden`: a permission hook rejected creating one of the elements (BOARD-212).
 *
 * @public
 */
export type ContentErrorCode = 'read-only' | 'document-too-new' | 'limit-exceeded' | 'forbidden';

/**
 * Error thrown when content cannot be inserted. The board is left unchanged.
 *
 * @public
 */
export class ContentError extends Error {
  readonly code: ContentErrorCode;
  /** For `document-too-new`: which version is too new. */
  readonly reason: DocumentTooNewReason | undefined;

  constructor(code: ContentErrorCode, message: string, reason?: DocumentTooNewReason) {
    super(message);
    this.name = 'ContentError';
    this.code = code;
    this.reason = reason;
  }
}

function isElement(rec: BoardRecord | undefined): rec is ElementRecord {
  return rec?.kind === 'element';
}

/** Collects every string inside `value` (props of any shape), to find referenced asset IDs. */
function collectStrings(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 32) return;
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out, depth + 1);
  else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out, depth + 1);
  }
}

/**
 * Builds a document with only the elements in `ids` and everything they need (BOARD-906,
 * BOARD-1701): their descendants (frame and group children), the bindings between them, the pages
 * they are on, and the assets their props refer to. Unknown IDs are ignored; an element whose
 * parent is left out becomes a root element. The result is a copy.
 *
 * @throws `TypeError` when `ids` is not an array of strings.
 * @public
 */
export function extractContent(board: Board, ids: readonly string[]): BoardDocument {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new TypeError('Argumen ids wajib berupa array ID string.');
  }
  const doc = board.getDocument();

  const children = new Map<string, string[]>();
  for (const rec of Object.values(doc.records)) {
    if (isElement(rec) && rec.parentId !== null) {
      const list = children.get(rec.parentId) ?? [];
      list.push(rec.id);
      children.set(rec.parentId, list);
    }
  }

  const included = new Set<string>();
  const queue = ids.filter((id) => Object.hasOwn(doc.records, id) && isElement(doc.records[id]));
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (included.has(id)) continue;
    included.add(id);
    queue.push(...(children.get(id) ?? []));
  }

  const records: Record<string, BoardRecord> = {};
  const referenced = new Set<string>();
  for (const id of included) {
    const el = doc.records[id] as ElementRecord;
    // A parent that is not included would dangle; the element becomes a root element.
    records[id] =
      el.parentId !== null && !included.has(el.parentId) ? { ...el, parentId: null } : el;
    referenced.add(el.pageId);
    collectStrings(el.props, referenced);
  }
  for (const rec of Object.values(doc.records)) {
    if (rec.kind === 'binding' && included.has(rec.fromId) && included.has(rec.toId)) {
      records[rec.id] = rec;
    } else if ((rec.kind === 'page' || rec.kind === 'asset') && referenced.has(rec.id)) {
      records[rec.id] = rec;
    }
  }
  return deepClone({ ...doc, records }) as BoardDocument;
}

/**
 * Inserts content (for example from {@link extractContent} or {@link parseClipboard}) into the
 * current page like a paste (BOARD-906):
 *
 * - the content goes through {@link Board.prepareDocument} (validation, limits, migrations);
 *   invalid records are left out and listed in the result;
 * - every element and binding gets a new ID, parents and bindings are remapped;
 * - elements go above the top element of the current page, keeping their relative order;
 * - elements of types this board does not know are kept as-is (BOARD-209);
 * - assets keep their IDs, since props refer to them, and are only added when missing.
 *
 * Everything is written in one local transaction (one undo step).
 *
 * @throws {@link ContentError} when the board is read-only, the content is too new, the element
 *   limit would be exceeded, or a permission hook rejects it; `InvalidDocumentError` for
 *   document-level problems; `MigrationError` when a migration fails; `TypeError` for an invalid
 *   `options.at`. The board is unchanged when anything throws.
 * @public
 */
export function insertContent(
  board: Board,
  content: BoardDocument,
  options: InsertContentOptions = {},
): InsertContentResult {
  const { at } = options;
  if (
    at !== undefined &&
    (typeof at !== 'object' || !Number.isFinite(at?.x) || !Number.isFinite(at?.y))
  ) {
    throw new TypeError('Opsi at wajib berupa titik { x, y } dengan angka berhingga.');
  }
  if (board.readOnly) {
    throw new ContentError('read-only', 'Papan dalam mode baca saja; tempel ditolak.');
  }

  const prepared = board.prepareDocument(content);
  if (prepared.tooNew) {
    throw new ContentError(
      'document-too-new',
      'Isi berasal dari versi yang lebih baru dari papan ini; tempel ditolak.',
      prepared.tooNew,
    );
  }

  const incoming = Object.values(prepared.document.records);
  const sourceElements = incoming
    .filter(isElement)
    .sort((a, b) => compareIndex(a.index, b.index) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sourceBindings = incoming.filter((r): r is BindingRecord => r.kind === 'binding');
  const sourceAssets = incoming.filter((r): r is AssetRecord => r.kind === 'asset');

  const current = board.getDocument();
  const existingElements = Object.values(current.records).filter(isElement);
  if (existingElements.length + sourceElements.length > board.limits.maxElements) {
    throw new ContentError(
      'limit-exceeded',
      `Tempel ${sourceElements.length} elemen melebihi batas maksimum (${board.limits.maxElements}).`,
    );
  }

  const idMap = new Map<string, string>();
  for (const rec of [...sourceElements, ...sourceBindings]) idMap.set(rec.id, board.createId());
  for (const asset of sourceAssets) idMap.set(asset.id, asset.id);

  const targetPage = board.pages.current;
  let top: string | null = null;
  for (const el of existingElements) {
    if (el.pageId === targetPage && (top === null || compareIndex(el.index, top) > 0)) {
      top = el.index;
    }
  }
  const indexes = indicesBetween(top, null, sourceElements.length);

  let dx = 0;
  let dy = 0;
  if (at !== undefined && sourceElements.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of sourceElements) {
      const box = computeElementAABB(el);
      minX = Math.min(minX, box.minX);
      minY = Math.min(minY, box.minY);
      maxX = Math.max(maxX, box.maxX);
      maxY = Math.max(maxY, box.maxY);
    }
    dx = at.x - (minX + maxX) / 2;
    dy = at.y - (minY + maxY) / 2;
  }

  const elements: ElementRecord[] = sourceElements.map((el, i) => ({
    ...el,
    id: idMap.get(el.id)!,
    pageId: targetPage,
    parentId: el.parentId !== null && idMap.has(el.parentId) ? idMap.get(el.parentId)! : null,
    index: indexes[i]!,
    x: el.x + dx,
    y: el.y + dy,
  }));
  const bindings: BindingRecord[] = sourceBindings
    .filter((b) => idMap.has(b.fromId) && idMap.has(b.toId))
    .map((b) => ({
      ...b,
      id: idMap.get(b.id)!,
      fromId: idMap.get(b.fromId)!,
      toId: idMap.get(b.toId)!,
    }));
  const assets = sourceAssets.filter((a) => !Object.hasOwn(current.records, a.id));

  for (const el of elements) {
    if (!board.can('create', el)) {
      throw new ContentError(
        'forbidden',
        `Tempel elemen "${el.id}" bertipe "${el.type}" ditolak oleh hook izin.`,
      );
    }
  }

  board.transact(
    (tx) => {
      for (const rec of [...assets, ...elements, ...bindings]) tx.put(rec);
    },
    { label: options.label ?? 'paste' },
  );

  const pasted = new Set(elements.map((el) => el.id));
  return {
    ids: elements.map((el) => el.id),
    rootIds: elements
      .filter((el) => el.parentId === null || !pasted.has(el.parentId))
      .map((el) => el.id),
    idMap,
    rejected: prepared.rejected,
  };
}

/** Plain text of the elements in reading order (top to bottom, then left to right). */
function contentText(board: Board, elements: readonly ElementRecord[]): string {
  const lines: string[] = [];
  const ordered = [...elements].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const el of ordered) {
    const exporter = board.elements.get(el.type)?.export?.text;
    if (!exporter) continue;
    let text = '';
    try {
      text = exporter(el as never, undefined);
    } catch {
      // A broken exporter only loses this element's text, never the copy.
      continue;
    }
    if (typeof text === 'string' && text.trim() !== '') lines.push(text);
  }
  return lines.join('\n');
}

/**
 * Builds the clipboard payload for the given elements (BOARD-906). Returns `null` when none of
 * `ids` is an element of the board.
 *
 * @param ids Element IDs to copy; defaults to the current selection.
 * @public
 */
export function serializeClipboard(
  board: Board,
  ids: readonly string[] = board.selection,
): ClipboardPayload | null {
  const document = extractContent(board, ids);
  const elements = Object.values(document.records).filter(isElement);
  if (elements.length === 0) return null;
  return {
    json: JSON.stringify({ kind: ENVELOPE_KIND, version: ENVELOPE_VERSION, document }),
    text: contentText(board, elements),
    ids: elements.map((el) => el.id),
  };
}

/**
 * Reads board content from clipboard text written by {@link serializeClipboard}. Returns `null`
 * for anything else (plain text, other JSON, a newer envelope), so callers can fall back to other
 * paste handling.
 *
 * @public
 */
export function parseClipboard(text: string): BoardDocument | null {
  if (typeof text !== 'string' || !text.includes(ENVELOPE_KIND)) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  const envelope = value as { kind?: unknown; version?: unknown; document?: unknown };
  if (envelope.kind !== ENVELOPE_KIND || envelope.version !== ENVELOPE_VERSION) return null;
  const doc = envelope.document;
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return null;
  return doc as BoardDocument;
}
