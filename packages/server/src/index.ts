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

/**
 * Re-export of canonical document validation from `@kujam/core`.
 *
 * For server-specific features such as binary Yjs updates and strict mode,
 * use {@link validateServerDocument}.
 *
 * @public
 */
export { validateDocument, type ValidationResult } from '@kujam/core';
