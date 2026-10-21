/**
 * Server-side document validation for `@kujam/server` (BOARD-1801).
 *
 * Runs in pure Node.js 20 without DOM or `window` dependencies.
 */

import {
  createElementRegistry,
  DEFAULT_BOARD_LIMITS,
  validateDocument as coreValidateDocument,
  type AnyElementDefinition,
  type BoardDocument,
  type BoardLimits,
  type DocumentPropsValidator,
  type PluginDefinition,
  type ValidationResult,
} from '@kujam/core';
import { updateToYDoc, yDocToDocument } from '@kujam/sync-yjs';

/**
 * Options for {@link validateServerDocument}.
 *
 * @public
 */
export interface ValidateServerDocumentOptions {
  /**
   * Size limits to enforce. Falls back to {@link DEFAULT_BOARD_LIMITS}.
   */
  readonly limits?: Partial<BoardLimits>;

  /**
   * Element type registry or validator used to validate element props.
   */
  readonly registry?: DocumentPropsValidator;

  /**
   * Plugins providing element definitions to validate props against.
   */
  readonly plugins?: readonly PluginDefinition[];

  /**
   * Explicit element definitions to validate props against.
   */
  readonly elements?: readonly AnyElementDefinition[];

  /**
   * Strict mode: when `true`, the result is invalid (`valid: false`) if any record problem
   * exists (`invalidRecords` is non-empty).
   *
   * When `false` (default), only fatal document-level problems (e.g. invalid document structure,
   * unknown future schemaVersion, exceeded element count or byte limits) make `valid: false`.
   * Individual record problems are recorded in `invalidRecords` and `errors`, allowing server
   * storage or migration pipelines to isolate or strip problematic records.
   */
  readonly strict?: boolean;
}

/**
 * Validates a board document or binary Yjs state update bytes on the server (BOARD-1801).
 *
 * Accepts either a JSON {@link BoardDocument} or binary Yjs update bytes (`Uint8Array`).
 * Converts binary updates into a document in memory without requiring DOM or `window`.
 *
 * Checks document structure, schema version, record shapes, size limits, and element props
 * against registered element definitions or plugins.
 *
 * In strict mode (`options.strict: true`), rejects the entire document if any record is invalid.
 *
 * @param docOrUpdate - Canonical board document object or binary Yjs update bytes.
 * @param options - Validation options including plugins, element definitions, limits, and strict mode.
 * @returns Validation result containing `valid`, `errors`, and `invalidRecords`.
 * @public
 */
export function validateServerDocument(
  docOrUpdate: BoardDocument | Uint8Array | unknown,
  options?: ValidateServerDocumentOptions,
): ValidationResult {
  let doc: unknown;
  const droppedYjsRecordIds: string[] = [];

  if (docOrUpdate instanceof Uint8Array) {
    const maxBytes =
      options?.limits?.maxDocumentBytes ?? DEFAULT_BOARD_LIMITS.maxDocumentBytes;

    if (docOrUpdate.byteLength > maxBytes) {
      return {
        valid: false,
        errors: [
          `Ukuran update Yjs (${docOrUpdate.byteLength} byte) melebihi batas maksimum (${maxBytes} byte).`,
        ],
        invalidRecords: {},
      };
    }

    let ydoc;
    try {
      ydoc = updateToYDoc(docOrUpdate, { maxUpdateBytes: maxBytes });
    } catch (error) {
      return {
        valid: false,
        errors: [
          error instanceof Error
            ? error.message
            : 'Update Yjs rusak dan tidak bisa diterapkan.',
        ],
        invalidRecords: {},
      };
    }

    try {
      // Convert to document without pre-filtering records, so that validateDocument reports them
      const converted = yDocToDocument(ydoc);
      doc = converted;

      // Detect any corrupted records that could not be parsed into valid BoardRecord objects
      const recordsMap = ydoc.getMap<unknown>('records');
      for (const key of recordsMap.keys()) {
        if (!converted.records[key]) {
          droppedYjsRecordIds.push(key);
        }
      }
    } finally {
      ydoc.destroy();
    }
  } else {
    doc = docOrUpdate;
  }

  // Resolve validator/registry
  let registry = options?.registry;
  if (!registry && (options?.plugins || options?.elements)) {
    const definitions: AnyElementDefinition[] = [];
    if (options?.elements) {
      definitions.push(...options.elements);
    }
    if (options?.plugins) {
      for (const plugin of options.plugins) {
        if (plugin.elements) {
          definitions.push(...plugin.elements);
        }
      }
    }
    registry = createElementRegistry(definitions);
  }

  const baseResult = coreValidateDocument(doc, registry, {
    limits: options?.limits,
  });

  const invalidRecords: Record<string, string[]> = {
    ...baseResult.invalidRecords,
  };
  const errors: string[] = [...baseResult.errors];

  if (droppedYjsRecordIds.length > 0) {
    for (const id of droppedYjsRecordIds) {
      const msg = ['Record Yjs tidak dapat dikonversi ke BoardRecord yang valid.'];
      invalidRecords[id] = msg;
      errors.push(...msg);
    }
  }

  const totalRecordErrorCount = Object.values(invalidRecords).reduce(
    (acc, errs) => acc + errs.length,
    0,
  );
  const hasDocumentErrors = errors.length > totalRecordErrorCount;
  const hasRecordErrors = totalRecordErrorCount > 0;

  const valid = options?.strict
    ? !hasDocumentErrors && !hasRecordErrors
    : !hasDocumentErrors;

  return {
    valid,
    errors,
    invalidRecords,
  };
}
