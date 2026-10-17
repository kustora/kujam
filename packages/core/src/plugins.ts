/**
 * Sistem plugin (`definePlugin`) dan pemasangan plugin deterministik (BOARD-602).
 *
 * Plugin adalah satu-satunya cara mendaftarkan bundel elemen, tool, kuas, perintah, shortcut,
 * item toolbar, eksportir, migrasi dokumen, hook izin, hook simpan dokumen, dan efek siklus hidup
 * (`setup(board) => teardown`). Elemen dan tool bawaan dari `@kujam/shapes` (`defaultElements`,
 * `defaultTools`) menggunakan API yang sama tanpa jalur pintas internal.
 */

import {
  defineCommand,
  type AnyCommandDefinition,
  type BoardCommands,
  type CommandError,
} from './commands.js';
import {
  defineElement,
  type AnyElementDefinition,
  type ElementDefinitionError,
  type ElementRegistry,
} from './elements.js';
import type { Board } from './index.js';
import { defineTool, type AnyToolDefinition, type BoardTools, type ToolError } from './tools.js';
import type { BoardDocument, ElementRecord } from './types.js';

// ---------- Titik ekstensi plugin ----------

/**
 * Definisi kuas coretan yang dibawa plugin (BOARD-603).
 *
 * @beta
 */
export interface PluginBrushDefinition {
  /** ID unik kuas, misalnya `'pen'` atau `'highlighter'`. */
  readonly id: string;
  /** Kunci i18n atau label tampilan kuas. */
  readonly label?: string;
  /** Opsi pembentukan garis (size, thinning, smoothing, streamline, taper). */
  readonly strokeOptions?: Readonly<Record<string, unknown>>;
  /** Mode komposit Canvas, misalnya `'multiply'` untuk stabilo. */
  readonly blend?: string;
}

/**
 * Satu item tambahan di toolbar utama dari plugin (BOARD-1402).
 *
 * @beta
 */
export interface PluginToolbarItem {
  /** ID unik item toolbar. */
  readonly id: string;
  /** Kunci i18n atau label untuk tooltip dan pembaca layar. */
  readonly label: string;
  /** Nama atau markup ikon opsional. */
  readonly icon?: string;
  /** ID tool yang diaktifkan saat item dipilih. */
  readonly toolId?: string;
  /** ID perintah yang dijalankan saat item diklik. */
  readonly commandId?: string;
  /** Kelompok penempatan di toolbar. */
  readonly group?: string;
  /** Urutan relatif di dalam kelompok. */
  readonly order?: number;
}

/**
 * Pengekspor format tambahan dari plugin (BOARD-1707).
 *
 * @beta
 */
export interface PluginExporter {
  /** Nama format ekspor, misalnya `'pdf'` atau `'markdown'`. */
  readonly format: string;
  /** Kunci i18n atau label format. */
  readonly label?: string;
  /** Fungsi pengekspor yang menerima instance `Board` publik. */
  export(board: Board, options?: unknown): unknown;
}

/**
 * Satu langkah migrasi dokumen milik plugin dari versi `n` ke `n + 1` (BOARD-702).
 * Wajib murni: tidak memutasi input.
 *
 * @beta
 */
export type PluginDocumentMigration = (doc: BoardDocument) => BoardDocument;

/**
 * Peta langkah migrasi dokumen milik plugin per versi asal (`0`, `1`, ...).
 * Dijalankan setelah migrasi skema inti (BOARD-702).
 *
 * @beta
 */
export type PluginMigrations = Readonly<Record<number, PluginDocumentMigration>>;

/**
 * Jenis operasi yang diperiksa hook izin (BOARD-212).
 *
 * @beta
 */
export type PermissionAction = 'create' | 'update' | 'delete' | 'action' | (string & {});

/**
 * Identitas pengguna papan untuk kolaborasi dan pemeriksaan izin (BOARD-211, BOARD-212).
 *
 * @beta
 */
