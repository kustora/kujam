/**
 * Kontrak elemen (`defineElement`) dan registri tipe elemen (BOARD-601).
 *
 * Elemen bawaan (`@kujam/shapes`) dan elemen kustom memakai API yang sama. Registri berdiri
 * sendiri, belum tersambung ke `createBoard`: pemasangan lewat plugin milik BOARD-602/211,
 * validasi `create`/`update` milik BOARD-205, dan migrasi props saat memuat milik BOARD-702.
 */

import type { Geometry } from './geometry.js';
import type { InferShape, ObjectSchema, SchemaResult, SchemaShape } from './schema.js';
import { object, validate } from './schema.js';
import type { ElementRecord } from './types.js';

// ---------- Konteks render dan callback ----------

/**
 * Konteks gambar 2D yang diterima `render.canvas`.
 *
 * Subset struktural `CanvasRenderingContext2D` agar core tetap tanpa tipe DOM: konteks asli dari
 * `<canvas>` atau `OffscreenCanvas` bisa langsung diberikan tanpa adaptor. Renderer boleh memberi
 * objek dengan helper tambahan (BOARD-1204); anggota yang ada di sini tidak akan dihapus.
 *
 * @public
 */
export interface ElementCanvasContext {
  globalAlpha: number;
  globalCompositeOperation: string;
  /** String warna CSS, atau gradien/pola milik renderer. */
  fillStyle: string | object;
  /** String warna CSS, atau gradien/pola milik renderer. */
  strokeStyle: string | object;
  lineWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'bevel' | 'miter' | 'round';
  font: string;
  textAlign: 'center' | 'end' | 'left' | 'right' | 'start';
  textBaseline: 'alphabetic' | 'bottom' | 'hanging' | 'ideographic' | 'middle' | 'top';
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(fillRule?: 'evenodd' | 'nonzero'): void;
  stroke(): void;
  clip(fillRule?: 'evenodd' | 'nonzero'): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { readonly width: number };
  setLineDash(segments: number[]): void;
}

/**
 * Wadah DOM untuk `render.html`. Core tidak memakai tipe DOM, jadi antarmuka ini kosong dan
 * diperluas lewat declaration merging oleh package yang punya DOM (misalnya `@kujam/renderer`:
 * `interface ElementHtmlHost extends HTMLElement {}`). Saat runtime nilainya elemen DOM.
 *
 * @beta
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- titik perluasan untuk declaration merging
export interface ElementHtmlHost {}

/**
 * Keadaan tingkat detail saat `render.canvas` dipanggil.
 *
 * @public
 */
export interface ElementLodState {
  /** Zoom kamera saat ini (1 = 100%). */
  readonly zoom: number;
  /** `true` bila elemen digambar dalam versi ringkas (di bawah `lod.compactBelowZoom`). */
  readonly compact: boolean;
}

/**
 * Konteks yang diberikan board ke callback elemen (`onDoubleClick`, `a11y`, `actions`,
 * `render.html`). Anggota baru boleh ditambahkan tanpa dianggap perubahan yang merusak.
 *
 * @public
 */
export interface ElementContext {
  /** Bahasa UI board (misalnya `'id'` atau `'en'`), untuk label a11y dan teks bawaan. */
  readonly locale: string;
  /**
   * Memancarkan event `action` yang bisa didengar aplikasi (BOARD-605).
   *
   * @beta
   */
  emit(name: string, payload?: unknown): void;
}

/**
 * Status kegagalan resolver data dari luar (BOARD-604).
 *
 * @beta
 */
export type ResolveErrorStatus = 'forbidden' | 'not-found' | 'error';

/**
 * Nilai yang dikembalikan resolver bila data tidak bisa diberikan (BOARD-604).
 *
 * @beta
 */
export interface ResolveError {
  readonly status: ResolveErrorStatus;
  readonly message?: string;
}

/**
 * Hasil `resolve`: data sinkron dari cache, {@link ResolveError}, atau janji salah satunya.
 *
 * @beta
 */
