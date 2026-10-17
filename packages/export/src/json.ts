/**
 * JSON export and import of board content (BOARD-1701).
 *
 * Export produces a regular {@link BoardDocument}, either the whole board or a subset of elements.
 * Import runs the incoming JSON through the board's own document pipeline
 * ({@link Board.prepareDocument}: validation, limits, and migrations, the same as
 * `loadDocument`) and then writes it as one local transaction, so it is one undo step and is picked
 * up by autosave. Into a board that already has elements, content is pasted with new IDs on the
 * current page; into an empty board, IDs and pages are kept.
 */

import {
  compareIndex,
  computeElementAABB,
  deepClone,
  indicesBetween,
  InvalidDocumentError,
  type AssetRecord,
  type BindingRecord,
  type Board,
  type BoardDocument,
  type BoardRecord,
  type DocumentTooNewReason,
  type ElementRecord,
  type PageRecord,
  type Point,
} from '@kujam/core';

/**
 * Options for {@link exportJSON}.
 *
 * @public
 */
export interface ExportJSONOptions {
  /**
   * Element IDs to export. Their descendants (frame and group children), the bindings between
   * exported elements, the pages they are on, and the assets their props refer to are included too.
   * Unknown IDs are ignored. When omitted, the whole document is exported.
   */
  readonly ids?: readonly string[];
}

/**
 * Options for {@link importJSON}.
 *
 * @public
 */
export interface ImportJSONOptions {
  /**
   * Board point where the center of the imported content is placed, for example the cursor.
   * When omitted, elements keep their coordinates.
   */
  readonly at?: Point;
}

/**
 * Result of {@link importJSON}.
 *
 * @public
 */
export interface ImportResult {
  /** IDs of the imported elements in the board, in layer order. */
  readonly ids: readonly string[];
  /** Map from record IDs in the JSON to record IDs in the board (identity when IDs were kept). */
  readonly idMap: ReadonlyMap<string, string>;
  /** Whether the original IDs were kept (import into a board without elements). */
  readonly keptIds: boolean;
  /** Records left out because they are invalid (BOARD-210), with the reasons. */
  readonly rejected: readonly { readonly id: string; readonly errors: readonly string[] }[];
}

/**
 * Codes for {@link ImportError}.
 *
 * - `read-only`: the board is read-only.
 * - `document-too-new`: the JSON was written by a newer version than this board understands.
 * - `limit-exceeded`: the import would exceed `board.limits.maxElements`.
 * - `forbidden`: a permission hook rejected creating one of the elements (BOARD-212).
 *
 * @public
 */
export type ImportErrorCode = 'read-only' | 'document-too-new' | 'limit-exceeded' | 'forbidden';