export interface BoardUser {
  readonly id: string;
  readonly name?: string;
  readonly color?: string;
  readonly role?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Hook izin untuk memeriksa apakah aksi terhadap elemen diizinkan (BOARD-212).
 * Mengembalikan `false` untuk membatalkan operasi dan memancarkan event `error` berkode `'forbidden'`.
 *
 * @remarks
 * **PENTING — Keamanan & Penegakan Izin:**
 * Hook ini berjalan sepenuhnya di sisi klien (in-memory) dan dirancang semata-mata untuk kenyamanan UI
 * (seperti menonaktifkan tombol aksi, menyembunyikan menu kontekstual, atau membatalkan operasi lokal sebelum
 * dikirim ke jaringan). Hook ini **TIDAK** memberikan jaminan keamanan. Penegakan otorisasi dan kontrol akses
 * yang sesungguhnya **WAJIB** ditegakkan di sisi server (misalnya saat memvalidasi pembaruan Yjs atau endpoint
 * API penyimpanan). Klien tidak boleh dipercaya.
 *
 * @beta
 */
export type PermissionHook = (
  action: PermissionAction,
  element: Readonly<ElementRecord> | null,
  user: Readonly<BoardUser> | null,
) => boolean;

/**
 * Hook yang dipanggil setelah dokumen berhasil disimpan oleh adapter storage (BOARD-1210).
 *
 * @beta
 */
export type DocumentSavedHook = (doc: Readonly<BoardDocument>) => void | PromiseLike<void>;

/**
 * Fungsi pembersih yang dikembalikan `setup(board)` dan dijalankan saat `board.dispose()`.
 *
 * @public
 */
export type PluginTeardown = () => void;

/**
 * Hook inisialisasi plugin saat dipasang ke `board`. Hanya menerima antarmuka publik {@link Board}.
 *
 * @public
 */
export type PluginSetup = (board: Board) => PluginTeardown | void;

/**
 * Entri perintah saat `commands` ditulis sebagai objek peta `{ [id]: entri }`:
 * boleh berupa {@link AnyCommandDefinition}, objek `{ label?, isEnabled?, run }`, atau langsung
 * fungsi `(board, args) => void` (dengan `label` bawaan sama dengan kunci `id`).
 *
 * @public
 */
export type PluginCommandMapEntry =
  | AnyCommandDefinition
  | {
      readonly id?: string;
      readonly label?: string;
      readonly isEnabled?: (board: Board, args: unknown) => boolean;
      readonly run: (board: Board, args: unknown) => void;
    }
  | ((board: Board, args?: unknown) => void);

/**
 * Bentuk deklarasi `commands` di dalam plugin: daftar {@link AnyCommandDefinition} atau peta
 * `{ [id]: entri }`.
 *
 * @public
 */
export type PluginCommandsInput =
  readonly AnyCommandDefinition[] | Readonly<Record<string, PluginCommandMapEntry>>;

// ---------- Definisi plugin ----------

/**
 * Definisi plugin papan. Dibuat dengan {@link definePlugin}.
 *
 * @typeParam Id - Tipe literal ID plugin.
 * @typeParam Elements - Koleksi definisi elemen yang dibawa plugin.
 * @typeParam Tools - Koleksi definisi tool yang dibawa plugin.
 *
 * @public
 */
export interface PluginDefinition<
  Id extends string = string,
  Elements extends readonly AnyElementDefinition[] = readonly AnyElementDefinition[],
  Tools extends readonly AnyToolDefinition[] = readonly AnyToolDefinition[],
> {
  /** ID unik plugin: huruf kecil, angka, titik, atau tanda hubung (misalnya `'default-elements'`). */
  readonly id: Id;
  /** Daftar ID plugin lain yang wajib dipasang sebelum plugin ini. */
  readonly dependsOn?: readonly string[];
  /** Definisi tipe elemen yang didaftarkan ke `board.elements`. */
  readonly elements?: Elements;
  /** Definisi tool yang didaftarkan ke `board.tools`. */
  readonly tools?: Tools;
  /**
   * Definisi kuas coretan tambahan (BOARD-603).
   *
   * @beta
   */
  readonly brushes?: readonly PluginBrushDefinition[];
  /** Perintah yang didaftarkan ke `board.commands`. */
  readonly commands?: PluginCommandsInput;
  /**
   * Peta shortcut keyboard ke ID perintah atau `'tool:<id>'` (BOARD-504).
   *
   * @beta
   */
  readonly keybindings?: Readonly<Record<string, string>>;
  /**
   * Item tambahan untuk toolbar utama (BOARD-1402).
   *
   * @beta
   */
  readonly toolbarItems?: readonly PluginToolbarItem[];
  /**
   * Eksportir format tambahan (BOARD-1707).
   *
   * @beta
   */
  readonly exporters?: readonly PluginExporter[];
  /**
   * Migrasi dokumen tingkat plugin (BOARD-702).
   *
   * @beta
   */
  readonly migrations?: PluginMigrations;
  /**
   * Hook pemeriksaan izin operasi (BOARD-212).
   *
   * @beta
   */
  readonly permissions?: PermissionHook;
  /**
   * Hook setelah dokumen disimpan adapter storage (BOARD-1210).
   *
   * @beta
   */
  readonly onDocumentSaved?: DocumentSavedHook;
  /**
   * Inisialisasi saat plugin dipasang ke `board`. Boleh mengembalikan fungsi `teardown` yang akan
   * dipanggil saat `board.dispose()` dalam urutan terbalik dari pemasangan.
   */
  readonly setup?: PluginSetup;
}

/**
 * Definisi plugin apa pun, untuk menampung berbagai plugin di koleksi atau opsi `createBoard`.
 *
 * @public
 */
export type AnyPluginDefinition = PluginDefinition<
  string,
  readonly AnyElementDefinition[],
  readonly AnyToolDefinition[]
>;

// ---------- Error ----------

/**
 * Kode {@link PluginError}.
 *
 * - `invalid-plugin`: definisi plugin tidak valid atau `setup` mengembalikan nilai bukan fungsi.
 * - `duplicate-plugin`: dua plugin dengan `id` yang sama dipasang di satu board.
 * - `missing-dependency`: plugin di `dependsOn` tidak ikut dipasang.
 * - `circular-dependency`: ada siklus di grafik `dependsOn`.
 *
 * @public
 */
export type PluginErrorCode =
  'invalid-plugin' | 'duplicate-plugin' | 'missing-dependency' | 'circular-dependency';

/**
 * Error saat mendefinisikan atau memasang plugin.
 *
 * @public
 */
export class PluginError extends Error {
  readonly code: PluginErrorCode;
  /** ID plugin yang bermasalah, atau `undefined` bila `id` sendiri tidak valid. */
  readonly pluginId: string | undefined;
  /** Daftar masalah validasi; kosong selain untuk `invalid-plugin`. */
  readonly errors: readonly string[];

