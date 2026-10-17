/**
 * Structural validation of board documents, shared by client and server (BOARD-210).
 */

import type { ElementRegistry } from './elements.js';
import { countPoints, measureDocumentBytes, resolveLimits, type BoardLimits } from './limits.js';
import type { BoardDocument } from './types.js';
import { CURRENT_SCHEMA_VERSION } from './types.js';

/**
 * Board document validation result.
 *
 * @public
 */
export interface ValidationResult {
  /** `true` when there are no document-level and no record-level problems. */
  valid: boolean;
  /** Every problem message: document-level problems first, then record-level ones. */
  errors: string[];
  /**
   * Record-level problems keyed by record ID (BOARD-210). These records can be rejected one by one
   * while the rest of the document still loads; `createBoard` and `loadDocument` do exactly that.
   * Problems missing from this map are document-level and make the whole document unusable.
   */
  invalidRecords: Record<string, string[]>;
}

/**
 * Options for {@link validateDocument}.
 *
 * @public
 */
export interface ValidateDocumentOptions {
  /**
   * Size limits to enforce. Omitted values fall back to {@link DEFAULT_BOARD_LIMITS}, the same
   * defaults `createBoard` uses.
   */
  limits?: Partial<BoardLimits>;
}

/**
 * Element type registry, or just the part `validateDocument` needs, so a server can pass a
 * registry built from the same plugins as its clients.
 *
 * @public
 */
export type DocumentPropsValidator = Pick<ElementRegistry, 'validateElementProps'>;

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
const isPositiveInteger = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1;

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
      if (rec.typeVersion !== undefined && !isPositiveInteger(rec.typeVersion)) {
        errors.push(`${path}.typeVersion wajib berupa bilangan bulat positif.`);
      }
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

/** @internal Options for {@link inspectDocument}. */
export interface InspectOptions {
  /**
   * Accept a `schemaVersion` newer than {@link CURRENT_SCHEMA_VERSION}, so the board can open the
   * document read-only (BOARD-703).
   */
  readonly allowNewerSchema?: boolean;
  /**
   * Whether to check this element's props against the registry. The board skips elements whose
   * `typeVersion` differs from the registered version: their props are only valid after element
   * migrations (BOARD-702) have run, and too-new ones must stay untouched (BOARD-703).
   */
  readonly checkProps?: (element: Record<string, unknown>) => boolean;
}

/** @internal Document-level and record-level problems, kept apart. */
export interface DocumentInspection {
  readonly documentErrors: string[];
  readonly invalidRecords: Record<string, string[]>;
}

/**
 * Inspects a document without throwing. Record-level problems: structure, props failing the
 * registered type schema (unregistered types are skipped, BOARD-209), and too many stroke points.
 * Document-level problems: shape, schema version, `meta`, `records`, byte size, and element count
 * (counting only records without problems). See {@link InspectOptions} for the board-only options.
 *
 * @internal
 */
