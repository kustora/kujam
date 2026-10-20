/**
/**
 * Conversion utilities between Y.Doc, binary Yjs state updates, and canonical BoardDocument (BOARD-1513).
 *
 * Designed to execute cleanly in Node.js (without DOM requirements) as well as browsers and workers.
 *
 * @packageDocumentation
 */

import * as Y from 'yjs';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_BOARD_LIMITS,
  InvalidDocumentError,
  validateBoardRecord,
  type BoardDocument,
  type BoardLimits,
  type BoardRecord,
  type RecordPropsValidator,
} from '@kujam/core';
import { isValidBoardRecord, recordToYMap, yMapToRecord } from './binding.js';

/**
 * Configuration options for converting a {@link BoardDocument} into a `Y.Doc` (BOARD-1513).
 *
 * @public
 */
export interface DocumentToYDocOptions {
  /**
   * Existing Y.Doc instance to populate. When omitted, a fresh Y.Doc is allocated.
   */
  doc?: Y.Doc;

  /**
   * Origin token for the transaction when populating Y.Doc records.
   * Defaults to a unique Symbol.
   */
  origin?: unknown;
}

/**
 * Configuration options for converting a `Y.Doc` into a {@link BoardDocument} (BOARD-1513).
 *
 * @public
 */
export interface YDocToDocumentOptions {
  /**
   * Optional custom validator for records. Return false to exclude or drop a record.
   */
  validateRecord?: (record: unknown) => record is BoardRecord;

  /**
   * Element type registry (for example `board.elements` or `createElementRegistry(...)`). When
   * `registry` or `limits` is given, records are also checked with `validateBoardRecord` from
   * `@kujam/core` (the rules `loadDocument` applies: full structure, props against their schema,
   * stroke points) and dropped when they fail (BOARD-2004). Leave both out to keep such records,
   * for example to report them with `validateDocument` afterwards.
   */
  registry?: RecordPropsValidator;

  /**
   * Size limits; giving them turns on the record checks described at `registry`. Omitted values
   * fall back to `DEFAULT_BOARD_LIMITS`.
   */
  limits?: Partial<BoardLimits>;

  /**
   * Fallback schema version if not present in the Y.Doc metadata.
   * Defaults to {@link CURRENT_SCHEMA_VERSION}.
   */
  defaultSchemaVersion?: number;
}

/**
 * Options for {@link updateToYDoc}.
 *
 * @public
 */
export interface UpdateToYDocOptions extends DocumentToYDocOptions {
  /**
   * Largest accepted update in bytes, checked before decoding (BOARD-2004). Defaults to
   * `DEFAULT_BOARD_LIMITS.maxDocumentBytes` (10 MB).
   */
  maxUpdateBytes?: number;
}

/**
 * Options for {@link updateToDocument}.
 *
 * @public
 */
export interface UpdateToDocumentOptions extends YDocToDocumentOptions {
  /**
   * Largest accepted update in bytes, checked before decoding (BOARD-2004). Defaults to
   * `limits.maxDocumentBytes`, then `DEFAULT_BOARD_LIMITS.maxDocumentBytes` (10 MB).
   */
  maxUpdateBytes?: number;
}

/**
 * Error thrown when a binary Yjs update is too large or cannot be decoded (BOARD-2004). The error
 * from Yjs, if any, is kept as `cause`.
 *
 * @public
 */
export class InvalidUpdateError extends Error {
  override readonly name = 'InvalidUpdateError';
}

function assertUpdateSize(update: unknown, maxUpdateBytes: number | undefined): void {
  if (!(update instanceof Uint8Array)) {
    throw new TypeError('update wajib berupa Uint8Array.');
  }
  const max = maxUpdateBytes ?? DEFAULT_BOARD_LIMITS.maxDocumentBytes;
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError('maxUpdateBytes wajib berupa bilangan bulat positif.');
  }
  if (update.byteLength > max) {
    throw new InvalidUpdateError(
      `Ukuran update Yjs (${update.byteLength} byte) melebihi batas maksimum (${max} byte).`,
    );
  }
}