  constructor(
    code: PluginErrorCode,
    message: string,
    pluginId: string | undefined,
    errors: readonly string[] = [],
  ) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.pluginId = pluginId;
    this.errors = errors;
  }
}

// ---------- Validasi dan normalisasi ----------

const PLUGIN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MIGRATION_KEY = /^(0|[1-9]\d*)$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkPluginIdList(dependsOn: unknown, errors: string[]): void {
  if (!Array.isArray(dependsOn)) {
    errors.push('dependsOn wajib berupa array ID plugin.');
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < dependsOn.length; i++) {
    const dep = dependsOn[i];
    if (typeof dep !== 'string' || !PLUGIN_ID.test(dep)) {
      errors.push(`dependsOn[${i}] wajib berupa ID plugin yang valid.`);
      continue;
    }
    if (seen.has(dep)) {
      errors.push(`dependsOn[${i}] ("${dep}") duplikat di dalam plugin yang sama.`);
    }
    seen.add(dep);
  }
}

function checkElements(elements: unknown, errors: string[]): void {
  if (!Array.isArray(elements)) {
    errors.push('elements wajib berupa array definisi elemen.');
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < elements.length; i++) {
    const item = elements[i];
    try {
      defineElement(item as AnyElementDefinition);
      const type = (item as AnyElementDefinition).type;
      if (seen.has(type)) {
        errors.push(`elements[${i}]: tipe elemen "${type}" duplikat di dalam plugin yang sama.`);
      }
      seen.add(type);
    } catch (error) {
      for (const msg of (error as ElementDefinitionError).errors) {
        errors.push(`elements[${i}]: ${msg}`);
      }
    }
  }
}

function checkTools(tools: unknown, errors: string[]): void {
  if (!Array.isArray(tools)) {
    errors.push('tools wajib berupa array definisi tool.');
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < tools.length; i++) {
    const item = tools[i];
    try {
      defineTool(item as AnyToolDefinition);
      const id = (item as AnyToolDefinition).id;
      if (seen.has(id)) {
        errors.push(`tools[${i}]: tool "${id}" duplikat di dalam plugin yang sama.`);
      }
      seen.add(id);
    } catch (error) {
      for (const msg of (error as ToolError).errors) {
        errors.push(`tools[${i}]: ${msg}`);
      }
    }
  }
}