/**
 * Error thrown when content cannot be imported. The board is left unchanged.
 *
 * @public
 */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  /** For `document-too-new`: which version is too new. */
  readonly reason: DocumentTooNewReason | undefined;

  constructor(code: ImportErrorCode, message: string, reason?: DocumentTooNewReason) {
    super(message);
    this.name = 'ImportError';
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
 * Exports the board as a JSON-safe {@link BoardDocument} (BOARD-1701): the whole document, or only
 * the elements in `options.ids` with everything they need (see {@link ExportJSONOptions.ids}).
 * The result is a copy; `JSON.stringify` it to get text.
 *
 * @throws `TypeError` when `options.ids` is not an array of strings.
 * @public
 */
export function exportJSON(board: Board, options: ExportJSONOptions = {}): BoardDocument {
  const doc = board.getDocument();
  if (options.ids === undefined) return deepClone(doc) as BoardDocument;
  const { ids } = options;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new TypeError('Opsi ids pada exportJSON wajib berupa array ID string.');
  }

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
    // A parent that is not exported would dangle; the element becomes a root element.
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

function parseInput(json: unknown): BoardDocument {
  if (typeof json !== 'string') return json as BoardDocument;
  try {
    return JSON.parse(json) as BoardDocument;
  } catch {
    throw new InvalidDocumentError(['Teks JSON tidak valid.']);
  }
}

/**
 * Imports JSON produced by {@link exportJSON} (or any board document) into `board` (BOARD-1701).
 *
 * The input goes through {@link Board.prepareDocument}: the same validation, size limits, and
 * migrations as `loadDocument`; invalid records are left out and listed in the result. Then:
 *
 * - into a board without elements, record IDs, pages, and layer indexes are kept (missing pages
 *   are added);
 * - otherwise, like a paste: every record gets a new ID, all elements go onto the current page above
 *   its top element (keeping their relative order), and parents and bindings are remapped.
 *
 * Everything is written in one local transaction labelled `'import'` (one undo step). Assets keep
 * their IDs, since props refer to them, and are only added when missing.
 *
 * @param json - JSON text or an already parsed document.
 * @throws {@link InvalidDocumentError} for invalid JSON or document-level problems,
 *   `MigrationError` when a migration fails, {@link ImportError} when the board is read-only, the
 *   content is too new, the element limit would be exceeded, or a permission hook rejects it, and
 *   `TypeError` for an invalid `options.at`. The board is unchanged when anything throws.
 * @public
 */
export function importJSON(
  board: Board,
  json: unknown,
  options: ImportJSONOptions = {},
): ImportResult {
  const { at } = options;
  if (
    at !== undefined &&
    (typeof at !== 'object' || !Number.isFinite(at?.x) || !Number.isFinite(at?.y))
  ) {
    throw new TypeError(
      'Opsi at pada importJSON wajib berupa titik { x, y } dengan angka berhingga.',
    );
  }
  if (board.readOnly) {
    throw new ImportError('read-only', 'Papan dalam mode baca saja; impor ditolak.');
  }

  const prepared = board.prepareDocument(parseInput(json));
  if (prepared.tooNew) {
    throw new ImportError(
      'document-too-new',
      'Isi JSON berasal dari versi yang lebih baru dari papan ini; impor ditolak.',
      prepared.tooNew,
    );
  }

  const incoming = Object.values(prepared.document.records);
  const sourceElements = incoming
    .filter(isElement)
    .sort((a, b) => compareIndex(a.index, b.index) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sourcePages = incoming.filter((r): r is PageRecord => r.kind === 'page');
  const sourceBindings = incoming.filter((r): r is BindingRecord => r.kind === 'binding');
  const sourceAssets = incoming.filter((r): r is AssetRecord => r.kind === 'asset');

  const current = board.getDocument();
  const existing = Object.values(current.records);
  const existingElements = existing.filter(isElement);
  if (existingElements.length + sourceElements.length > board.limits.maxElements) {
    throw new ImportError(
      'limit-exceeded',
      `Impor ${sourceElements.length} elemen melebihi batas maksimum (${board.limits.maxElements}).`,
    );
  }

  const collides = [...sourceElements, ...sourceBindings].some((r) =>
    Object.hasOwn(current.records, r.id),
  );
  const keepIds = existingElements.length === 0 && !collides;

  const idMap = new Map<string, string>();
  for (const rec of [...sourceElements, ...sourceBindings]) {
    idMap.set(rec.id, keepIds ? rec.id : board.createId());
  }
  for (const asset of sourceAssets) idMap.set(asset.id, asset.id);

  const pagesToAdd: PageRecord[] = [];
  const pageIds = new Set(existing.filter((r) => r.kind === 'page').map((r) => r.id));
  if (keepIds) {
    for (const page of sourcePages) {
      idMap.set(page.id, page.id);
      if (!pageIds.has(page.id)) {
        pagesToAdd.push(page);
        pageIds.add(page.id);
      }
    }
  }
  const targetPage = board.pages.current;

  let indexes: string[] | null = null;
  if (!keepIds) {
    let top: string | null = null;
    for (const el of existingElements) {
      if (el.pageId === targetPage && (top === null || compareIndex(el.index, top) > 0)) {
        top = el.index;
      }
    }
    indexes = indicesBetween(top, null, sourceElements.length);
  }

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
    pageId: keepIds && pageIds.has(el.pageId) ? el.pageId : targetPage,
    parentId: el.parentId !== null && idMap.has(el.parentId) ? idMap.get(el.parentId)! : null,
    index: indexes ? indexes[i]! : el.index,
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
      throw new ImportError(
        'forbidden',
        `Impor elemen "${el.id}" bertipe "${el.type}" ditolak oleh hook izin.`,
      );
    }
  }

  board.transact(
    (tx) => {
      for (const rec of [...pagesToAdd, ...assets, ...elements, ...bindings]) tx.put(rec);
    },
    { label: 'import' },
  );

  return {
    ids: elements.map((el) => el.id),
    idMap,
    keptIds: keepIds,
    rejected: prepared.rejected,
  };
}
