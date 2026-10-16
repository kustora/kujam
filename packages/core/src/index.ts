/**
 * `@kujam/core` — Inti papan tulis agnostik tanpa DOM dan tanpa dependensi runtime.
 *
 * @packageDocumentation
 */

import { deepClone } from './clone.js';
import { createEmitter, type Listener, type Unsubscribe } from './events.js';
import { createId as createRandomId, type IdGenerator } from './ids.js';
import {
  createRecordStore,
  type ChangeEvent,
  type TransactOptions,
  type Transaction,
} from './store.js';
import type { BoardDocument, CameraState, ElementRecord } from './types.js';
import { CURRENT_SCHEMA_VERSION } from './types.js';
import { InvalidDocumentError, validateDocument } from './validate.js';

export * from './types.js';
export { deepClone } from './clone.js';
export { InvalidDocumentError, validateDocument, type ValidationResult } from './validate.js';
export * from './schema.js';
export { createId, DEFAULT_ID_LENGTH, type IdGenerator } from './ids.js';
export { compareIndex, indexAbove, indexBelow, indexBetween, indicesBetween } from './indexing.js';
export type { Listener, Unsubscribe } from './events.js';
export {
  CHANGE_ORIGINS,
  ReadOnlyBoardError,
  type ChangeEvent,
  type ChangeOrigin,
  type RecordUpdate,
  type RecordsDiff,
  type TransactOptions,
  type Transaction,
} from './store.js';

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
  /**
   * Membekukan snapshot (`Object.freeze` dalam) sehingga mutasi tidak sengaja langsung
   * melempar `TypeError`. Bawaan `true` (mode development, aman).
   *
   * Dengan `false` (mode produksi), snapshot tetap memakai structural sharing tetapi tidak
   * dibekukan, sehingga transaksi sedikit lebih murah pada dokumen besar. Kontraknya tetap
   * sama: snapshot tidak boleh diubah; mengubahnya merusak state papan tanpa peringatan.
   * Core tidak membaca `process.env`, jadi pemakai menentukan sendiri, misalnya
   * `freezeSnapshots: import.meta.env.DEV`.
   */
  freezeSnapshots?: boolean;
  /**
   * Pembuat ID record. Bawaan {@link createId} (nanoid). Ganti dengan pembuat berurutan
   * untuk tes deterministik.
   */
  createId?: IdGenerator;
}

/**
 * Peta nama event ke isi event untuk `board.on`. Event lain (`selection`, `camera`, `tool`,
 * `action`, `error`) menyusul di BOARD-207.
 *
 * @public
 */
export interface BoardEventMap {
  /** Satu event per transaksi yang menghasilkan perubahan bersih, dan per `loadDocument`. */
  change: ChangeEvent;
}

/**
 * Antarmuka publik instance `Board`.
 *
 * @public
 */
export interface Board {
  /**
   * Snapshot dokumen saat ini. Objek snapshot baru dibuat per transaksi; record yang tidak
   * berubah tetap objek yang sama (structural sharing). Dibekukan bila `freezeSnapshots` aktif.
   */
  getDocument(): Readonly<BoardDocument>;
  /**
   * Mengganti seluruh dokumen sebagai satu transaksi berasal `'load'` dan memancarkan satu event
   * `change` berisi diff terhadap dokumen lama. Diizinkan juga saat `readOnly`.
   * Melempar {@link InvalidDocumentError} bila tidak valid (state tidak berubah).
   */
  loadDocument(doc: BoardDocument): void;
  /** Record elemen dengan ID tersebut, atau `undefined` bila tidak ada atau bukan elemen. */
  getElement(id: string): Readonly<ElementRecord> | undefined;
  /**
   * Menjalankan `fn` sebagai satu transaksi dan mengembalikan hasilnya.
   *
   * - Transaksi bersarang digabung ke transaksi terluar (opsinya diabaikan). Bila `fn` dalam
   *   melempar, hanya perubahannya yang dibatalkan, lalu error diteruskan ke transaksi luar.
   * - Bila `fn` melempar, semua perubahan dibatalkan dan error dilempar ulang.
   * - Saat selesai, satu event `change` dipancarkan bila ada perubahan bersih.
   * - `fn` wajib sinkron.
   *
   * @throws {@link ReadOnlyBoardError} bila papan `readOnly` dan origin `'local'`.
   */
  transact<T>(fn: (tx: Transaction) => T, options?: TransactOptions): T;
  /** Mendengarkan event papan. Mengembalikan fungsi untuk berhenti mendengarkan. */
  on<K extends keyof BoardEventMap>(type: K, listener: Listener<BoardEventMap[K]>): Unsubscribe;
  /** Membuat ID record baru memakai opsi `createId` (bawaan nanoid). */
  createId(): string;
  /** Snapshot kamera yang dibekukan. */
  getCamera(): Readonly<CameraState>;
  /**
   * Mengubah kamera. Nilai yang tidak berhingga diabaikan, dan zoom dijepit ke `zoomRange`.
   */
  setCamera(patch: Partial<CameraState>): void;
  /** Mode baca saja (lihat {@link CreateBoardOptions.readOnly}). */
  readonly readOnly: boolean;
  readonly locale: BoardLocale;
  /** Melepas semua listener. Setelahnya `transact` dan `loadDocument` melempar error. */
  dispose(): void;
}

/**
 * Membuat dokumen papan kosong dengan satu halaman bawaan (`page:main`).
 *
 * @param meta - Metadata bebas milik pemakai; disalin dangkal dan tidak pernah diubah package.
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

/** Memvalidasi lalu menyalin dokumen masukan agar tidak terhubung dengan state papan. */
function toOwnedDocument(doc: BoardDocument): BoardDocument {
  const result = validateDocument(doc);
  if (!result.valid) {
    throw new InvalidDocumentError(result.errors);
  }
  return deepClone(doc);
}

function resolveIdGenerator(generator: unknown): IdGenerator {
  if (generator === undefined) return () => createRandomId();
  if (typeof generator === 'function') return generator as IdGenerator;
  throw new TypeError('Opsi createId wajib berupa fungsi.');
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

  const freeze = options.freezeSnapshots !== false;
  const generateId = resolveIdGenerator(options.createId);
  const events = createEmitter<BoardEventMap>();
  let disposed = false;

  const store = createRecordStore(
    options.document ? toOwnedDocument(options.document) : createEmptyDocument(),
    { freeze, readOnly, onChange: (event) => events.emit('change', event) },
  );
  let camera: CameraState = Object.freeze({ x: 0, y: 0, zoom: 1 });

  return {
    readOnly,
    locale,
    getDocument(): Readonly<BoardDocument> {
      return store.getDocument();
    },
    loadDocument(doc: BoardDocument): void {
      store.replaceDocument(toOwnedDocument(doc), 'load');
    },
    getElement(id: string): Readonly<ElementRecord> | undefined {
      const rec = store.getRecord(id);
      return rec?.kind === 'element' ? rec : undefined;
    },
    transact<T>(fn: (tx: Transaction) => T, txOptions?: TransactOptions): T {
      return store.transact(fn, txOptions);
    },
    on(type, listener) {
      if (disposed) return () => {};
      return events.on(type, listener);
    },
    createId(): string {
      const id = generateId();
      if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('createId wajib menghasilkan string tidak kosong.');
      }
      return id;
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
      disposed = true;
      events.clear();
      store.dispose();
    },
  };
}
