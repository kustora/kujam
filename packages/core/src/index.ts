/**
 * `@kujam/core` — Inti papan tulis agnostik tanpa DOM dan tanpa dependensi runtime.
 *
 * @packageDocumentation
 */

import { deepClone } from './clone.js';
import { createCommandRegistry, type BoardCommands } from './commands.js';
import { createElementRegistry, type ElementRegistry, type ResolveResult } from './elements.js';
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
import { createInteraction } from './interaction.js';
import {
  createPluginRuntime,
  type AnyPluginDefinition,
  type BoardPlugins,
  type BoardUser,
  type PermissionHook,
} from './plugins.js';
import { createRecordStore, type TransactOptions, type Transaction } from './store.js';
import {
  createToolRuntime,
  DEFAULT_TOOL_ID,
  type BoardInputEvent,
  type BoardTools,
} from './tools.js';
import {
  createElementRecord,
  deleteElementRecords,
  updateElementRecord,
  type DeleteOptions,
  type ElementPatch,
  type MutateOptions,
  type MutationContext,
  type PartialElement,
  type UpdateOptions,
} from './mutate.js';
import type { BoardDocument, CameraState, ElementRecord } from './types.js';
import { CURRENT_SCHEMA_VERSION } from './types.js';
import { InvalidDocumentError, validateDocument } from './validate.js';

export * from './types.js';
export { deepClone } from './clone.js';
export { InvalidDocumentError, validateDocument, type ValidationResult } from './validate.js';
export * from './schema.js';
export * from './elements.js';
export * from './geometry.js';
export {
  definePlugin,
  PluginError,
  resolvePluginOrder,
  type AnyPluginDefinition,
  type BoardPlugins,
  type BoardUser,
  type DocumentSavedHook,
  type PermissionAction,
  type PermissionHook,
  type PluginBrushDefinition,
  type PluginCommandMapEntry,
  type PluginCommandsInput,
  type PluginDefinition,
  type PluginDocumentMigration,
  type PluginErrorCode,
  type PluginExporter,
  type PluginMigrations,
  type PluginSetup,
  type PluginTeardown,
  type PluginToolbarItem,
} from './plugins.js';
export {
  CommandError,
  defineCommand,
  type AnyCommandDefinition,
  type BoardCommands,
  type CommandDefinition,
  type CommandErrorCode,
} from './commands.js';
export {
  DEFAULT_TOOL_ID,
  defineTool,
  HAND_TOOL_ID,
  ToolError,
  type AnyToolDefinition,
  type BoardInputEvent,
  type BoardTools,
  type InputModifiers,
  type PointerKind,
  type ToolContext,
  type ToolDefinition,
  type ToolErrorCode,
  type ToolKeyEvent,
  type ToolPinchEvent,
  type ToolPointerEvent,
  type ToolStateDefinition,
  type ToolWheelEvent,
} from './tools.js';
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
export {
  type DeleteOptions,
  type ElementPatch,
  type MutateOptions,
  type PartialElement,
  type UpdateOptions,
} from './mutate.js';

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
 * Fungsi pengambil data luar per ID (BOARD-604).
 *
 * @beta
 */
export type BoardResolver<D = unknown> = (id: string) => ResolveResult<D>;

/**
 * Peta nama resolver ke fungsi pengambil data luar (BOARD-211, BOARD-604).
 *
 * @beta
 */
export type BoardResolvers = Readonly<Record<string, BoardResolver>>;

/**
 * Adapter resolusi dan unggah aset media untuk elemen gambar (BOARD-211, BOARD-1103).
 *
 * @beta
 */
export interface AssetAdapter {
  /** Mengembalikan URL aset (sinkron atau async), atau `null`/`undefined` bila tidak tersedia. */
  resolve(assetId: string): string | null | undefined | PromiseLike<string | null | undefined>;
  /** Mengunggah berkas/blob aset dan mengembalikan `assetId` baru. */
  upload?(file: unknown): string | PromiseLike<string>;
}

/**
 * Batas ukuran dan jumlah entitas di papan (BOARD-005, BOARD-210, BOARD-211).
 *
 * @public
 */
export interface BoardLimits {
  /** Ukuran maksimum dokumen ter-serialisasi dalam byte. Bawaan 10 MB (`10_485_760`). */
  readonly maxDocumentBytes: number;
  /** Jumlah maksimum elemen per papan. Bawaan `5_000`. */
  readonly maxElements: number;
  /** Jumlah maksimum titik per elemen coretan (`draw`). Bawaan `5_000`. */
  readonly maxDrawPoints: number;
}