export type ResolveResult<D> = D | ResolveError | PromiseLike<D | ResolveError>;

/**
 * Konteks untuk `resolve`. Peta resolver diisi aplikasi lewat `createBoard({ resolvers })`
 * (BOARD-604); tipenya akan dipersempit oleh BOARD-607.
 *
 * @beta
 */
export interface ElementResolveContext {
  readonly resolvers: Readonly<Record<string, (id: string) => unknown>>;
}

// ---------- Bagian kontrak ----------

/**
 * Mode resize bawaan yang dipahami transformasi elemen (BOARD-406).
 *
 * @public
 */
export type ElementResizeMode = 'free' | 'fixed-ratio' | 'none';

/**
 * Ukuran elemen dalam satuan papan.
 *
 * @public
 */
export interface ElementSize {
  readonly w: number;
  readonly h: number;
}

/**
 * Resize kustom: menerima ukuran usulan dari handle dan mengembalikan ukuran yang dipakai,
 * misalnya untuk ukuran minimum atau hanya mengubah lebar.
 *
 * @public
 */
// Trik "bivariance" (method signature) agar definisi spesifik tetap bisa ditampung sebagai
// AnyElementDefinition, misalnya di daftar `elements` milik plugin.
export type ElementResizeHandler<P> = {
  bivarianceHack(el: ElementRecord<P>, proposed: ElementSize): ElementSize;
}['bivarianceHack'];

/**
 * Perilaku resize elemen: salah satu {@link ElementResizeMode} atau fungsi kustom.
 *
 * @public
 */
export type ElementResize<P> = ElementResizeMode | ElementResizeHandler<P>;

/**
 * Tampilan HTML yang dikembalikan `render.html`.
 *
 * @beta
 */
export interface ElementHtmlView<P, D> {
  /** Dipanggil saat record atau data resolver berubah. */
  update(el: ElementRecord<P>, data: D | undefined): void;
  /** Dipanggil saat elemen keluar viewport, dihapus, atau renderer di-unmount. */
  destroy(): void;
}

/**
 * Cara elemen digambar. Elemen boleh memakai salah satu atau keduanya.
 *
 * @public
 */
export interface ElementRenderers<P, D> {
  /**
   * Menggambar elemen di Canvas 2D dalam koordinat lokal elemen: renderer sudah menerapkan
   * translasi `x, y`, rotasi, dan opasitas sebelum memanggil. `data` selalu `undefined` bila
   * elemen tidak punya `resolve`.
   */
  canvas?(
    g: ElementCanvasContext,
    el: ElementRecord<P>,
    data: D | undefined,
    lod: ElementLodState,
  ): void;
  /**
   * Merender elemen sebagai DOM di lapisan HTML (BOARD-1201).
   *
   * @beta
   */
  html?(
    host: ElementHtmlHost,
    el: ElementRecord<P>,
    data: D | undefined,
    ctx: ElementContext,
  ): ElementHtmlView<P, D>;
}

/**
 * Pengaturan tingkat detail (BOARD-1204).
 *
 * @beta
 */
export interface ElementLod {
  /** Di bawah zoom ini elemen digambar ringkas lewat `render.canvas` dan DOM-nya dilepas. */
  readonly compactBelowZoom: number;
}

/**
 * Peran dan label aksesibilitas elemen (pohon a11y BOARD-1901).
 *
 * @public
 */
export interface ElementA11y {
  /** Peran ARIA, misalnya `'note'`, `'img'`, atau `'article'`. */
  readonly role: string;
  /** Label yang dibacakan, misalnya `'Sticky kuning: Ide rapat'`. */
  readonly label: string;
  readonly description?: string;
}

/**
 * Pengekspor per elemen.
 *
 * @public
 */