/**
 * Mengubah deklarasi `commands` (array atau peta objek) menjadi daftar {@link AnyCommandDefinition}
 * tervalidasi, sambil mengumpulkan pesan error bila ada yang tidak valid.
 */
function normalizeCommands(commands: unknown, errors: string[]): AnyCommandDefinition[] {
  const result: AnyCommandDefinition[] = [];
  const seen = new Set<string>();

  const pushValidated = (candidate: unknown, prefix: string) => {
    try {
      const defined = defineCommand(candidate as AnyCommandDefinition);
      if (seen.has(defined.id)) {
        errors.push(`${prefix}: perintah "${defined.id}" duplikat di dalam plugin yang sama.`);
        return;
      }
      seen.add(defined.id);
      result.push(defined);
    } catch (error) {
      for (const msg of (error as CommandError).errors) {
        errors.push(`${prefix}: ${msg}`);
      }
    }
  };

  if (Array.isArray(commands)) {
    for (let i = 0; i < commands.length; i++) {
      pushValidated(commands[i], `commands[${i}]`);
    }
    return result;
  }

  if (!isPlainObject(commands)) {
    errors.push(
      'commands wajib berupa array definisi perintah atau objek peta { [id]: perintah }.',
    );
    return result;
  }

  for (const [key, entry] of Object.entries(commands)) {
    const prefix = `commands["${key}"]`;
    if (typeof entry === 'function') {
      pushValidated({ id: key, label: key, run: entry }, prefix);
    } else if (isPlainObject(entry)) {
      if (entry.id !== undefined && entry.id !== key) {
        errors.push(`${prefix}: id "${String(entry.id)}" tidak sama dengan kunci "${key}".`);
        continue;
      }
      pushValidated(
        {
          id: key,
          label: entry.label === undefined ? key : entry.label,
          ...(entry.isEnabled !== undefined ? { isEnabled: entry.isEnabled } : {}),
          run: entry.run,
        },
        prefix,
      );
    } else {
      errors.push(`${prefix}: wajib berupa fungsi atau objek definisi perintah.`);
    }
  }
  return result;
}

function checkBrushes(brushes: unknown, errors: string[]): void {
  if (!Array.isArray(brushes)) {
    errors.push('brushes wajib berupa array definisi kuas.');
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < brushes.length; i++) {
    const item = brushes[i];
    if (!isPlainObject(item)) {
      errors.push(`brushes[${i}] wajib berupa objek.`);
      continue;
    }
    if (typeof item.id !== 'string' || !PLUGIN_ID.test(item.id)) {
      errors.push(`brushes[${i}].id wajib berupa string ID yang valid.`);
    } else if (seen.has(item.id)) {
      errors.push(`brushes[${i}]: kuas "${item.id}" duplikat di dalam plugin yang sama.`);
    } else {
      seen.add(item.id);
    }
    if (item.label !== undefined && (typeof item.label !== 'string' || item.label.length === 0)) {
      errors.push(`brushes[${i}].label wajib berupa string tidak kosong.`);
    }
    if (item.strokeOptions !== undefined && !isPlainObject(item.strokeOptions)) {
      errors.push(`brushes[${i}].strokeOptions wajib berupa objek.`);
    }
    if (item.blend !== undefined && (typeof item.blend !== 'string' || item.blend.length === 0)) {
      errors.push(`brushes[${i}].blend wajib berupa string tidak kosong.`);
    }
  }
}

function checkKeybindings(keybindings: unknown, errors: string[]): void {
  if (!isPlainObject(keybindings)) {
    errors.push('keybindings wajib berupa objek { [shortcut]: target }.');
    return;
  }
  for (const [shortcut, target] of Object.entries(keybindings)) {
    if (shortcut.trim().length === 0) {
      errors.push('keybindings tidak boleh memakai kunci shortcut kosong.');
    }
    if (typeof target !== 'string' || target.trim().length === 0) {
      errors.push(`keybindings["${shortcut}"] wajib berupa string target tidak kosong.`);
    }
  }
}

