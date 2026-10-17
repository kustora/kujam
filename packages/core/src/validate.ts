/**
 * Structural validation of board documents, shared by client and server (BOARD-210).
 */

import type { BoardDocument } from './types.js';
import { CURRENT_SCHEMA_VERSION } from './types.js';

/**
 * Board document validation result.
 *
 * @public
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkFields(
  rec: Record<string, unknown>,
  path: string,
  errors: string[],
  spec: Record<string, (v: unknown) => boolean>,
  label: Record<string, string>,
): void {
  for (const key of Object.keys(spec)) {
    if (!spec[key]!(rec[key])) {
      errors.push(`${path}.${key} wajib ${label[key]}.`);
    }
  }
}

const isString = (v: unknown): boolean => typeof v === 'string';
const isNonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.length > 0;
const isNonNegative = (v: unknown): boolean => isFiniteNumber(v) && v >= 0;

function validateRecord(id: string, rec: unknown, errors: string[]): void {
  const path = `records["${id}"]`;
  if (!isPlainObject(rec)) {
    errors.push(`${path} wajib berupa objek.`);
    return;
  }
  if (rec.id !== id) {
    errors.push(`${path}.id wajib sama dengan kuncinya.`);
  }

  switch (rec.kind) {
    case 'element':
      checkFields(
        rec,
        path,
        errors,
        {
          type: isNonEmptyString,
          pageId: isNonEmptyString,
          parentId: (v) => v === null || isNonEmptyString(v),
          index: isNonEmptyString,
          x: isFiniteNumber,
          y: isFiniteNumber,
          rotation: isFiniteNumber,
          w: isNonNegative,
          h: isNonNegative,
          locked: (v) => typeof v === 'boolean',
          opacity: (v) => isFiniteNumber(v) && v >= 0 && v <= 1,
          props: isPlainObject,
          meta: isPlainObject,
        },
        {
          type: 'berupa string tidak kosong',
          pageId: 'berupa string tidak kosong',
          parentId: 'berupa string tidak kosong atau null',
          index: 'berupa string tidak kosong',
          x: 'berupa angka berhingga',
          y: 'berupa angka berhingga',
          rotation: 'berupa angka berhingga',
          w: 'berupa angka berhingga dan tidak negatif',
          h: 'berupa angka berhingga dan tidak negatif',
          locked: 'berupa boolean',
          opacity: 'berupa angka antara 0 dan 1',
          props: 'berupa objek',
          meta: 'berupa objek',
        },
      );
      return;
    case 'binding':
      checkFields(
        rec,
        path,
        errors,
        {
          fromId: isNonEmptyString,
          toId: isNonEmptyString,
          anchor: (v) => isPlainObject(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y),
        },
        {
          fromId: 'berupa string tidak kosong',
          toId: 'berupa string tidak kosong',
          anchor: 'berupa objek { x, y } dengan angka berhingga',
        },
      );
      return;
    case 'page':
      checkFields(
        rec,
        path,
        errors,
        { name: isString, index: isNonEmptyString, meta: isPlainObject },
        { name: 'berupa string', index: 'berupa string tidak kosong', meta: 'berupa objek' },
      );
      return;
    case 'asset':
      checkFields(
        rec,
        path,
        errors,
        { mimeType: isNonEmptyString, w: isNonNegative, h: isNonNegative, meta: isPlainObject },
        {
          mimeType: 'berupa string tidak kosong',
          w: 'berupa angka berhingga dan tidak negatif',
          h: 'berupa angka berhingga dan tidak negatif',
          meta: 'berupa objek',
        },
      );
      return;
    default:
      errors.push(`${path}.kind wajib salah satu dari element, binding, page, asset.`);
  }
}

/**
 * Validates board document structure: document shape, schema version, and the required fields
 * of every record. Per-element-type props validation comes with the element registry.
 *
 * Documents with a `schemaVersion` newer than {@link CURRENT_SCHEMA_VERSION}
 * are considered invalid for this package version.
 *
 * @public
 */
export function validateDocument(doc: unknown): ValidationResult {
  if (!isPlainObject(doc)) {
    return { valid: false, errors: ['Dokumen harus berupa objek JSON.'] };
  }

  const candidate = doc as Partial<BoardDocument> & Record<string, unknown>;
  const errors: string[] = [];

  const version = candidate.schemaVersion;
  if (!Number.isInteger(version) || (version as number) < 1) {
    errors.push('Field schemaVersion wajib berupa bilangan bulat positif.');
  } else if ((version as number) > CURRENT_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion ${version} lebih baru dari versi yang didukung (${CURRENT_SCHEMA_VERSION}).`,
    );
  }

  if (!isPlainObject(candidate.meta)) {
    errors.push('Field meta wajib berupa objek.');
  }

  if (!isPlainObject(candidate.records)) {
    errors.push('Field records wajib berupa objek peta record.');
  } else {
    for (const [id, rec] of Object.entries(candidate.records)) {
      validateRecord(id, rec, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Error thrown when a document fails {@link validateDocument}.
 *
 * @public
 */
export class InvalidDocumentError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Dokumen papan tidak valid: ${errors.join(' ')}`);
    this.name = 'InvalidDocumentError';
    this.errors = errors;
  }
}

/**
 * Validates the structure of a single record (used by the store when a record is written in a transaction).
 * Returns a list of error messages; empty means valid.
 *
 * @internal
 */
export function validateRecordShape(rec: unknown): string[] {
  const errors: string[] = [];
  const id = isPlainObject(rec) && typeof rec.id === 'string' ? rec.id : '';
  if (isPlainObject(rec) && id === '') {
    errors.push('Record wajib memiliki id berupa string tidak kosong.');
  }
  validateRecord(id, rec, errors);
  return errors;
}