export interface ElementExporters<P, D> {
  /** Teks polos elemen untuk ekspor teks dan pencarian. */
  text?(el: ElementRecord<P>, data: D | undefined): string;
  /**
   * Potongan SVG elemen dalam koordinat lokal (BOARD-1212).
   *
   * @beta
   */
  svg?(el: ElementRecord<P>, data: D | undefined): string;
}

/**
 * Satu aksi untuk toolbar kontekstual dan menu klik kanan (BOARD-605).
 *
 * @beta
 */
export interface ElementAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly group?: string;
  isEnabled?(): boolean;
  run(): void;
}

/**
 * Isi placeholder saat data tidak tersedia (BOARD-1202).
 *
 * @beta
 */
export interface ElementPlaceholder {
  readonly label: string;
}

/**
 * Satu langkah migrasi props dari versi `n` ke `n + 1`. Wajib murni: tidak memutasi input.
 *
 * @public
 */
export type ElementPropsMigration = (props: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrasi props per versi tipe. Kunci `n` memigrasi props versi `n` ke `n + 1`; kunci wajib
 * bilangan bulat `0` sampai `version - 1`. Versi tanpa langkah dianggap tidak mengubah props.
 * Dijalankan saat memuat dokumen oleh BOARD-702.
 *
 * @public
 */
export type ElementMigrations = Readonly<Record<number, ElementPropsMigration>>;

/**
 * Definisi tipe elemen. Dibuat dengan {@link defineElement}.
 *
 * `T` adalah nama tipe, `S` bentuk skema props, dan `D` tipe data dari `resolve`
 * (`undefined` bila elemen tidak memakai data dari luar).
 *
 * @public
 */
export interface ElementDefinition<
  T extends string = string,
  S extends SchemaShape = SchemaShape,
  D = unknown,
> {
  /** Nama tipe yang disimpan di `ElementRecord.type`. Unik per registri, tanpa spasi. */
  readonly type: T;
  /** Versi skema props, bilangan bulat mulai 1. Naikkan setiap props berubah tidak kompatibel. */
  readonly version: number;
  /** Skema props (ADR-007). Objek ketat: kunci yang tidak dikenal ditolak. */
  readonly props: ObjectSchema<S>;
  /** Nilai props bawaan untuk elemen baru. Setiap nilai harus lolos skema kuncinya. */
  readonly defaults?: Partial<InferShape<S>>;
  /** Geometri lokal untuk hit-test, snap, dan seleksi. Bila tidak ada, dipakai kotak `w × h`. */
  geometry?(el: ElementRecord<InferShape<S>>): Geometry;
  /** Perilaku resize; bawaan `'free'`. */
  readonly resize?: ElementResize<InferShape<S>>;
  /** Cara menggambar elemen. */
  readonly render?: ElementRenderers<InferShape<S>, D>;
  /** Dipanggil saat elemen diklik dua kali, misalnya untuk masuk mode edit. */
  onDoubleClick?(el: ElementRecord<InferShape<S>>, ctx: ElementContext): void;
  /** Migrasi props dari versi lama; lihat {@link ElementMigrations}. */
  readonly migrate?: ElementMigrations;
  /** Peran dan label aksesibilitas. */
  a11y?(el: ElementRecord<InferShape<S>>, data: D | undefined, ctx: ElementContext): ElementA11y;
  /** Pengekspor elemen. */
  readonly export?: ElementExporters<InferShape<S>, D>;
  /**
   * Mengambil data dari luar; package tidak menyimpan data ini di dokumen (BOARD-604).
   *
   * @beta
   */
  resolve?(el: ElementRecord<InferShape<S>>, ctx: ElementResolveContext): ResolveResult<D>;
  /**
   * Pengaturan tingkat detail (BOARD-1204).
   *
   * @beta
   */
  readonly lod?: ElementLod;
  /**
   * Aksi kontekstual elemen (BOARD-605).
   *
   * @beta
   */
  actions?(
    el: ElementRecord<InferShape<S>>,
    data: D | undefined,
    ctx: ElementContext,
  ): readonly ElementAction[];
  /**
   * Placeholder saat resolver gagal (BOARD-1202).
   *
   * @beta
   */
  placeholder?(reason: ResolveErrorStatus): ElementPlaceholder;
}

/**
 * Definisi elemen apa pun, untuk menampung banyak tipe sekaligus (registri, daftar plugin).
 *
 * @public
 */
export type AnyElementDefinition = ElementDefinition<string, SchemaShape, unknown>;

/**
 * Tipe props dari sebuah definisi elemen.
 *
 * @example
 * ```ts
 * type StickyProps = ElementPropsOf<typeof stickyElement>;
 * ```
 *
 * @public
 */
export type ElementPropsOf<E> =
  E extends ElementDefinition<string, infer S, infer _D> ? InferShape<S> : never;

/**
 * Tipe data untuk callback dari tipe kembalian `resolve`: `Promise` dibuka dan
 * {@link ResolveError} dibuang. `undefined` bila elemen tidak punya `resolve`.
 *
 * @beta
 */
export type ResolvedData<R> = Exclude<Awaited<R>, ResolveError>;

// ---------- Error ----------

/**
 * Kode {@link ElementDefinitionError}.
 *
 * @public
 */
export type ElementDefinitionErrorCode = 'invalid-definition' | 'duplicate-type';

/**
 * Error saat definisi elemen tidak valid atau tipenya sudah terdaftar.
 *
 * @public
 */
export class ElementDefinitionError extends Error {
  readonly code: ElementDefinitionErrorCode;
  /** Tipe elemen yang bermasalah, atau `undefined` bila `type` sendiri tidak valid. */
  readonly type: string | undefined;
  /** Daftar masalah definisi; kosong untuk `duplicate-type`. */
  readonly errors: readonly string[];

  constructor(
    code: ElementDefinitionErrorCode,
    message: string,
    type: string | undefined,
    errors: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ElementDefinitionError';
    this.code = code;
    this.type = type;
    this.errors = errors;
  }
}

// ---------- Validasi definisi ----------

const RESIZE_MODES: readonly string[] = ['free', 'fixed-ratio', 'none'];
const MIGRATION_KEY = /^(0|[1-9]\d*)$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkFunctions(
  owner: Record<string, unknown>,
  prefix: string,
  keys: readonly string[],
  errors: string[],
): void {
  for (const key of keys) {
    if (owner[key] !== undefined && typeof owner[key] !== 'function') {
      errors.push(`${prefix}${key} wajib berupa fungsi.`);
    }
  }
}

function isObjectSchema(value: unknown): value is ObjectSchema<SchemaShape> {
  return (
    isPlainObject(value) &&
    value.kind === 'object' &&
    isPlainObject(value.shape) &&
    typeof value._check === 'function'
  );
}

/**
 * Memeriksa `defaults` terhadap skema props tanpa menuntut kunci wajib yang tidak diberi default.
 *
 * Skema objek ADR-007 memeriksa setiap kunci secara mandiri (tidak ada aturan lintas kunci),
 * sehingga memvalidasi sub-skema yang hanya memuat kunci-kunci di `defaults` setara dengan
 * memvalidasi `{ ...nilaiWajibApaPun, ...defaults }`: bila semua kunci wajib nanti diisi dengan
 * nilai valid, gabungannya pasti valid. Kunci yang tidak ada di skema tetap ditolak
 * (`unknown_key`) karena sub-skema juga objek ketat.
 */
function checkDefaults(props: ObjectSchema<SchemaShape>, defaults: unknown, errors: string[]) {
  if (!isPlainObject(defaults)) {
    errors.push('defaults wajib berupa objek.');
    return;
  }
  const subShape: SchemaShape = {};
  for (const key of Object.keys(defaults)) {
    if (Object.prototype.hasOwnProperty.call(props.shape, key)) subShape[key] = props.shape[key]!;
  }
  const result = validate(object(subShape), defaults);
  if (!result.ok) {
    for (const issue of result.issues) {
      const path = issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('');
      errors.push(`defaults${path} tidak lolos skema props (${issue.code}: ${issue.message}).`);
    }
  }
}

function checkMigrations(migrate: unknown, version: unknown, errors: string[]): void {
  if (!isPlainObject(migrate)) {
    errors.push('migrate wajib berupa objek { [versiAsal]: fungsi }.');
    return;
  }
  const max = Number.isInteger(version) ? (version as number) - 1 : undefined;
  for (const [key, step] of Object.entries(migrate)) {
    if (!MIGRATION_KEY.test(key) || (max !== undefined && Number(key) > max)) {
      errors.push(
        `migrate["${key}"]: kunci wajib bilangan bulat 0 sampai version - 1` +
          (max !== undefined && max >= 0 ? ` (${max}).` : '.'),
      );
    }
    if (typeof step !== 'function') errors.push(`migrate["${key}"] wajib berupa fungsi.`);
  }
}

/** Mengumpulkan semua masalah sebuah definisi elemen. Daftar kosong berarti valid. */
function collectElementDefinitionErrors(definition: unknown): string[] {
  if (!isPlainObject(definition)) return ['Definisi elemen wajib berupa objek.'];
  const def = definition;
  const errors: string[] = [];

  if (typeof def.type !== 'string' || def.type.length === 0 || /\s/.test(def.type)) {
    errors.push('type wajib berupa string tidak kosong tanpa spasi.');
  }
  if (!Number.isInteger(def.version) || (def.version as number) < 1) {
    errors.push('version wajib berupa bilangan bulat mulai 1.');
  }
  if (!isObjectSchema(def.props)) {
    errors.push('props wajib berupa skema objek dari schema() atau object().');
  } else if (def.defaults !== undefined) {
    checkDefaults(def.props, def.defaults, errors);
  }

  checkFunctions(
    def,
    '',
    ['geometry', 'onDoubleClick', 'a11y', 'resolve', 'actions', 'placeholder'],
    errors,
  );

  if (
    def.resize !== undefined &&
    typeof def.resize !== 'function' &&
    !RESIZE_MODES.includes(def.resize as string)
  ) {
    errors.push(`resize wajib salah satu dari ${RESIZE_MODES.join(', ')}, atau fungsi.`);
  }
  if (def.render !== undefined) {
    if (isPlainObject(def.render))
      checkFunctions(def.render, 'render.', ['canvas', 'html'], errors);
    else errors.push('render wajib berupa objek { canvas?, html? }.');
  }
  if (def.export !== undefined) {
    if (isPlainObject(def.export)) checkFunctions(def.export, 'export.', ['text', 'svg'], errors);
    else errors.push('export wajib berupa objek { text?, svg? }.');
  }
  if (def.migrate !== undefined) checkMigrations(def.migrate, def.version, errors);
  if (def.lod !== undefined) {
    const zoom = isPlainObject(def.lod) ? def.lod.compactBelowZoom : undefined;
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom <= 0) {
      errors.push('lod.compactBelowZoom wajib berupa angka lebih dari 0.');
    }
  }
  return errors;
}