function checkToolbarItems(toolbarItems: unknown, errors: string[]): void {
  if (!Array.isArray(toolbarItems)) {
    errors.push('toolbarItems wajib berupa array item toolbar.');
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < toolbarItems.length; i++) {
    const item = toolbarItems[i];
    if (!isPlainObject(item)) {
      errors.push(`toolbarItems[${i}] wajib berupa objek.`);
      continue;
    }
    if (typeof item.id !== 'string' || item.id.trim().length === 0) {
      errors.push(`toolbarItems[${i}].id wajib berupa string tidak kosong.`);
    } else if (seen.has(item.id)) {
      errors.push(`toolbarItems[${i}]: id "${item.id}" duplikat di dalam plugin yang sama.`);
    } else {
      seen.add(item.id);
    }
    if (typeof item.label !== 'string' || item.label.trim().length === 0) {
      errors.push(`toolbarItems[${i}].label wajib berupa string tidak kosong.`);
    }
    for (const key of ['icon', 'toolId', 'commandId', 'group'] as const) {
      if (item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length === 0)) {
        errors.push(`toolbarItems[${i}].${key} wajib berupa string tidak kosong.`);
      }
    }
    if (
      item.order !== undefined &&
      (typeof item.order !== 'number' || !Number.isFinite(item.order))
    ) {
      errors.push(`toolbarItems[${i}].order wajib berupa angka berhingga.`);
    }
  }
}

function checkExporters(exporters: unknown, errors: string[]): void {
  if (!Array.isArray(exporters)) {
    errors.push('exporters wajib berupa array definisi eksportir.');
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < exporters.length; i++) {
    const item = exporters[i];
    if (!isPlainObject(item)) {
      errors.push(`exporters[${i}] wajib berupa objek.`);
      continue;
    }
    if (typeof item.format !== 'string' || item.format.trim().length === 0) {
      errors.push(`exporters[${i}].format wajib berupa string tidak kosong.`);
    } else if (seen.has(item.format)) {
      errors.push(`exporters[${i}]: format "${item.format}" duplikat di dalam plugin yang sama.`);
    } else {
      seen.add(item.format);
    }
    if (item.label !== undefined && (typeof item.label !== 'string' || item.label.length === 0)) {
      errors.push(`exporters[${i}].label wajib berupa string tidak kosong.`);
    }
    if (typeof item.export !== 'function') {
      errors.push(`exporters[${i}].export wajib berupa fungsi.`);
    }
  }
}

function checkMigrations(migrations: unknown, errors: string[]): void {
  if (!isPlainObject(migrations)) {
    errors.push('migrations wajib berupa objek { [versiAsal]: fungsi }.');
    return;
  }
  for (const [key, step] of Object.entries(migrations)) {
    if (!MIGRATION_KEY.test(key)) {
      errors.push(`migrations["${key}"]: kunci wajib bilangan bulat mulai 0.`);
    }
    if (typeof step !== 'function') {
      errors.push(`migrations["${key}"] wajib berupa fungsi.`);
    }
  }
}

function collectPluginErrors(definition: unknown): string[] {
  if (!isPlainObject(definition)) return ['Definisi plugin wajib berupa objek.'];
  const errors: string[] = [];

  if (typeof definition.id !== 'string' || !PLUGIN_ID.test(definition.id)) {
    errors.push(
      'id wajib huruf kecil, angka, titik, atau tanda hubung (misalnya "default-elements").',
    );
  }
  if (definition.dependsOn !== undefined) checkPluginIdList(definition.dependsOn, errors);
  if (definition.elements !== undefined) checkElements(definition.elements, errors);
  if (definition.tools !== undefined) checkTools(definition.tools, errors);
  if (definition.commands !== undefined) normalizeCommands(definition.commands, errors);
  if (definition.brushes !== undefined) checkBrushes(definition.brushes, errors);
  if (definition.keybindings !== undefined) checkKeybindings(definition.keybindings, errors);
  if (definition.toolbarItems !== undefined) checkToolbarItems(definition.toolbarItems, errors);
  if (definition.exporters !== undefined) checkExporters(definition.exporters, errors);
  if (definition.migrations !== undefined) checkMigrations(definition.migrations, errors);

  for (const fnKey of ['permissions', 'onDocumentSaved', 'setup'] as const) {
    if (definition[fnKey] !== undefined && typeof definition[fnKey] !== 'function') {
      errors.push(`${fnKey} wajib berupa fungsi.`);
    }
  }

  return errors;
}

