/**
 * Server-side document migration for `@kujam/server` (BOARD-705).
 *
 * Runs the exact same migration pipeline as the client (`board.prepareDocument`) in pure Node.js,
 * without DOM or `window`. Supports JSON documents and binary Yjs state updates.
 */

import {
  createBoard,
  type AnyPluginDefinition,
  type BoardDocument,
  type BoardLimits,
} from '@kujam/core';
import { documentToUpdate, updateToDocument } from '@kujam/sync-yjs';

/**
 * Options for {@link migrateServerDocument}.
 *
 * @public
 */
export interface MigrateServerOptions {
  /** Plugins whose element definitions and document migrations are applied. */
  readonly plugins?: readonly AnyPluginDefinition[];
  /** Size limits enforced while preparing the document. */
  readonly limits?: Partial<BoardLimits>;
}

/**
 * Result of {@link migrateServerDocument}.
 *
 * @public
 */
export interface MigrateServerResult {
  /** The migrated document, independent from the input. */
  readonly document: BoardDocument;
  /** Binary Yjs update of the migrated document; only present when the input was binary. */
  readonly update?: Uint8Array;
  /** Whether migration changed anything (schema version, props, or dropped records). */
  readonly changed: boolean;
  /** Schema version of the input document. */
  readonly fromVersion: number;
  /** Schema version of the migrated document. */
  readonly toVersion: number;
  /** Records dropped because they are invalid, with reasons. */
  readonly rejected: readonly { readonly id: string; readonly errors: readonly string[] }[];
}

/**
 * Migrates one board document, given as JSON or as binary Yjs update bytes (BOARD-705).
 *
 * Uses the same code path as the client, so a document migrated here equals one migrated on load.
 * Documents newer than the installed plugins understand are rejected rather than downgraded.
 *
 * @param docOrUpdate - Canonical board document or binary Yjs update bytes.
 * @param options - Plugins and limits.
 * @throws Error when the document is invalid, too new, or a migration fails.
 * @public
 */
export function migrateServerDocument(
  docOrUpdate: BoardDocument | Uint8Array,
  options: MigrateServerOptions = {},
): MigrateServerResult {
  const isBinary = docOrUpdate instanceof Uint8Array;
  const input: BoardDocument = isBinary ? updateToDocument(docOrUpdate) : docOrUpdate;
  const fromVersion = input.schemaVersion;

  const board = createBoard({ plugins: options.plugins, limits: options.limits });
  try {
    const prepared = board.prepareDocument(input);
    if (prepared.tooNew) {
      throw new Error(
        'Dokumen lebih baru dari yang dipahami server ini; perbarui @kujam/* atau plugin.',
      );
    }
    const document = prepared.document;
    const changed =
      prepared.rejected.length > 0 ||
      document.schemaVersion !== fromVersion ||
      JSON.stringify(document) !== JSON.stringify(input);
    return {
      document,
      update: isBinary ? documentToUpdate(document) : undefined,
      changed,
      fromVersion,
      toVersion: document.schemaVersion,
      rejected: prepared.rejected,
    };
  } finally {
    board.dispose();
  }
}

/**
 * One item of a batch migration.
 *
 * @public
 */
export interface MigrateBatchItem {
  /** Caller-defined identifier, such as a board ID, used in the report. */
  readonly id: string;
  /** Document JSON or binary Yjs update. */
  readonly data: BoardDocument | Uint8Array;
}

/**
 * Options for {@link migrateServerBatch}.
 *
 * @public
 */
export interface MigrateBatchOptions extends MigrateServerOptions {
  /**
   * When `true`, migrations are computed and reported but `onMigrated` is never called, so nothing
   * is persisted. Defaults to `false`.
   */
  readonly dryRun?: boolean;
  /** Called for each changed item to persist it. Skipped in dry-run mode. */
  readonly onMigrated?: (id: string, result: MigrateServerResult) => void | Promise<void>;
}

/**
 * Per-item outcome in a {@link MigrateBatchReport}.
 *
 * @public
 */
export interface MigrateBatchEntry {
  readonly id: string;
  readonly status: 'migrated' | 'unchanged' | 'failed';
  readonly fromVersion?: number;
  readonly toVersion?: number;
  readonly rejected?: number;
  readonly error?: string;
}

/**
 * Summary of a batch migration.
 *
 * @public
 */
export interface MigrateBatchReport {
  readonly dryRun: boolean;
  readonly total: number;
  readonly migrated: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly entries: readonly MigrateBatchEntry[];
}

/**
 * Migrates many documents and reports per-item results (BOARD-705). One failing document never
 * stops the batch. Use `dryRun` to preview what would change without persisting anything.
 *
 * @example
 * ```ts
 * const report = await migrateServerBatch(rows, {
 *   plugins: [defaultElements],
 *   dryRun: true,
 * });
 * console.log(`${report.migrated} of ${report.total} would change`);
 * ```
 *
 * @public
 */
export async function migrateServerBatch(
  items: Iterable<MigrateBatchItem>,
  options: MigrateBatchOptions = {},
): Promise<MigrateBatchReport> {
  const dryRun = options.dryRun === true;
  const entries: MigrateBatchEntry[] = [];
  let migrated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const result = migrateServerDocument(item.data, options);
      if (result.changed) {
        if (!dryRun) await options.onMigrated?.(item.id, result);
        migrated++;
        entries.push({
          id: item.id,
          status: 'migrated',
          fromVersion: result.fromVersion,
          toVersion: result.toVersion,
          rejected: result.rejected.length,
        });
      } else {
        unchanged++;
        entries.push({
          id: item.id,
          status: 'unchanged',
          fromVersion: result.fromVersion,
          toVersion: result.toVersion,
        });
      }
    } catch (error) {
      failed++;
      entries.push({
        id: item.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { dryRun, total: entries.length, migrated, unchanged, failed, entries };
}
