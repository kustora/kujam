/**
 * Document migrations (BOARD-701).
 *
 * Core schema migrations upgrade a document step by step from its `schemaVersion` to
 * {@link CURRENT_SCHEMA_VERSION}. They run before structural validation, because an older
 * document is not necessarily a valid document of the current schema.
 */

import { deepClone, deepFreeze } from './clone.js';
import { CURRENT_SCHEMA_VERSION, type BoardDocument } from './types.js';

/**
 * A single core schema migration step from version `n` to `n + 1`. Must be pure: it receives a
 * frozen document and returns a new one. The runner sets `schemaVersion` of the result to `n + 1`.
 *
 * @public
 */
export type SchemaMigration = (doc: BoardDocument) => BoardDocument;

/**
 * Core schema migrations keyed by source version: key `n` migrates a document from schema
 * version `n` to `n + 1`.
 *
 * @public
 */
export type SchemaMigrations = Readonly<Record<number, SchemaMigration>>;

/**
 * Core schema migrations of this package version. Every version from `1` to
 * `CURRENT_SCHEMA_VERSION - 1` must have a step; adding a step means bumping
 * {@link CURRENT_SCHEMA_VERSION}.
 *
 * @public
 */
export const CORE_MIGRATIONS: SchemaMigrations = Object.freeze({});

/**
 * Error thrown when a document cannot be migrated: a step is missing, throws, or returns a
 * non-object.
 *
 * @public
 */
export class MigrationError extends Error {
  /** Source version of the failing step. */
  readonly fromVersion: number;

  constructor(fromVersion: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationError';
    this.fromVersion = fromVersion;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Runs core schema migrations in order until the document reaches `targetVersion`.
 *
 * The input is never mutated: steps receive a deep-frozen copy, so a step that mutates its input
 * throws a `TypeError`. A document that is already at (or above) `targetVersion`, or whose
 * `schemaVersion` is not a positive integer, is returned unchanged and left to validation.
 *
 * @param doc - Document to migrate.
 * @param migrations - Steps to run. Defaults to {@link CORE_MIGRATIONS}.
 * @param targetVersion - Version to migrate to. Defaults to {@link CURRENT_SCHEMA_VERSION}.
 * @throws {@link MigrationError} when a step is missing, throws, or returns a non-object.
 * @public
 */
export function migrateSchema(
  doc: BoardDocument,
  migrations: SchemaMigrations = CORE_MIGRATIONS,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): BoardDocument {
  const start = isPlainObject(doc) ? doc.schemaVersion : undefined;
  if (!Number.isInteger(start) || (start as number) < 1 || (start as number) >= targetVersion) {
    return doc;
  }

  let current = deepFreeze(deepClone(doc));
  for (let version = start as number; version < targetVersion; version++) {
    const step = Object.hasOwn(migrations, version) ? migrations[version] : undefined;
    if (typeof step !== 'function') {
      throw new MigrationError(
        version,
        `Migrasi skema dari versi ${version} ke ${version + 1} tidak tersedia.`,
      );
    }
    let next: unknown;
    try {
      next = step(current);
    } catch (error) {
      throw new MigrationError(
        version,
        `Migrasi skema dari versi ${version} ke ${version + 1} gagal.`,
        { cause: error },
      );
    }
    if (!isPlainObject(next)) {
      throw new MigrationError(
        version,
        `Migrasi skema dari versi ${version} ke ${version + 1} wajib mengembalikan objek dokumen.`,
      );
    }
    current = deepFreeze({ ...(next as unknown as BoardDocument), schemaVersion: version + 1 });
  }
  // Callers own the result, so it is returned unfrozen.
  return deepClone(current);
}
