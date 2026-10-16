/**
 * `@kujam/core` — Inti papan tulis agnostik tanpa DOM dan tanpa dependensi runtime.
 *
 * @packageDocumentation
 */

import { deepClone } from './clone.js';
import {
  createEmitter,
  reportUnhandled,
  type BoardErrorCode,
  type BoardEventMap,
  type Listener,
  type Unsubscribe,
} from './events.js';
import {
  createLocalHistory,
  resolveHistoryLimit,
  type BoardHistory,
  type HistoryOptions,
} from './history.js';
import { createId as createRandomId, type IdGenerator } from './ids.js';
import { createRecordStore, type TransactOptions, type Transaction } from './store.js';
import type { BoardDocument, CameraState, ElementRecord } from './types.js';
import { CURRENT_SCHEMA_VERSION } from './types.js';
import { InvalidDocumentError, validateDocument } from './validate.js';

export * from './types.js';
export { deepClone } from './clone.js';
export { InvalidDocumentError, validateDocument, type ValidationResult } from './validate.js';
export * from './schema.js';
export * from './elements.js';
export * from './geometry.js';
export { createId, DEFAULT_ID_LENGTH, type IdGenerator } from './ids.js';
export { compareIndex, indexAbove, indexBelow, indexBetween, indicesBetween } from './indexing.js';
export type {
  ActionEvent,
  BoardErrorCode,
  BoardErrorEvent,
  BoardEventMap,
  CameraEvent,
  Listener,
  SelectionEvent,
  ToolEvent,
  Unsubscribe,
} from './events.js';
export {
  DEFAULT_HISTORY_LIMIT,
  type BoardHistory,
  type HistoryEvent,
  type HistoryOptions,
} from './history.js';
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
  /** Opsi riwayat undo lokal, misalnya `{ limit: 50 }`. Bawaan 200 langkah. */
  history?: HistoryOptions;
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
  /**
   * Mendengarkan event papan (lihat {@link BoardEventMap}). Mengembalikan fungsi untuk berhenti
   * mendengarkan. Listener yang melempar tidak menghentikan listener lain dan tidak membuat
   * pemanggil (misalnya `transact`) melempar; error-nya dipancarkan sebagai event `error`
   * berkode `listener-error`.
   */
  on<K extends keyof BoardEventMap>(type: K, listener: Listener<BoardEventMap[K]>): Unsubscribe;
  /** Membuat ID record baru memakai opsi `createId` (bawaan nanoid). */
  createId(): string;
  /** Snapshot kamera yang dibekukan. */
  getCamera(): Readonly<CameraState>;
  /**
   * Mengubah kamera. Nilai yang tidak berhingga diabaikan, dan zoom dijepit ke `zoomRange`.
   * Memancarkan event `camera` bila kamera benar-benar berubah.
   */
  setCamera(patch: Partial<CameraState>): void;
  /**
   * Membatalkan langkah lokal terakhir: kebalikan diff-nya diterapkan sebagai transaksi berasal
   * `'undo'` dengan label transaksi aslinya. Record yang sudah diubah pihak lain (misalnya
   * `remote`) sejak langkah itu dilewati; langkah yang tidak bisa dibalik sama sekali dibuang dan
   * undo lanjut ke langkah sebelumnya.
   *
   * @returns `true` bila ada perubahan yang diterapkan, `false` bila tidak ada yang bisa di-undo
   *   (termasuk selalu pada papan `readOnly`, karena riwayatnya selalu kosong).
   * @throws `Error` bila dipanggil di dalam `transact` atau setelah `dispose`.
   */
  undo(): boolean;
  /**
   * Menerapkan ulang langkah yang terakhir di-undo, sebagai transaksi berasal `'redo'`. Aturan
   * konflik, nilai kembali, dan error sama dengan {@link Board.undo}.
   */
  redo(): boolean;
  /**
   * Status riwayat undo. Hanya transaksi berasal `'local'` yang dicatat; perubahan lokal baru
   * membuang tumpukan redo; `loadDocument` dan migrasi mengosongkan riwayat. Perubahan
   * `canUndo`/`canRedo` dipancarkan lewat event `history`.
   */
  readonly history: BoardHistory;
  /** Mode baca saja (lihat {@link CreateBoardOptions.readOnly}). */
  readonly readOnly: boolean;
  readonly locale: BoardLocale;
  /**
   * Melepas semua listener dan mengosongkan riwayat. Setelahnya `transact`, `loadDocument`,
   * `undo`, dan `redo` melempar error.
   */
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
  const historyLimit = resolveHistoryLimit(options.history);
  let disposed = false;

  const events = createEmitter<BoardEventMap>((type, error) => {
    const message = `Listener event "${String(type)}" melempar error.`;
    // Error dari listener `error` sendiri, atau tanpa listener `error`, tidak dipancarkan ulang
    // (mencegah rekursi tak terbatas) tetapi juga tidak ditelan diam-diam.
    if (type === 'error' || !events.has('error')) {
      reportUnhandled(`[kujam] ${message}`, error);
      return;
    }
    emitError('listener-error', message, error, type);
  });

  function emitError(
    code: BoardErrorCode,
    message: string,
    cause: unknown,
    eventType?: keyof BoardEventMap,
  ): void {
    events.emit('error', Object.freeze({ code, message, cause, eventType }));
  }

  const store = createRecordStore(
    options.document ? toOwnedDocument(options.document) : createEmptyDocument(),
    {
      freeze,
      readOnly,
      onChange: (event) => {
        // Riwayat diperbarui dulu agar listener `change` membaca canUndo/canRedo yang baru.
        history.observe(event);
        events.emit('change', event);
        history.flush();
      },
    },
  );
  const history = createLocalHistory(store, {
    limit: historyLimit,
    onStateChange: (state) => events.emit('history', state),
  });
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
    undo(): boolean {
      return history.undo();
    },
    redo(): boolean {
      return history.redo();
    },
    history: history.api,
    getCamera(): Readonly<CameraState> {
      return camera;
    },
    setCamera(patch: Partial<CameraState>): void {
      const pick = (next: number | undefined, prev: number): number =>
        next !== undefined && Number.isFinite(next) ? next : prev;
      const previous = camera;
      const next = {
        x: pick(patch.x, previous.x),
        y: pick(patch.y, previous.y),
        zoom: Math.min(zoomRange.max, Math.max(zoomRange.min, pick(patch.zoom, previous.zoom))),
      };
      if (next.x === previous.x && next.y === previous.y && next.zoom === previous.zoom) return;
      camera = Object.freeze(next);
      events.emit('camera', Object.freeze({ camera, previous }));
    },
    dispose(): void {
      disposed = true;
      events.clear();
      history.dispose();
      store.dispose();
    },
  };
}
