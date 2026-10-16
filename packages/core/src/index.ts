/**
 * `@kujam/core` — Inti papan tulis agnostik tanpa DOM dan tanpa dependensi runtime.
 *
 * @packageDocumentation
 */

import { deepClone, deepFreeze } from './clone.js';
import type { BoardDocument, CameraState, ElementRecord } from './types.js';
import { CURRENT_SCHEMA_VERSION } from './types.js';
import { InvalidDocumentError, validateDocument } from './validate.js';

export * from './types.js';
export { deepClone } from './clone.js';
export { InvalidDocumentError, validateDocument, type ValidationResult } from './validate.js';
export * from './schema.js';

/**
 * Bahasa UI yang didukung package.
 *
 * @public
 */
export type BoardLocale = 'id' | 'en';

/**
 * Batas zoom kamera.
 *
 * @public
 */
export interface ZoomRange {
  min: number;
  max: number;
}

/**
 * Batas zoom bawaan: 10% sampai 400%.
 *
 * @public
 */
export const DEFAULT_ZOOM_RANGE: Readonly<ZoomRange> = Object.freeze({ min: 0.1, max: 4 });

/**
 * Opsi pembuatan instance `Board`.
 *
 * @public
 */
export interface CreateBoardOptions {
  document?: BoardDocument;
  /**
   * Mode baca saja. Perubahan dokumen lokal ditolak; kamera dan seleksi tetap bisa diubah,
   * dan `loadDocument` tetap diizinkan untuk menerima dokumen dari server.
   */
  readOnly?: boolean;
  /** Bahasa UI. Bawaan `'id'`. */
  locale?: BoardLocale;
  /** Batas zoom kamera. Bawaan {@link DEFAULT_ZOOM_RANGE}. */
  zoomRange?: ZoomRange;
}

/**
 * Antarmuka publik instance `Board`.
 *
 * @public
 */
export interface Board {
  /** Snapshot dokumen yang dibekukan; mengubahnya melempar `TypeError`. */
  getDocument(): Readonly<BoardDocument>;
  /** Memuat dokumen baru. Melempar {@link InvalidDocumentError} bila tidak valid. */
  loadDocument(doc: BoardDocument): void;
  getElement(id: string): Readonly<ElementRecord> | undefined;
  /** Snapshot kamera yang dibekukan. */
  getCamera(): Readonly<CameraState>;
  /**
   * Mengubah kamera. Nilai yang tidak berhingga diabaikan, dan zoom dijepit ke `zoomRange`.
   */
  setCamera(patch: Partial<CameraState>): void;
  readonly readOnly: boolean;
  readonly locale: BoardLocale;
  dispose(): void;
}

/**
 * Membuat dokumen papan kosong dengan satu halaman bawaan (`page:main`).
 *
 * @public
 */
export function createEmptyDocument(meta: Record<string, unknown> = {}): BoardDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { ...meta },
    records: {
      'page:main': {
        id: 'page:main',
        kind: 'page',
        name: 'Halaman 1',
        index: 'a0',
        meta: {},
      },
    },
  };
}

function toSnapshot(doc: BoardDocument): BoardDocument {
  const result = validateDocument(doc);
  if (!result.valid) {
    throw new InvalidDocumentError(result.errors);
  }
  return deepFreeze(deepClone(doc));
}

function resolveZoomRange(range: ZoomRange | undefined): ZoomRange {
  if (!range) return DEFAULT_ZOOM_RANGE;
  const { min, max } = range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
    throw new RangeError('zoomRange wajib berisi angka berhingga dengan 0 < min <= max.');
  }
  return { min, max };
}

function resolveLocale(locale: unknown): BoardLocale {
  if (locale === undefined) return 'id';
  if (locale === 'id' || locale === 'en') return locale;
  throw new RangeError(`locale "${String(locale)}" tidak didukung (pilih 'id' atau 'en').`);
}

/**
 * Membuat instance `Board` baru tanpa ketergantungan DOM.
 *
 * @public
 */
export function createBoard(options: CreateBoardOptions = {}): Board {
  const zoomRange = resolveZoomRange(options.zoomRange);
  const locale = resolveLocale(options.locale);
  const readOnly = options.readOnly === true;

  let currentDoc: BoardDocument = options.document
    ? toSnapshot(options.document)
    : deepFreeze(createEmptyDocument());
  let camera: CameraState = Object.freeze({ x: 0, y: 0, zoom: 1 });

  return {
    readOnly,
    locale,
    getDocument(): Readonly<BoardDocument> {
      return currentDoc;
    },
    loadDocument(doc: BoardDocument): void {
      currentDoc = toSnapshot(doc);
    },
    getElement(id: string): Readonly<ElementRecord> | undefined {
      const rec = currentDoc.records[id];
      return rec?.kind === 'element' ? rec : undefined;
    },
    getCamera(): Readonly<CameraState> {
      return camera;
    },
    setCamera(patch: Partial<CameraState>): void {
      const pick = (next: number | undefined, prev: number): number =>
        next !== undefined && Number.isFinite(next) ? next : prev;
      const zoom = pick(patch.zoom, camera.zoom);
      camera = Object.freeze({
        x: pick(patch.x, camera.x),
        y: pick(patch.y, camera.y),
        zoom: Math.min(zoomRange.max, Math.max(zoomRange.min, zoom)),
      });
    },
    dispose(): void {
      // Pembersihan listener & state
    },
  };
}