export function inspectDocument(
  doc: unknown,
  registry?: DocumentPropsValidator,
  limitsInput?: Partial<BoardLimits>,
  options: InspectOptions = {},
): DocumentInspection {
  const { allowNewerSchema = false, checkProps } = options;
  const limits = resolveLimits(limitsInput);
  const invalidRecords: Record<string, string[]> = {};
  if (!isPlainObject(doc)) {
    return { documentErrors: ['Dokumen harus berupa objek JSON.'], invalidRecords };
  }

  const candidate = doc as Partial<BoardDocument> & Record<string, unknown>;
  const documentErrors: string[] = [];

  const version = candidate.schemaVersion;
  if (!Number.isInteger(version) || (version as number) < 1) {
    documentErrors.push('Field schemaVersion wajib berupa bilangan bulat positif.');
  } else if (!allowNewerSchema && (version as number) > CURRENT_SCHEMA_VERSION) {
    documentErrors.push(
      `schemaVersion ${version} lebih baru dari versi yang didukung (${CURRENT_SCHEMA_VERSION}).`,
    );
  }

  if (!isPlainObject(candidate.meta)) {
    documentErrors.push('Field meta wajib berupa objek.');
  }

  const pluginVersions = candidate.pluginVersions;
  if (pluginVersions !== undefined) {
    if (!isPlainObject(pluginVersions)) {
      documentErrors.push('Field pluginVersions wajib berupa objek { [idPlugin]: versi }.');
    } else {
      for (const [id, v] of Object.entries(pluginVersions)) {
        if (!Number.isInteger(v) || (v as number) < 0) {
          documentErrors.push(`pluginVersions["${id}"] wajib berupa bilangan bulat tidak negatif.`);
        }
      }
    }
  }

  if (!isPlainObject(candidate.records)) {
    documentErrors.push('Field records wajib berupa objek peta record.');
  } else {
    let elements = 0;
    for (const [id, rec] of Object.entries(candidate.records)) {
      const errors: string[] = [];
      validateRecord(id, rec, errors);
      if (errors.length === 0 && (rec as { kind: unknown }).kind === 'element') {
        const element = rec as unknown as Record<string, unknown>;
        const propsRegistry = checkProps && !checkProps(element) ? undefined : registry;
        checkElementContent(id, element, propsRegistry, limits, errors);
      }
      if (errors.length > 0) {
        invalidRecords[id] = errors;
      } else if ((rec as { kind: unknown }).kind === 'element') {
        elements++;
      }
    }
    if (elements > limits.maxElements) {
      documentErrors.push(
        `Jumlah elemen (${elements}) melebihi batas maksimum (${limits.maxElements}).`,
      );
    }
  }

  const bytes = measureDocumentBytes(doc);
  if (bytes > limits.maxDocumentBytes) {
    documentErrors.push(
      Number.isFinite(bytes)
        ? `Ukuran dokumen (${bytes} byte) melebihi batas maksimum (${limits.maxDocumentBytes} byte).`
        : 'Dokumen tidak bisa diserialisasi ke JSON.',
    );
  }

  return { documentErrors, invalidRecords };
}

/** Checks props against the registered schema and the stroke point limit. */
function checkElementContent(
  id: string,
  rec: Record<string, unknown>,
  registry: DocumentPropsValidator | undefined,
  limits: Readonly<BoardLimits>,
  errors: string[],
): void {
  const path = `records["${id}"]`;
  const points = countPoints(rec.props);
  if (points > limits.maxDrawPoints) {
    errors.push(
      `${path}.props.points berisi ${points} titik, melebihi batas maksimum (${limits.maxDrawPoints}).`,
    );
  }
  const result = registry?.validateElementProps(rec.type as string, rec.props);
  if (result && !result.ok) {
    const detail = result.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(akar)'}: ${issue.code}`)
      .join(', ');
    errors.push(`${path}.props tidak lolos skema tipe "${String(rec.type)}" (${detail}).`);
  }
}

/**
 * Validates an incoming board document (BOARD-210). The same function runs on the client
 * (`createBoard`, `loadDocument`) and on the server (`@kujam/server`), so both apply the same rules.
 *
 * Checks the document shape, schema version, and required fields of every record; with a
 * `registry`, also element props against their registered type schema (unregistered types are
 * left as-is, BOARD-209); and the size limits (document bytes, element count, stroke points).
 *
 * Documents with a `schemaVersion` newer than {@link CURRENT_SCHEMA_VERSION}
 * are considered invalid for this package version.
 *
 * @param doc - Untrusted input, for example parsed JSON from storage or the network.
 * @param registry - Element type registry used to validate props; omit to check structure only.
 * @param options - Limits to enforce; defaults to {@link DEFAULT_BOARD_LIMITS}.
 * @public
 */
export function validateDocument(
  doc: unknown,
  registry?: DocumentPropsValidator,
  options?: ValidateDocumentOptions,
): ValidationResult {
  const { documentErrors, invalidRecords } = inspectDocument(doc, registry, options?.limits);
  const errors = [...documentErrors, ...Object.values(invalidRecords).flat()];
  return { valid: errors.length === 0, errors, invalidRecords };
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
