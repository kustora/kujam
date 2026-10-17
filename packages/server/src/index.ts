/**
 * `@kujam/server` — Node.js server-side utilities for validating, migrating, and extracting references from board documents.
 *
 * @packageDocumentation
 */

/**
 * Document validation uses the same implementation as the client (`@kujam/core`),
 * so the rules on the server and in the browser never differ.
 *
 * @public
 */
export { validateDocument, type ValidationResult } from '@kujam/core';