function assertValidPlugin(definition: unknown): void {
  const errors = collectPluginErrors(definition);
  if (errors.length === 0) return;
  const rawId = isPlainObject(definition) ? definition.id : undefined;
  const pluginId = typeof rawId === 'string' && rawId.length > 0 ? rawId : undefined;
  throw new PluginError(
    'invalid-plugin',
    `Definisi plugin${pluginId ? ` "${pluginId}"` : ''} tidak valid: ${errors.join(' ')}`,
    pluginId,
    errors,
  );
}

// ---------- definePlugin ----------

/**
 * Mendefinisikan plugin papan tulis.
 *
 * Definisi divalidasi segera (lihat {@link PluginError}) dan objeknya dibekukan dangkal. Tipe
 * literal `id`, tuple `elements`, dan tuple `tools` dipertahankan apa adanya.
 *
 * @example
 * ```ts
 * const kartuPlugin = definePlugin({
 *   id: 'contoh.kartu',
 *   dependsOn: ['default-elements'],
 *   elements: [contactCardElement],
 *   commands: {
 *     'contoh.tambah-kartu': (board) => { ... },
 *   },
 *   setup(board) {
 *     const off = board.on('change', () => {});
 *     return () => off();
 *   },
 * });
 * ```
 *
 * @throws {@link PluginError} berkode `invalid-plugin`.
 * @public
 */
export function definePlugin<
  const Id extends string = string,
  const Elements extends readonly AnyElementDefinition[] = readonly AnyElementDefinition[],
  const Tools extends readonly AnyToolDefinition[] = readonly AnyToolDefinition[],
  const D extends PluginDefinition<Id, Elements, Tools> = PluginDefinition<Id, Elements, Tools>,
>(definition: D): Readonly<D> {
  assertValidPlugin(definition);
  return Object.freeze({ ...definition });
}

// ---------- Resolusi urutan & pemasangan ----------

/**
 * Mengurutkan daftar plugin secara deterministik berdasarkan `dependsOn` (topological sort stabil:
 * mempertahankan urutan input sepanjang prasyaratnya sudah terpenuhi).
 *
 * @throws {@link PluginError} berkode `invalid-plugin`, `duplicate-plugin`, `missing-dependency`,
 *   atau `circular-dependency`.
 * @public
 */
export function resolvePluginOrder(
  plugins: Iterable<AnyPluginDefinition>,
): readonly AnyPluginDefinition[] {
  if (
    plugins === null ||
    typeof plugins !== 'object' ||
    typeof (plugins as Iterable<unknown>)[Symbol.iterator] !== 'function'
  ) {
    const msg = 'Opsi plugins wajib berupa iterable definisi plugin.';
    throw new PluginError('invalid-plugin', msg, undefined, [msg]);
  }

  const list: AnyPluginDefinition[] = [];
  const byId = new Map<string, AnyPluginDefinition>();

  for (const raw of plugins) {
    assertValidPlugin(raw);
    const frozen = Object.isFrozen(raw) ? raw : Object.freeze({ ...raw });
    if (byId.has(frozen.id)) {
      throw new PluginError(
        'duplicate-plugin',
        `Plugin "${frozen.id}" sudah terdaftar. Setiap plugin hanya boleh dipasang sekali.`,
        frozen.id,
      );
    }
    byId.set(frozen.id, frozen);
    list.push(frozen);
  }

  // Periksa dependensi ke diri sendiri dan dependensi yang tidak ada sebelum traversal siklus.
  for (const plugin of list) {
    for (const depId of plugin.dependsOn ?? []) {
      if (depId === plugin.id) {
        throw new PluginError(
          'circular-dependency',
          `Siklus dependensi plugin terdeteksi: ${plugin.id} -> ${plugin.id}.`,
          plugin.id,
        );
      }
      if (!byId.has(depId)) {
        throw new PluginError(
          'missing-dependency',
          `Plugin "${plugin.id}" membutuhkan plugin "${depId}" yang belum dipasang.`,
          plugin.id,
        );
      }
    }
  }

  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const ordered: AnyPluginDefinition[] = [];

  function visit(plugin: AnyPluginDefinition): void {
    const current = state.get(plugin.id);
    if (current === 'visited') return;
    if (current === 'visiting') {
      const cycleStart = stack.indexOf(plugin.id);
      const cycle = [...stack.slice(cycleStart), plugin.id];
      throw new PluginError(
        'circular-dependency',
        `Siklus dependensi plugin terdeteksi: ${cycle.join(' -> ')}.`,
        plugin.id,
      );
    }
    state.set(plugin.id, 'visiting');
    stack.push(plugin.id);
    for (const depId of plugin.dependsOn ?? []) {
      visit(byId.get(depId)!);
    }
    stack.pop();
    state.set(plugin.id, 'visited');
    ordered.push(plugin);
  }

  for (const plugin of list) {
    visit(plugin);
  }

  return Object.freeze(ordered);
}