/**
 * Nilai batas bawaan papan: 10 MB dokumen, 5.000 elemen, 5.000 titik per coretan.
 *
 * @public
 */
export const DEFAULT_BOARD_LIMITS: Readonly<BoardLimits> = Object.freeze({
  maxDocumentBytes: 10 * 1024 * 1024,
  maxElements: 5_000,
  maxDrawPoints: 5_000,
});

/**
 * Opsi pembuatan instance `Board` (BOARD-211).
 *
 * @public
 */
export interface CreateBoardOptions {
  /** Dokumen awal papan; bila kosong dibuat dokumen baru dengan satu halaman (`page:main`). */
  document?: BoardDocument;
  /**
   * Daftar plugin yang dipasang secara deterministik berdasarkan urutan dan `dependsOn`
   * (BOARD-602). Misalnya `[defaultElements, defaultTools]`.
   */
  plugins?: Iterable<AnyPluginDefinition>;
  /**
   * Peta nama resolver ke fungsi pengambil data luar untuk elemen kustom (BOARD-604).
   *
   * @beta
   */
  resolvers?: BoardResolvers;
  /**
   * Adapter resolusi URL dan unggah berkas aset gambar (BOARD-1103).
   *
   * @beta
   */
  assets?: AssetAdapter;
  /**
   * Identitas pengguna lokal untuk kolaborasi dan pemeriksaan izin (BOARD-212).
   *
   * @beta
   */
  user?: BoardUser | null;
  /**
   * Mode baca saja. Perubahan dokumen lokal ditolak; kamera dan seleksi tetap bisa diubah,
   * dan `loadDocument` tetap diizinkan untuk menerima dokumen dari server.
   */
  readOnly?: boolean;
  /** Bahasa UI. Bawaan `'id'`. */
  locale?: BoardLocale;
  /**
   * Batas ukuran dokumen, jumlah elemen, dan titik coretan (BOARD-210). Nilai yang tidak diisi
   * memakai {@link DEFAULT_BOARD_LIMITS}.
   */
  limits?: Partial<BoardLimits>;
  /**
   * Hook izin tingkat aplikasi; digabung secara logika AND dengan hook izin dari plugin
   * (BOARD-212).
   *
   * @beta
   */
  permissions?: PermissionHook;
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
  /**
   * Tool tujuan saat Esc ditekan di state awal dan setelah tool `oneShot` selesai. Bawaan
   * {@link DEFAULT_TOOL_ID} (`'select'`). Board mulai tanpa tool aktif; panggil `setTool`.
   *
   * @beta
   */
  defaultTool?: string;
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
  /**
   * Membuat elemen baru dengan nilai bawaan dan menyimpannya ke dokumen (BOARD-205).
   *
   * @returns Record elemen baru, atau `undefined` bila ditolak (misalnya props tidak lolos
   *   skema tipe atau batas maksimum elemen tercapai).
   * @beta
   */
  create<P = Record<string, unknown>>(
    element: PartialElement<P>,
    options?: MutateOptions,
  ): Readonly<ElementRecord<P>> | undefined;
  /**
   * Memperbarui elemen yang sudah ada dengan patch sebagian (BOARD-205). Props digabung per kunci.
   *
   * @returns Record elemen yang diperbarui, atau `undefined` bila elemen tidak ditemukan, sedang
   *   terkunci (tanpa `force`), atau props baru tidak lolos skema tipe.
   * @beta
   */
  update<P = Record<string, unknown>>(
    id: string,
    patch: ElementPatch<P>,
    options?: UpdateOptions,
  ): Readonly<ElementRecord<P>> | undefined;
  /**
   * Menghapus elemen beserta anak-anak (frame/grup) dan binding yang menempel (BOARD-205).
   *
   * @returns Daftar ID record yang berhasil dihapus.
   * @beta
   */
  delete(ids: string | Iterable<string>, options?: DeleteOptions): readonly string[];
  /** Record elemen dengan ID tersebut, atau `undefined` bila tidak ada atau bukan elemen. */
  getElement<P = Record<string, unknown>>(id: string): Readonly<ElementRecord<P>> | undefined;
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
   *   (termasuk selalu pada papan `readOnly`, karena riwayatnya selalu kosong). Bila tool sedang
   *   di tengah interaksi, undo hanya membatalkan interaksi itu dan mengembalikan `true`.
   * @throws `Error` bila dipanggil di dalam `transact` atau setelah `dispose`.
   */
  undo(): boolean;
  /**
   * Menerapkan ulang langkah yang terakhir di-undo, sebagai transaksi berasal `'redo'`. Aturan
   * konflik, nilai kembali, dan error sama dengan {@link Board.undo}. Interaksi tool yang sedang
   * berlangsung dibatalkan dulu.
   */
  redo(): boolean;
  /**
   * Status riwayat undo. Hanya transaksi berasal `'local'` yang dicatat; perubahan lokal baru
   * membuang tumpukan redo; `loadDocument` dan migrasi mengosongkan riwayat. Perubahan
   * `canUndo`/`canRedo` dipancarkan lewat event `history`.
   */
  readonly history: BoardHistory;
  /**
   * Menjalankan perintah terdaftar (BOARD-503).
   *
   * @returns `true` bila perintah dijalankan, `false` bila `isEnabled` menolak.
   * @throws {@link CommandError} berkode `unknown-command` bila ID tidak terdaftar, atau `Error`
   *   setelah `dispose`. Error dari `isEnabled` atau `run` diteruskan apa adanya.
   */
  run(id: string, args?: unknown): boolean;
  /** Registri perintah papan ini: sumber command palette dan shortcut. */
  readonly commands: BoardCommands;
  /** Registri tipe elemen papan ini (BOARD-601, BOARD-602). */
  readonly elements: ElementRegistry;
  /** Registri plugin yang terpasang di papan ini sesuai urutan pemasangan (BOARD-602). */
  readonly plugins: BoardPlugins;
  /**
   * Registri tool papan ini (BOARD-501).
   *
   * @beta
   */
  readonly tools: BoardTools;
  /**
   * Mengaktifkan tool. Interaksi tool sebelumnya dibatalkan (rollback). Memancarkan event `tool`
   * bila tool berganti.
   *
   * @throws `ToolError` berkode `unknown-tool` bila ID tidak terdaftar.
   * @beta
   */
  setTool(id: string): void;
  /**
   * ID tool aktif, atau `null` bila belum ada.
   *
   * @beta
   */
  readonly tool: string | null;
  /**
   * State tool aktif (misalnya `'idle'`), atau `null` bila belum ada tool aktif.
   *
   * @beta
   */
  readonly toolState: string | null;
  /**
   * Kursor CSS untuk state tool saat ini. Renderer membacanya setelah `dispatch`.
   *
   * @beta
   */
  readonly cursor: string;
  /**
   * Mengirim event input ternormalisasi dari renderer ke tool aktif.
   *
   * @returns `true` bila event ditangani (renderer sebaiknya memanggil `preventDefault`).
   * @throws `Error` setelah `dispose`. Error dari handler tool diteruskan setelah interaksinya
   *   di-rollback.
   * @beta
   */
  dispatch(event: BoardInputEvent): boolean;
  /** Mode baca saja (lihat {@link CreateBoardOptions.readOnly}). */
  readonly readOnly: boolean;
  readonly locale: BoardLocale;
  /**
   * Peta resolver data eksternal untuk elemen kustom (BOARD-211, BOARD-604).
   *
   * @beta
   */
  readonly resolvers: BoardResolvers;
  /**
   * Adapter resolusi URL dan unggah aset media (BOARD-211, BOARD-1103).
   *
   * @beta
   */
  readonly assets: Readonly<AssetAdapter> | null;
  /**
   * Identitas pengguna lokal (BOARD-211, BOARD-212).
   *
   * @beta
   */
  readonly user: Readonly<BoardUser> | null;
  /**
   * Batas ukuran dokumen, jumlah elemen, dan titik coretan (BOARD-210, BOARD-211).
   *
   * @public
   */
  readonly limits: Readonly<BoardLimits>;
  /**
   * Hook izin aplikasi lokal (BOARD-211, BOARD-212).
   *
   * @beta
   */
  readonly permissions: PermissionHook | null;
  /**
   * Menandakan apakah papan sudah dibuang dengan {@link Board.dispose}.
   *
   * @public
   */
  readonly disposed: boolean;
  /**
   * Menjalankan teardown plugin dalam urutan terbalik lalu melepas semua listener, perintah, tool,
   * dan riwayat. Aman dipanggil lebih dari sekali. Setelahnya `transact`, `loadDocument`, `undo`,
   * `redo`, `run`, `setTool`, dan `dispatch` melempar error.
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOptionsObject(options: unknown): void {
  if (options !== undefined && !isPlainObject(options)) {
    throw new TypeError('Opsi createBoard wajib berupa objek.');
  }
}

function resolveReadOnly(readOnly: unknown): boolean {
  if (readOnly === undefined) return false;
  if (typeof readOnly === 'boolean') return readOnly;
  throw new TypeError('Opsi readOnly wajib berupa boolean.');
}

function resolveResolvers(resolvers: unknown): BoardResolvers {
  if (resolvers === undefined) return Object.freeze({});
  if (!isPlainObject(resolvers)) {
    throw new TypeError('Opsi resolvers wajib berupa objek.');
  }
  for (const [key, fn] of Object.entries(resolvers)) {
    if (typeof fn !== 'function') {
      throw new TypeError(`Resolver "${key}" wajib berupa fungsi.`);
    }
  }
  return Object.freeze({ ...resolvers }) as BoardResolvers;
}

function resolveAssets(assets: unknown): Readonly<AssetAdapter> | null {
  if (assets === undefined || assets === null) return null;
  if (!isPlainObject(assets)) {
    throw new TypeError('Opsi assets wajib berupa objek.');
  }
  if (typeof assets.resolve !== 'function') {
    throw new TypeError('Adapter assets wajib memiliki method "resolve" berupa fungsi.');
  }
  if (assets.upload !== undefined && typeof assets.upload !== 'function') {
    throw new TypeError('Method "upload" pada adapter assets wajib berupa fungsi.');
  }
  return Object.freeze({
    resolve: assets.resolve as AssetAdapter['resolve'],
    ...(assets.upload !== undefined ? { upload: assets.upload as AssetAdapter['upload'] } : {}),
  });
}

function resolveUser(user: unknown): Readonly<BoardUser> | null {
  if (user === undefined || user === null) return null;
  if (!isPlainObject(user)) {
    throw new TypeError('Opsi user wajib berupa objek.');
  }
  if (typeof user.id !== 'string' || user.id.trim().length === 0) {
    throw new TypeError('user.id wajib berupa string tidak kosong.');
  }
  if (user.name !== undefined && typeof user.name !== 'string') {
    throw new TypeError('user.name wajib berupa string.');
  }
  if (user.color !== undefined && typeof user.color !== 'string') {
    throw new TypeError('user.color wajib berupa string.');
  }
  if (user.meta !== undefined && !isPlainObject(user.meta)) {
    throw new TypeError('user.meta wajib berupa objek.');
  }
  return Object.freeze({
    id: user.id,
    ...(user.name !== undefined ? { name: user.name } : {}),
    ...(user.color !== undefined ? { color: user.color } : {}),
    meta: Object.freeze({ ...(user.meta as Record<string, unknown> | undefined) }),
  });
}

function resolveLimits(limits: unknown): Readonly<BoardLimits> {
  if (limits === undefined) return DEFAULT_BOARD_LIMITS;
  if (!isPlainObject(limits)) {
    throw new TypeError('Opsi limits wajib berupa objek.');
  }
  const checkInt = (key: keyof BoardLimits, val: unknown, def: number): number => {
    if (val === undefined) return def;
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
      throw new RangeError(`limits.${key} wajib berupa bilangan bulat positif (>= 1).`);
    }
    return val;
  };
  return Object.freeze({
    maxDocumentBytes: checkInt(
      'maxDocumentBytes',
      limits.maxDocumentBytes,
      DEFAULT_BOARD_LIMITS.maxDocumentBytes,
    ),
    maxElements: checkInt('maxElements', limits.maxElements, DEFAULT_BOARD_LIMITS.maxElements),
    maxDrawPoints: checkInt(
      'maxDrawPoints',
      limits.maxDrawPoints,
      DEFAULT_BOARD_LIMITS.maxDrawPoints,
    ),
  });
}

function resolvePermissions(permissions: unknown): PermissionHook | null {
  if (permissions === undefined || permissions === null) return null;
  if (typeof permissions !== 'function') {
    throw new TypeError('Opsi permissions wajib berupa fungsi.');
  }
  return permissions as PermissionHook;
}

/**
 * Membuat instance `Board` baru tanpa ketergantungan DOM.
 *
 * @public
 */
export function createBoard(options: CreateBoardOptions = {}): Board {
  assertOptionsObject(options);
  const zoomRange = resolveZoomRange(options.zoomRange);
  const locale = resolveLocale(options.locale);
  const readOnly = resolveReadOnly(options.readOnly);
  const resolvers = resolveResolvers(options.resolvers);
  const assets = resolveAssets(options.assets);
  const user = resolveUser(options.user);
  const limits = resolveLimits(options.limits);
  const permissions = resolvePermissions(options.permissions);

  const freeze = options.freezeSnapshots !== false;
  const generateId = resolveIdGenerator(options.createId);
  const defaultTool = options.defaultTool ?? DEFAULT_TOOL_ID;
  if (typeof defaultTool !== 'string') throw new TypeError('Opsi defaultTool wajib berupa string.');
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
        // Transaksi interaksi tool dicatat sebagai satu langkah saat interaksi selesai.
        if (interaction.capturing) interaction.observe(event);
        // Riwayat diperbarui dulu agar listener `change` membaca canUndo/canRedo yang baru.
        else history.observe(event);
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
  const elements = createElementRegistry();
  const commands = createCommandRegistry(() => board);
  const interaction = createInteraction(store, history);
  const tools = createToolRuntime({
    getBoard: () => board,
    interaction,
    defaultTool,
    onToolChange: (id, previous) => events.emit('tool', Object.freeze({ id, previous })),
  });
  const plugins = createPluginRuntime({
    getBoard: () => board,
    elements,
    tools: tools.api,
    commands: commands.api,
    plugins: options.plugins,
  });

  function assertUsable(): void {
    if (disposed) throw new Error('Papan sudah di-dispose.');
  }

  const mutationCtx: MutationContext = {
    getDocument: () => store.getDocument(),
    getElement: (id) => board.getElement(id),
    transact: (fn, txOpts) => store.transact(fn, txOpts),
    elements,
    limits,
    createId: () => board.createId(),
    emitError,
    assertUsable,
  };

  const board: Board = {
    readOnly,
    locale,
    resolvers,
    assets,
    user,
    limits,
    permissions,
    get disposed(): boolean {
      return disposed;
    },
    create(element, opts) {
      assertUsable();
      return createElementRecord(mutationCtx, element, opts);
    },
    update(id, patch, opts) {
      assertUsable();
      return updateElementRecord(mutationCtx, id, patch, opts);
    },
    delete(ids, opts) {
      assertUsable();
      return deleteElementRecords(mutationCtx, ids, opts);
    },
    getDocument(): Readonly<BoardDocument> {
      return store.getDocument();
    },
    loadDocument(doc: BoardDocument): void {
      assertUsable();
      const owned = toOwnedDocument(doc);
      // Diff interaksi yang berlangsung tidak berlaku untuk dokumen baru.
      tools.reset();
      store.replaceDocument(owned, 'load');
    },
    getElement<P = Record<string, unknown>>(id: string): Readonly<ElementRecord<P>> | undefined {
      const rec = store.getRecord(id);
      return rec?.kind === 'element' ? (rec as unknown as Readonly<ElementRecord<P>>) : undefined;
    },
    transact<T>(fn: (tx: Transaction) => T, txOptions?: TransactOptions): T {
      assertUsable();
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
      assertUsable();
      if (tools.busy) return tools.cancel();
      return history.undo();
    },
    redo(): boolean {
      assertUsable();
      tools.cancel();
      return history.redo();
    },
    history: history.api,
    run(id: string, args?: unknown): boolean {
      assertUsable();
      return commands.run(id, args);
    },
    commands: commands.api,
    elements,
    plugins: plugins.api,
    tools: tools.api,
    setTool(id: string): void {
      assertUsable();
      tools.setTool(id);
    },
    get tool() {
      return tools.tool;
    },
    get toolState() {
      return tools.state;
    },
    get cursor() {
      return tools.cursor;
    },
    dispatch(event: BoardInputEvent): boolean {
      assertUsable();
      return tools.dispatch(event);
    },
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
      if (disposed) return;
      try {
        plugins.dispose();
      } finally {
        disposed = true;
        events.clear();
        commands.clear();
        tools.clear();
        history.dispose();
        store.dispose();
      }
    },
  };

  plugins.install();
  return board;
}
