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
  type BoardDocument,
  type BoardRecord,
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
   * Fallback schema version if not present in the Y.Doc metadata.
   * Defaults to {@link CURRENT_SCHEMA_VERSION}.
   */
  defaultSchemaVersion?: number;
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
export function documentToYDoc(
  doc: BoardDocument,
  options: DocumentToYDocOptions = {},
): Y.Doc {
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
 * Drops malformed or corrupt records using {@link isValidBoardRecord}.
 *
 * Operates purely in memory without DOM dependencies, suitable for Node.js server pipelines.
 *
 * @param ydoc - Y.Doc instance to read from.
 * @param options - Extraction options.
 * @returns Valid canonical BoardDocument.
 * @public
 */
export function yDocToDocument(
  ydoc: Y.Doc,
  options: YDocToDocumentOptions = {},
): BoardDocument {
  const customValidate = options.validateRecord;
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
 * @param update - Binary Uint8Array containing Yjs update bytes.
 * @param options - Target Y.Doc options.
 * @returns Populated Y.Doc instance.
 * @public
 */
export function updateToYDoc(
  update: Uint8Array,
  options: DocumentToYDocOptions = {},
): Y.Doc {
  const ydoc = options.doc ?? new Y.Doc();
  Y.applyUpdate(ydoc, update, options.origin);
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
 *
 * @param update - Binary Uint8Array update bytes.
 * @param options - Extraction options.
 * @returns Restored canonical BoardDocument.
 * @public
 */
export function updateToDocument(
  update: Uint8Array,
  options: YDocToDocumentOptions = {},
): BoardDocument {
  const ydoc = updateToYDoc(update);
  try {
    return yDocToDocument(ydoc, options);
  } finally {
    ydoc.destroy();
  }
}
