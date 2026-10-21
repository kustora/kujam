/**
 * `@kujam/server` — Node.js server-side utilities for validating, migrating, and extracting references from board documents.
 *
 * @packageDocumentation
 */

export {
  validateServerDocument,
  type ValidateServerDocumentOptions,
} from './validate.js';

export {
  extractReferences,
  type CardPlacementReference,
  type ExtractReferencesOptions,
} from './references.js';

export {
  renderThumbnail,
  type CanvasFactory,
  type CanvasFactoryResult,
  type RenderThumbnailOptions,
} from './thumbnail.js';

export {
  migrateServerDocument,
  migrateServerBatch,
  type MigrateBatchEntry,
  type MigrateBatchItem,
  type MigrateBatchOptions,
  type MigrateBatchReport,
  type MigrateServerOptions,
  type MigrateServerResult,
} from './migrate.js';

/**
 * Re-export of canonical document validation from `@kujam/core`.
 *
 * For server-specific features such as binary Yjs updates and strict mode,
 * use {@link validateServerDocument}.
 *
 * @public
 */
export { validateDocument, type ValidationResult } from '@kujam/core';