function assertValidDefinition(definition: unknown): void {
  const errors = collectElementDefinitionErrors(definition);
  if (errors.length === 0) return;
  const type =
    isPlainObject(definition) && typeof definition.type === 'string' && definition.type
      ? definition.type
      : undefined;
  throw new ElementDefinitionError(
    'invalid-definition',
    `Definisi elemen${type ? ` "${type}"` : ''} tidak valid: ${errors.join(' ')}`,
    type,
    errors,
  );
}

// ---------- defineElement ----------

/**
 * Mendefinisikan tipe elemen. Dipakai elemen bawaan maupun elemen kustom.
 *
 * Tipe `props` diinferensi dari skema, sehingga `el.props` bertipe tepat di semua callback dan
 * `defaults` diperiksa sebagai `Partial<props>`. Definisi divalidasi segera (lihat
 * {@link ElementDefinitionError}) dan objeknya dibekukan dangkal.
 *
 * @example
 * ```ts
 * const card = defineElement({
 *   type: 'contact-card',
 *   version: 1,
 *   props: schema({ refId: string(), size: enumOf(['s', 'm', 'l']) }),
 *   defaults: { size: 'm' },
 *   geometry: (el) => rect(el.w, el.h),
 *   resize: 'fixed-ratio',
 *   a11y: (el) => ({ role: 'article', label: `Kontak ${el.props.refId}` }),
 *   export: { text: (el) => el.props.refId },
 * });
 * ```
 *
 * @throws {@link ElementDefinitionError} dengan kode `invalid-definition`.
 * @public
 */
