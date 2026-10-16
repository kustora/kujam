/**
 * `@kujam/server` — Utilitas sisi server Node.js untuk validasi, migrasi, dan ekstraksi referensi dokumen papan.
 *
 * @packageDocumentation
 */

/**
 * Validasi dokumen memakai implementasi yang sama dengan klien (`@kujam/core`),
 * sehingga aturan di server dan di browser tidak pernah berbeda.
 *
 * @public
 */
export { validateDocument, type ValidationResult } from '@kujam/core';
