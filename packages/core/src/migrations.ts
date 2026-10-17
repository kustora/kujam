/**
 * Document migrations (BOARD-701, BOARD-702).
 *
 * Order on load:
 * 1. Core schema migrations upgrade a document step by step from its `schemaVersion` to
 *    {@link CURRENT_SCHEMA_VERSION}. They run before structural validation, because an older
 *    document is not necessarily a valid document of the current schema.
 * 2. Element props migrations (`migrate` in `defineElement`), per element `typeVersion`.
 * 3. Plugin document migrations (`migrations` in `definePlugin`), per `pluginVersions` entry.
 *
 * Steps 2 and 3 need the installed element types and plugins; the board applies their result
 * as a separate transaction with origin `'migration'`.
 */

import { deepClone, deepFreeze } from './clone.js';
import type { ElementRegistry } from './elements.js';
import type { AnyPluginDefinition, PluginMigrations } from './plugins.js';
import { CURRENT_SCHEMA_VERSION, type BoardDocument, type BoardRecord } from './types.js';

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
  /**
   * What was being migrated: `{ kind: 'element', type }` for props migrations,
   * `{ kind: 'plugin', id }` for plugin document migrations, or `undefined` for core schema
   * migrations.
   */
  readonly source: MigrationSource | undefined;

  constructor(
    fromVersion: number,
    message: string,
    options?: { cause?: unknown; source?: MigrationSource },
  ) {
    super(message, options);
    this.name = 'MigrationError';
    this.fromVersion = fromVersion;
    this.source = options?.source;
  }
}

/**
 * Origin of a failing non-core migration step (see {@link MigrationError.source}).
 *
 * @public
 */
export type MigrationSource =
  | { readonly kind: 'element'; readonly type: string }
  | { readonly kind: 'plugin'; readonly id: string };

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

// ---------- Element and plugin migrations (BOARD-702) ----------

/**
 * Number of consecutive plugin migration steps starting at `0`: the plugin's current document
 * version. Steps after a gap are never reached.
 *
 * @internal
 */
export function latestPluginVersion(migrations: PluginMigrations | undefined): number {
  let version = 0;
  while (migrations && typeof migrations[version] === 'function') version++;
  return version;
}

function runStep<T>(step: (input: T) => T, input: T, fail: (cause: unknown) => never): T {
  let next: unknown;
  try {
    // A frozen copy: a step that mutates its input throws instead of corrupting board state.
    next = step(deepFreeze(deepClone(input)));
  } catch (error) {
    fail(error);
  }
  if (!isPlainObject(next)) fail(new TypeError('Langkah migrasi wajib mengembalikan objek.'));
  return next as T;
}

/**
 * Runs `migrate` steps of registered element types on every element whose `typeVersion`
 * (missing means `1`) is below its definition's `version`, then sets `typeVersion` to that
 * version. Versions without a step leave props unchanged. Unregistered types and elements newer
 * than their definition are left untouched. Returns `doc` itself when nothing changed.
 *
 * @internal
 */
export function migrateElements(doc: BoardDocument, elements: ElementRegistry): BoardDocument {
  let records: Record<string, BoardRecord> | null = null;
  for (const [id, rec] of Object.entries(doc.records)) {
    if (rec.kind !== 'element') continue;
    const def = elements.get(rec.type);
    const from = rec.typeVersion ?? 1;
    if (!def || from >= def.version) continue;

    let props = rec.props;
    for (let version = from; version < def.version; version++) {
      const step =
        def.migrate && Object.hasOwn(def.migrate, version) ? def.migrate[version] : undefined;
      if (typeof step !== 'function') continue;
      props = runStep(step, props, (cause) => {
        throw new MigrationError(
          version,
          `Migrasi props tipe "${rec.type}" dari versi ${version} ke ${version + 1} gagal.`,
          { cause, source: { kind: 'element', type: rec.type } },
        );
      });
    }
    records ??= { ...doc.records };
    Object.defineProperty(records, id, {
      value: { ...rec, props, typeVersion: def.version },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return records ? { ...doc, records } : doc;
}

/**
 * Runs each plugin's document `migrations` from the version recorded in `doc.pluginVersions`
 * (missing means `0`), in plugin order, and records the new versions. Returns `doc` itself when
 * nothing changed.
 *
 * @internal
 */
export function migratePluginDocuments(
  doc: BoardDocument,
  plugins: readonly AnyPluginDefinition[],
): BoardDocument {
  let current = doc;
  for (const plugin of plugins) {
    const migrations = plugin.migrations;
    if (!migrations) continue;
    const from = current.pluginVersions?.[plugin.id] ?? 0;
    const to = latestPluginVersion(migrations);
    if (from >= to) continue;

    let next = current;
    for (let version = from; version < to; version++) {
      next = runStep(migrations[version]!, next, (cause) => {
        throw new MigrationError(
          version,
          `Migrasi dokumen plugin "${plugin.id}" dari versi ${version} ke ${version + 1} gagal.`,
          { cause, source: { kind: 'plugin', id: plugin.id } },
        );
      });
    }
    // Plugins may not change the schema version or other plugins' versions.
    current = {
      ...next,
      schemaVersion: current.schemaVersion,
      pluginVersions: { ...current.pluginVersions, [plugin.id]: to },
    };
  }
  return current;
}

/**
 * Reason a document is newer than this board understands (BOARD-703).
 *
 * @beta
 */
export type DocumentTooNewReason =
  | { readonly kind: 'schema'; readonly version: number; readonly supported: number }
  | {
      readonly kind: 'element';
      readonly type: string;
      readonly version: number;
      readonly supported: number;
    }
  | {
      readonly kind: 'plugin';
      readonly id: string;
      readonly version: number;
      readonly supported: number;
    };

/**
 * Finds why `doc` is newer than this board understands: a `schemaVersion` above
 * {@link CURRENT_SCHEMA_VERSION}, an element whose `typeVersion` is above its registered
 * definition's `version`, or a `pluginVersions` entry above an installed plugin's migrations.
 * Unregistered types and plugins that are not installed are not checked. Returns `null` when
 * the document is fully supported.
 *
 * @internal
 */
export function findTooNew(
  doc: BoardDocument,
  elements: ElementRegistry,
  plugins: readonly AnyPluginDefinition[],
): DocumentTooNewReason | null {
  if (doc.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { kind: 'schema', version: doc.schemaVersion, supported: CURRENT_SCHEMA_VERSION };
  }
  for (const rec of Object.values(doc.records)) {
    if (rec.kind !== 'element' || rec.typeVersion === undefined) continue;
    const def = elements.get(rec.type);
    if (def && rec.typeVersion > def.version) {
      return { kind: 'element', type: rec.type, version: rec.typeVersion, supported: def.version };
    }
  }
  for (const plugin of plugins) {
    const version = doc.pluginVersions?.[plugin.id];
    const supported = latestPluginVersion(plugin.migrations);
    if (version !== undefined && version > supported) {
      return { kind: 'plugin', id: plugin.id, version, supported };
    }
  }
  return null;
}

/**
 * Runs every migration that needs the installed element types and plugins, in order: element
 * props migrations, then plugin document migrations. Core schema migrations
 * ({@link migrateSchema}) must already have run. Returns `doc` itself when nothing changed.
 *
 * @internal
 */
export function migrateContent(
  doc: BoardDocument,
  elements: ElementRegistry,
  plugins: readonly AnyPluginDefinition[],
): BoardDocument {
  return migratePluginDocuments(migrateElements(doc, elements), plugins);
}