export function defineElement<const T extends string, S extends SchemaShape, R = undefined>(
  definition: ElementDefinition<T, S, ResolvedData<R>> & {
    resolve?(el: ElementRecord<InferShape<S>>, ctx: ElementResolveContext): R;
  },
): ElementDefinition<T, S, ResolvedData<R>> {
  assertValidDefinition(definition);
  return Object.freeze(definition);
}

// ---------- Registri ----------

/**
 * Registri tipe elemen milik satu board atau satu set plugin. Tidak ada state global.
 *
 * Tipe yang tidak terdaftar tetap boleh ada di dokumen (ditampilkan sebagai placeholder dan
 * datanya tidak hilang); registri hanya melaporkan `get(type)` → `undefined`.
 *
 * @public
 */
export interface ElementRegistry {
  /**
   * Mendaftarkan definisi. Melempar {@link ElementDefinitionError} dengan kode
   * `duplicate-type` bila tipenya sudah terdaftar, atau `invalid-definition` bila tidak valid.
   */
  register(definition: AnyElementDefinition): void;
  /** Definisi untuk tipe, atau `undefined` bila tidak terdaftar. */
  get(type: string): AnyElementDefinition | undefined;
  has(type: string): boolean;
  /** Semua definisi sesuai urutan pendaftaran. */
  list(): readonly AnyElementDefinition[];
  /**
   * Memvalidasi props terhadap skema tipe tanpa mengubah nilai. Mengembalikan `undefined` bila
   * tipe tidak terdaftar, sehingga pemanggil memutuskan sendiri: memuat dokumen membiarkan
   * datanya, sedangkan membuat elemen baru sebaiknya menolak.
   */
  validateElementProps(
    type: string,
    props: unknown,
  ): SchemaResult<Record<string, unknown>> | undefined;
}