function assertDocumentLimits(
  document: BoardDocument,
  limits: Partial<BoardLimits> | undefined,
): void {
  const maxElements = limits?.maxElements ?? DEFAULT_BOARD_LIMITS.maxElements;
  const maxBytes = limits?.maxDocumentBytes ?? DEFAULT_BOARD_LIMITS.maxDocumentBytes;
  const errors: string[] = [];
  const elements = Object.values(document.records).filter((r) => r.kind === 'element').length;
  if (elements > maxElements) {
    errors.push(`Jumlah elemen (${elements}) melebihi batas maksimum (${maxElements}).`);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(document)).byteLength;
  if (bytes > maxBytes) {
    errors.push(`Ukuran dokumen (${bytes} byte) melebihi batas maksimum (${maxBytes} byte).`);
  }
  if (errors.length > 0) throw new InvalidDocumentError(errors);
}

/**
 * Converts a canonical {@link BoardDocument} into a Yjs `Y.Doc` (BOARD-1513).
 *
 * Maps `doc.records` into individual nested `Y.Map` entries under the `'records'` map,
 * and preserves document-level metadata (`schemaVersion`, `meta`, `pluginVersions`)
 * under the `'meta'` map.
 *
 * Operates purely in memory without DOM dependencies, suitable for Node.js server pipelines.
 *
 * @param doc - Canonical board document to convert.
 * @param options - Conversion and target Y.Doc options.
 * @returns Populated Y.Doc instance.
 * @public
 */
export function documentToYDoc(doc: BoardDocument, options: DocumentToYDocOptions = {}): Y.Doc {
  const ydoc = options.doc ?? new Y.Doc();
  const origin = options.origin ?? Symbol.for('kujam.sync.yjs.docToYDoc');

  ydoc.transact(() => {
    // 1. Synchronize document-level metadata
    const metaMap = ydoc.getMap<unknown>('meta');
    metaMap.set('schemaVersion', doc.schemaVersion ?? CURRENT_SCHEMA_VERSION);
    metaMap.set('meta', doc.meta ? JSON.parse(JSON.stringify(doc.meta)) : {});

    if (doc.pluginVersions && Object.keys(doc.pluginVersions).length > 0) {
      metaMap.set('pluginVersions', JSON.parse(JSON.stringify(doc.pluginVersions)));
    } else {
      metaMap.delete('pluginVersions');
    }

    // 2. Synchronize records map
    const recordsMap = ydoc.getMap<Y.Map<unknown>>('records');
    const targetRecordIds = new Set(Object.keys(doc.records));

    // Remove any records in ydoc that are no longer in doc
    for (const key of Array.from(recordsMap.keys())) {
      if (!targetRecordIds.has(key)) {
        recordsMap.delete(key);
      }
    }

    // Populate or update records
    for (const [id, record] of Object.entries(doc.records)) {
      let yMap = recordsMap.get(id);
      if (!(yMap instanceof Y.Map)) {
        yMap = new Y.Map<unknown>();
        recordsMap.set(id, yMap);
      }
      recordToYMap(record, yMap);
    }
  }, origin);

  return ydoc;
}

/**
 * Converts a Yjs `Y.Doc` into a canonical {@link BoardDocument} (BOARD-1513).
 *
 * Reads records from the `'records'` map and document metadata from the `'meta'` map.
 * Drops malformed or corrupt records using {@link isValidBoardRecord}. With `options.registry` or
 * `options.limits`, also drops records that fail `validateBoardRecord` from `@kujam/core`.
 *
 * Operates purely in memory without DOM dependencies, suitable for Node.js server pipelines.
 *
 * @param ydoc - Y.Doc instance to read from.
 * @param options - Extraction options.
 * @returns Valid canonical BoardDocument.
 * @public
 */
export function yDocToDocument(ydoc: Y.Doc, options: YDocToDocumentOptions = {}): BoardDocument {
  const customValidate = options.validateRecord;
  const checkRecords = options.registry !== undefined || options.limits !== undefined;
  const defaultVersion = options.defaultSchemaVersion ?? CURRENT_SCHEMA_VERSION;

  // 1. Read document metadata
  const metaMap = ydoc.getMap<unknown>('meta');
  const rawSchemaVersion = metaMap.get('schemaVersion');
  const schemaVersion =
    typeof rawSchemaVersion === 'number' && Number.isFinite(rawSchemaVersion)
      ? rawSchemaVersion
      : defaultVersion;

  const rawMeta = metaMap.get('meta');
  const meta =
    rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
      ? (JSON.parse(JSON.stringify(rawMeta)) as Record<string, unknown>)
      : {};

  const rawPluginVersions = metaMap.get('pluginVersions');
  let pluginVersions: Record<string, number> | undefined;
  if (
    rawPluginVersions &&
    typeof rawPluginVersions === 'object' &&
    !Array.isArray(rawPluginVersions)
  ) {
    const pv = rawPluginVersions as Record<string, unknown>;
    const cleanPv: Record<string, number> = {};
    for (const [k, v] of Object.entries(pv)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        cleanPv[k] = v;
      }
    }
    if (Object.keys(cleanPv).length > 0) {
      pluginVersions = cleanPv;
    }
  }

  // 2. Read records
  const records: Record<string, BoardRecord> = {};
  const recordsMap = ydoc.getMap<Y.Map<unknown>>('records');

  for (const [id, yRecord] of recordsMap.entries()) {
    if (yRecord instanceof Y.Map) {
      const record = yMapToRecord(yRecord);
      if (!record || !isValidBoardRecord(record)) {
        continue;
      }
      if (
        checkRecords &&
        validateBoardRecord(record, options.registry, { limits: options.limits }).length > 0
      ) {
        continue;
      }
      if (customValidate && !customValidate(record)) {
        continue;
      }
      records[id] = record;
    }
  }

  const document: BoardDocument = {
    schemaVersion,
    meta,
    records,
    ...(pluginVersions ? { pluginVersions } : {}),
  };

  return document;
}