/**
 * Registri plugin yang terpasang di satu board (`board.plugins`).
 *
 * @public
 */
export interface BoardPlugins {
  /** Definisi plugin untuk ID tersebut, atau `undefined` bila tidak terpasang. */
  get(id: string): AnyPluginDefinition | undefined;
  /** Apakah plugin dengan ID tersebut terpasang di board ini. */
  has(id: string): boolean;
  /** Semua plugin terpasang sesuai urutan pemasangan deterministik (setelah resolusi `dependsOn`). */
  list(): readonly AnyPluginDefinition[];
}

/** @internal */
export interface PluginRuntimeOptions {
  getBoard: () => Board;
  elements: ElementRegistry;
  tools: BoardTools;
  commands: BoardCommands;
  plugins: Iterable<AnyPluginDefinition> | undefined;
}

/** @internal */
export interface PluginRuntime {
  readonly api: BoardPlugins;
  install(): void;
  dispose(): void;
  getPermissions(): readonly PermissionHook[];
}

/** @internal */
export function createPluginRuntime(options: PluginRuntimeOptions): PluginRuntime {
  const { getBoard, elements, tools, commands } = options;
  const ordered =
    options.plugins === undefined ? Object.freeze([]) : resolvePluginOrder(options.plugins);
  const byId = new Map<string, AnyPluginDefinition>();
  const teardowns: PluginTeardown[] = [];
  const unregisters: (() => void)[] = [];
  const permissionHooks: PermissionHook[] = [];

  function rollback(): void {
    for (let i = teardowns.length - 1; i >= 0; i--) {
      try {
        teardowns[i]!();
      } catch {
        // Error asli pemasangan lebih penting daripada error saat rollback.
      }
    }
    teardowns.length = 0;
    for (let i = unregisters.length - 1; i >= 0; i--) {
      unregisters[i]!();
    }
    unregisters.length = 0;
    permissionHooks.length = 0;
    byId.clear();
  }

  const api: BoardPlugins = {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    list: () => Object.freeze([...byId.values()]),
  };

  return {
    api,
    install() {
      try {
        for (const plugin of ordered) {
          for (const elementDef of plugin.elements ?? []) {
            elements.register(elementDef);
          }
          for (const toolDef of plugin.tools ?? []) {
            unregisters.push(tools.register(toolDef));
          }
          if (plugin.commands !== undefined) {
            for (const cmdDef of normalizeCommands(plugin.commands, [])) {
              unregisters.push(commands.register(cmdDef));
            }
          }
          if (typeof plugin.permissions === 'function') {
            permissionHooks.push(plugin.permissions);
          }
          byId.set(plugin.id, plugin);
          if (plugin.setup) {
            const teardown = plugin.setup(getBoard());
            if (teardown !== undefined && typeof teardown !== 'function') {
              const msg = `setup plugin "${plugin.id}" wajib mengembalikan fungsi teardown atau undefined.`;
              throw new PluginError('invalid-plugin', msg, plugin.id, [msg]);
            }
            if (teardown) teardowns.push(teardown);
          }
        }
      } catch (error) {
        rollback();
        throw error;
      }
    },
    dispose() {
      const pending = teardowns.splice(0, teardowns.length);
      let firstError: unknown;
      let hasError = false;
      // Jalankan teardown dalam urutan terbalik dari pemasangan.
      for (let i = pending.length - 1; i >= 0; i--) {
        try {
          pending[i]!();
        } catch (error) {
          if (!hasError) {
            hasError = true;
            firstError = error;
          }
        }
      }
      unregisters.length = 0;
      permissionHooks.length = 0;
      byId.clear();
      if (hasError) throw firstError;
    },
    getPermissions() {
      return Object.freeze([...permissionHooks]);
    },
  };
}