/**
 * Membuat registri tipe elemen, opsional dengan definisi awal (didaftarkan berurutan).
 *
 * @example
 * ```ts
 * const registry = createElementRegistry(defaultElements);
 * registry.register(card);
 * const result = registry.validateElementProps('contact-card', { refId: 'k1', size: 'm' });
 * ```
 *
 * @public
 */
export function createElementRegistry(
  definitions: Iterable<AnyElementDefinition> = [],
): ElementRegistry {
  const byType = new Map<string, AnyElementDefinition>();

  const registry: ElementRegistry = {
    register(definition) {
      assertValidDefinition(definition);
      if (byType.has(definition.type)) {
        throw new ElementDefinitionError(
          'duplicate-type',
          `Tipe elemen "${definition.type}" sudah terdaftar. Setiap tipe hanya boleh didaftarkan ` +
            'sekali; pakai nama tipe lain atau pastikan plugin yang sama tidak dipasang dua kali.',
          definition.type,
        );
      }
      byType.set(definition.type, definition);
    },
    get: (type) => byType.get(type),
    has: (type) => byType.has(type),
    list: () => Object.freeze([...byType.values()]),
    validateElementProps(type, props) {
      const definition = byType.get(type);
      return definition ? validate(definition.props, props) : undefined;
    },
  };

  for (const definition of definitions) registry.register(definition);
  return registry;
}