/**
 * Encodes a Yjs `Y.Doc` into a binary state update (BOARD-1513).
 *
 * @param ydoc - Y.Doc to serialize.
 * @returns Binary Uint8Array containing Yjs update bytes.
 * @public
 */
export function yDocToUpdate(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc);
}

/**
 * Applies a binary Yjs state update to a `Y.Doc` (BOARD-1513).
 *
 * Untrusted bytes are safe to pass: updates larger than `maxUpdateBytes` are rejected before they
 * are decoded, and corrupt updates reject with {@link InvalidUpdateError} instead of the raw Yjs
 * error (BOARD-2004). A corrupt update may still have been partly applied to `options.doc`.
 *
 * @throws {@link InvalidUpdateError} when the update is too large or corrupt.
 * @param update - Binary Uint8Array containing Yjs update bytes.
 * @param options - Target Y.Doc options.
 * @returns Populated Y.Doc instance.
 * @public
 */
export function updateToYDoc(update: Uint8Array, options: UpdateToYDocOptions = {}): Y.Doc {
  assertUpdateSize(update, options.maxUpdateBytes);
  const ydoc = options.doc ?? new Y.Doc();
  try {
    Y.applyUpdate(ydoc, update, options.origin);
  } catch (error) {
    if (!options.doc) ydoc.destroy();
    throw new InvalidUpdateError('Update Yjs rusak dan tidak bisa diterapkan.', { cause: error });
  }
  return ydoc;
}

/**
 * Encodes a canonical {@link BoardDocument} directly into binary Yjs state update bytes (BOARD-1513).
 *
 * Useful for server-side persistence (e.g. SQLite/Postgres blob columns) and batch migration scripts.
 *
 * @param doc - Canonical board document.
 * @param options - Conversion options.
 * @returns Binary Uint8Array update.
 * @public
 */
export function documentToUpdate(
  doc: BoardDocument,
  options: DocumentToYDocOptions = {},
): Uint8Array {
  const ydoc = documentToYDoc(doc, options);
  const update = yDocToUpdate(ydoc);
  if (!options.doc) {
    ydoc.destroy();
  }
  return update;
}

/**
 * Decodes binary Yjs state update bytes directly into a canonical {@link BoardDocument} (BOARD-1513).
 *
 * Creates a transient Y.Doc, applies the update, extracts the document, and releases resources.
 * Invalid records are dropped as in {@link yDocToDocument}; a result with more elements than
 * `limits.maxElements` or larger than `limits.maxDocumentBytes` is rejected (BOARD-2004).
 *
 * @throws {@link InvalidUpdateError} when the update is too large or corrupt, or
 *   `InvalidDocumentError` when the decoded document exceeds the limits.
 * @param update - Binary Uint8Array update bytes.
 * @param options - Extraction options.
 * @returns Restored canonical BoardDocument.
 * @public
 */
export function updateToDocument(
  update: Uint8Array,
  options: UpdateToDocumentOptions = {},
): BoardDocument {
  const maxUpdateBytes = options.maxUpdateBytes ?? options.limits?.maxDocumentBytes;
  const ydoc = updateToYDoc(update, maxUpdateBytes === undefined ? {} : { maxUpdateBytes });
  try {
    const document = yDocToDocument(ydoc, options);
    assertDocumentLimits(document, options.limits);
    return document;
  } finally {
    ydoc.destroy();
  }
}
