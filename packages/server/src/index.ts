/**
 * `@kujam/server` — Utilitas sisi server Node.js untuk validasi, migrasi, dan ekstraksi referensi dokumen papan.
 *
 * @packageDocumentation
 */

import type { BoardDocument } from '@kujam/core';

/**
 * Hasil validasi dokumen papan di sisi server.
 *
 * @public
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Memvalidasi struktur dasar dokumen papan sebelum disimpan di server.
 *
 * @public
 */
export function validateDocument(doc: unknown): ValidationResult {
  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: ['Dokumen harus berupa objek JSON.'] };
  }

  const candidate = doc as Partial<BoardDocument>;
  const errors: string[] = [];

  if (typeof candidate.schemaVersion !== 'number') {
    errors.push('Field schemaVersion wajib berupa angka.');
  }
  if (!candidate.records || typeof candidate.records !== 'object') {
    errors.push('Field records wajib berupa objek peta record.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

