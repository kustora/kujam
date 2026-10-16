/**
 * Tool sebagai state machine (BOARD-501, ADR-004).
 *
 * Renderer menerjemahkan event DOM menjadi {@link BoardInputEvent} ternormalisasi lalu memanggil
 * `board.dispatch`. Tool tidak pernah menyentuh DOM, sehingga perilakunya sama di semua framework
 * dan bisa dites di Node dengan rangkaian event sintetis.
 *
 * Aturan runtime:
 * - Satu tool aktif memegang satu pointer utama. Pointer yang membuat tool meninggalkan state
 *   awal menjadi pointer utama sampai tool kembali ke state awal; event pointer lain diabaikan
 *   (dirutekan renderer ke pengenal gestur).
 * - Perubahan dokumen lewat `ctx.change` membentuk satu interaksi: kembali ke state awal
 *   meng-commit-nya sebagai satu langkah undo, sedangkan `cancel` me-rollback-nya.
 * - Transisi `cancel` ada di setiap state tanpa perlu ditulis: dipicu `pointer-cancel` pointer
 *   utama, Esc, `ctx.cancel()`, ganti tool, undo, atau handler yang melempar.
 * - Esc saat tool di state awal kembali ke tool bawaan. Tool `oneShot` kembali ke tool bawaan
 *   setelah satu interaksi selesai.
 * - Spasi ditahan mengaktifkan tool `hand` sementara (bila terdaftar), lalu kembali saat dilepas.
 */

import type { Point } from './geometry.js';
import type { Board } from './index.js';
import type { Interaction } from './interaction.js';
import type { Transaction } from './store.js';

// ---------- Event input ternormalisasi ----------

/**
 * Jenis pointer, sama dengan `PointerEvent.pointerType`.
 *
 * @beta
 */
export type PointerKind = 'mouse' | 'pen' | 'touch';

/**
 * Status tombol pengubah saat event terjadi.
 *
 * @beta
 */
export interface InputModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
}

/**
 * Event pointer dari renderer (Pointer Events untuk mouse, sentuh, dan pena).
 *
 * @beta
 */
export interface ToolPointerEvent {
  readonly type: 'pointer-down' | 'pointer-move' | 'pointer-up' | 'pointer-cancel';
  readonly pointerId: number;
  readonly pointerType: PointerKind;
  /** Posisi dalam koordinat papan. */
  readonly point: Point;
  /** Posisi dalam piksel CSS relatif terhadap kontainer papan. */
  readonly screen: Point;
  /** Tekanan 0–1. Mouse mengirim 0.5 saat tombol ditekan dan 0 saat tidak. */
  readonly pressure: number;
  /** Kemiringan pena dalam derajat (−90 sampai 90); 0 untuk mouse dan sentuh. */
  readonly tiltX: number;
  readonly tiltY: number;
  /** Tombol yang berubah (`PointerEvent.button`): 0 utama, 1 tengah, 2 kedua, 5 penghapus. */
  readonly button: number;
  /** Bitmask tombol yang sedang ditekan (`PointerEvent.buttons`); 32 = penghapus stylus. */
  readonly buttons: number;
  readonly modifiers: InputModifiers;
}

/**
 * Event keyboard dari renderer. Renderer tidak mengirimnya saat fokus ada di input teks.
 *
 * @beta
 */
export interface ToolKeyEvent {
  readonly type: 'key-down' | 'key-up';
  /** `KeyboardEvent.key`, misalnya `'Escape'` atau `'a'`. */
  readonly key: string;
  /** `KeyboardEvent.code`, misalnya `'Space'` atau `'KeyA'`. */
  readonly code: string;
  readonly repeat: boolean;
  readonly modifiers: InputModifiers;
}

/**
 * Event roda mouse atau scroll trackpad, dengan delta dalam piksel CSS.
 *
 * @beta
 */
export interface ToolWheelEvent {
  readonly type: 'wheel';
  readonly point: Point;
  readonly screen: Point;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly modifiers: InputModifiers;
}

/**
 * Gestur pinch dua jari atau trackpad yang sudah dikenali renderer.
 *
 * @beta
 */
export interface ToolPinchEvent {
  readonly type: 'pinch';
  readonly phase: 'start' | 'update' | 'end';
  /** Titik tengah gestur dalam koordinat papan. */
  readonly point: Point;
  /** Titik tengah gestur dalam piksel CSS. */
  readonly screen: Point;
  /** Faktor skala relatif terhadap event sebelumnya (1 = tetap). */
  readonly scale: number;
  /** Pergeseran titik tengah sejak event sebelumnya, dalam piksel CSS. */
  readonly deltaX: number;
  readonly deltaY: number;
}

/**
 * Semua event input yang diterima `board.dispatch`.
 *
 * @beta
 */
export type BoardInputEvent = ToolPointerEvent | ToolKeyEvent | ToolWheelEvent | ToolPinchEvent;

// ---------- Definisi tool ----------

/**
 * Konteks yang diterima setiap handler state tool.
 *
 * @beta
 */
export interface ToolContext<S extends string = string, D = Record<string, unknown>> {
  readonly board: Board;
  /** State saat ini. */
  readonly state: S;
  /** Data milik tool di board ini; dibuat ulang setiap kali tool masuk ke state awal. */
  data: D;
  /**
   * Menerapkan perubahan dokumen sebagai bagian interaksi yang sedang berjalan. Perubahan
   * langsung terlihat, lalu di-commit sebagai satu langkah undo saat tool kembali ke state awal
   * (atau saat `commit`), atau di-rollback saat `cancel`. Label terakhir dipakai untuk langkah
   * undo; bawaannya ID tool.
   */
  change(fn: (tx: Transaction) => void, options?: { label?: string }): void;
  /** Meng-commit interaksi sekarang tanpa berpindah state. */
  commit(): void;
  /**
   * Me-rollback interaksi lalu kembali ke state awal. Nilai kembali handler yang memanggilnya
   * diabaikan.
   */
  cancel(): void;
}

/**
 * Handler satu state. Handler event boleh mengembalikan nama state berikutnya; tanpa nilai
 * kembali, tool tetap di state yang sama.
 *
 * @beta
 */
export interface ToolStateDefinition<S extends string = string, D = Record<string, unknown>> {
  /** Kursor CSS selama state ini aktif; menimpa `cursor` tool. */
  readonly cursor?: string;
  readonly onEnter?: (ctx: ToolContext<S, D>) => S | void;
  readonly onExit?: (ctx: ToolContext<S, D>) => void;
  /** Dipanggil setelah interaksi di-rollback, sebelum `onExit` dan kembali ke state awal. */
  readonly onCancel?: (ctx: ToolContext<S, D>) => void;
  readonly onPointerDown?: (ctx: ToolContext<S, D>, event: ToolPointerEvent) => S | void;
  readonly onPointerMove?: (ctx: ToolContext<S, D>, event: ToolPointerEvent) => S | void;
  readonly onPointerUp?: (ctx: ToolContext<S, D>, event: ToolPointerEvent) => S | void;
  readonly onKeyDown?: (ctx: ToolContext<S, D>, event: ToolKeyEvent) => S | void;
  readonly onKeyUp?: (ctx: ToolContext<S, D>, event: ToolKeyEvent) => S | void;
  readonly onWheel?: (ctx: ToolContext<S, D>, event: ToolWheelEvent) => S | void;
  readonly onPinch?: (ctx: ToolContext<S, D>, event: ToolPinchEvent) => S | void;
}

/**
 * Definisi tool.
 *
 * @typeParam S - Nama state, diinferensi dari kunci `states`.
 * @typeParam D - Tipe `ctx.data`, diinferensi dari `data`.
 *
 * @beta
 */
export interface ToolDefinition<S extends string = string, D = Record<string, unknown>> {
  /** ID tool: huruf kecil, angka, titik, atau tanda hubung, misalnya `'pen'` atau `'contoh.cap'`. */
  readonly id: string;
  /** Kursor CSS bawaan tool. Bawaan `'default'`. */
  readonly cursor?: string;
  /** Kembali ke tool bawaan setelah satu interaksi selesai. */
  readonly oneShot?: boolean;
  /** State awal (diam). Kembali ke state ini meng-commit interaksi. */
  readonly initial: NoInfer<S>;
  /** Nama state hanya diinferensi dari kunci objek ini, bukan dari nilai kembali handler. */
  readonly states: { readonly [K in S]: ToolStateDefinition<NoInfer<S>, D> };
  /** Pembuat `ctx.data`. Bawaan `() => ({})`. */
  readonly data?: () => D;
}

/**
 * Definisi tool dengan state dan data apa pun, untuk koleksi campuran.
 *
 * @beta
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;

/**
 * Kode {@link ToolError}.
 *
 * - `invalid-tool`: definisi tool tidak valid.
 * - `duplicate-tool`: ID tool sudah terdaftar.
 * - `unknown-tool`: `setTool` dipanggil dengan ID yang tidak terdaftar.
 * - `unknown-state`: handler mengembalikan nama state yang tidak ada.
 *
 * @beta
 */
export type ToolErrorCode = 'invalid-tool' | 'duplicate-tool' | 'unknown-tool' | 'unknown-state';

/**
 * Error registri dan runtime tool.
 *
 * @beta
 */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  /** ID tool yang bermasalah, atau `undefined` bila `id` sendiri tidak valid. */
  readonly toolId: string | undefined;
  /** Daftar masalah definisi; kosong selain untuk `invalid-tool`. */
  readonly errors: readonly string[];

  constructor(
    code: ToolErrorCode,
    message: string,
    toolId: string | undefined,
    errors: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.toolId = toolId;
    this.errors = errors;
  }
}

const TOOL_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const STATE_HANDLERS = [
  'onEnter',
  'onExit',
  'onCancel',
  'onPointerDown',
  'onPointerMove',
  'onPointerUp',
  'onKeyDown',
  'onKeyUp',
  'onWheel',
  'onPinch',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectToolErrors(definition: unknown): string[] {
  if (!isPlainObject(definition)) return ['Definisi tool wajib berupa objek.'];
  const errors: string[] = [];
  if (typeof definition.id !== 'string' || !TOOL_ID.test(definition.id)) {
    errors.push('id wajib huruf kecil, angka, titik, atau tanda hubung (misalnya "pen").');
  }
  if (definition.cursor !== undefined && typeof definition.cursor !== 'string') {
    errors.push('cursor wajib berupa string.');
  }
  if (definition.oneShot !== undefined && typeof definition.oneShot !== 'boolean') {
    errors.push('oneShot wajib berupa boolean.');
  }
  if (definition.data !== undefined && typeof definition.data !== 'function') {
    errors.push('data wajib berupa fungsi.');
  }
  const { states } = definition;
  if (!isPlainObject(states) || Object.keys(states).length === 0) {
    errors.push('states wajib berupa objek dengan minimal satu state.');
    return errors;
  }
  if (typeof definition.initial !== 'string' || !Object.hasOwn(states, definition.initial)) {
    errors.push('initial wajib nama salah satu state.');
  }
  for (const [name, state] of Object.entries(states)) {
    if (!isPlainObject(state)) {
      errors.push(`states.${name} wajib berupa objek.`);
      continue;
    }
    if (state.cursor !== undefined && typeof state.cursor !== 'string') {
      errors.push(`states.${name}.cursor wajib berupa string.`);
    }
    for (const key of STATE_HANDLERS) {
      if (state[key] !== undefined && typeof state[key] !== 'function') {
        errors.push(`states.${name}.${key} wajib berupa fungsi.`);
      }
    }
  }
  return errors;
}

function assertValidTool(definition: unknown): void {
  const errors = collectToolErrors(definition);
  if (errors.length === 0) return;
  const id = isPlainObject(definition) ? definition.id : undefined;
  const toolId = typeof id === 'string' && id ? id : undefined;
  throw new ToolError(
    'invalid-tool',
    `Definisi tool${toolId ? ` "${toolId}"` : ''} tidak valid: ${errors.join(' ')}`,
    toolId,
    errors,
  );
}

/**
 * Mendefinisikan tool sebagai state machine. Nama state diinferensi dari `states`, sehingga
 * handler hanya boleh mengembalikan state yang ada. Definisi divalidasi segera (lihat
 * {@link ToolError}) dan objeknya dibekukan dangkal.
 *
 * @example
 * ```ts
 * const stamp = defineTool({
 *   id: 'contoh.cap',
 *   cursor: 'crosshair',
 *   initial: 'idle',
 *   data: () => ({ id: '' }),
 *   states: {
 *     idle: {
 *       onPointerDown(ctx, e) {
 *         ctx.data.id = ctx.board.createId();
 *         ctx.change((tx) => tx.put(makeStamp(ctx.data.id, e.point)));
 *         return 'dragging';
 *       },
 *     },
 *     dragging: {
 *       onPointerMove: (ctx, e) => ctx.change((tx) => moveStamp(tx, ctx.data.id, e.point)),
 *       onPointerUp: () => 'idle', // commit sebagai satu langkah undo
 *     },
 *   },
 * });
 * ```
 *
 * @beta
 */
export function defineTool<S extends string, D = Record<string, unknown>>(
  definition: ToolDefinition<S, D>,
): ToolDefinition<S, D> {
  assertValidTool(definition);
  return Object.freeze({ ...definition });
}

// ---------- Registri dan runtime ----------

/**
 * Nama tool yang diaktifkan sementara saat spasi ditahan.
 *
 * @beta
 */
export const HAND_TOOL_ID = 'hand';

/**
 * Tool bawaan bila `createBoard({ defaultTool })` tidak diisi.
 *
 * @beta
 */
export const DEFAULT_TOOL_ID = 'select';

/**
 * Registri tool milik satu board (`board.tools`).
 *
 * @beta
 */
export interface BoardTools {
  /**
   * Mendaftarkan tool dan mengembalikan fungsi untuk melepasnya. Melepas tool yang sedang aktif
   * membatalkan interaksinya lalu pindah ke tool bawaan (atau tanpa tool). Melempar
   * {@link ToolError} berkode `duplicate-tool` atau `invalid-tool`.
   *
   * @beta Plugin akan mendaftarkan tool lewat `definePlugin` (BOARD-602).
   */
  register(definition: AnyToolDefinition): () => void;
  get(id: string): AnyToolDefinition | undefined;
  has(id: string): boolean;
  /** Semua tool sesuai urutan pendaftaran. */
  list(): readonly AnyToolDefinition[];
}

/** @internal */
export interface ToolRuntimeOptions {
  getBoard: () => Board;
  interaction: Interaction;
  defaultTool: string;
  onToolChange: (id: string | null, previous: string | null) => void;
}

/** @internal */
export interface ToolRuntime {
  readonly api: BoardTools;
  readonly tool: string | null;
  readonly state: string | null;
  readonly cursor: string;
  /** Apakah tool sedang di luar state awal (interaksi berlangsung). */
  readonly busy: boolean;
  setTool(id: string): void;
  dispatch(event: BoardInputEvent): boolean;
  /** Membatalkan interaksi yang berlangsung. Mengembalikan `true` bila tool sedang sibuk. */
  cancel(): boolean;
  /** Kembali ke state awal tanpa rollback, setelah dokumen diganti. */
  reset(): void;
  clear(): void;
}

type Handler = (ctx: ToolContext, event?: BoardInputEvent) => string | void;

const HANDLER_FOR: Record<BoardInputEvent['type'], keyof ToolStateDefinition | null> = {
  'pointer-down': 'onPointerDown',
  'pointer-move': 'onPointerMove',
  'pointer-up': 'onPointerUp',
  'pointer-cancel': null,
  'key-down': 'onKeyDown',
  'key-up': 'onKeyUp',
  wheel: 'onWheel',
  pinch: 'onPinch',
};

/** Batas rantai `onEnter` yang mengembalikan state lain, untuk mencegah putaran tak terbatas. */
const MAX_CHAINED_TRANSITIONS = 32;

/** @internal */
export function createToolRuntime(options: ToolRuntimeOptions): ToolRuntime {
  const { getBoard, interaction, defaultTool, onToolChange } = options;
  const byId = new Map<string, AnyToolDefinition>();

  interface Active {
    readonly definition: AnyToolDefinition;
    state: string;
    data: unknown;
    pointerId: number | null;
    /** Naik setiap kali state berganti, untuk mengabaikan nilai kembali handler yang usang. */
    generation: number;
    readonly ctx: ToolContext;
  }

  let active: Active | null = null;
  /** Tool yang dipulihkan saat spasi dilepas, atau `null` bila tool tangan tidak sementara. */
  let springFrom: string | null = null;

  function makeData(definition: AnyToolDefinition): unknown {
    return definition.data ? definition.data() : {};
  }

  function stateDef(a: Active, state = a.state): ToolStateDefinition {
    return a.definition.states[state] as ToolStateDefinition;
  }

  function call<K extends keyof ToolStateDefinition>(
    a: Active,
    key: K,
    event?: BoardInputEvent,
  ): string | void {
    const handler = stateDef(a)[key] as Handler | undefined;
    return handler?.(a.ctx, event);
  }

  function activate(definition: AnyToolDefinition): Active {
    const a: Active = {
      definition,
      state: definition.initial,
      data: makeData(definition),
      pointerId: null,
      generation: 0,
      ctx: {
        get board() {
          return getBoard();
        },
        get state() {
          return a.state;
        },
        get data() {
          return a.data;
        },
        set data(value) {
          a.data = value;
        },
        change(fn, changeOptions) {
          if (active !== a) throw new Error(`Tool "${definition.id}" sudah tidak aktif.`);
          interaction.change(fn, changeOptions?.label);
        },
        commit() {
          if (active === a) interaction.commit(definition.id);
        },
        cancel() {
          if (active === a) cancelActive();
        },
      } as ToolContext,
    };
    return a;
  }

  /** Masuk ke state awal: commit interaksi, lepas pointer, buat ulang data. */
  function settle(a: Active): void {
    interaction.commit(a.definition.id);
    a.pointerId = null;
    a.data = makeData(a.definition);
  }

  function transition(a: Active, next: string | void, depth = 0): void {
    if (next === undefined || next === a.state || active !== a) return;
    if (!Object.hasOwn(a.definition.states, next)) {
      throw new ToolError(
        'unknown-state',
        `Tool "${a.definition.id}" tidak punya state "${next}".`,
        a.definition.id,
      );
    }
    if (depth >= MAX_CHAINED_TRANSITIONS) {
      throw new Error(`Tool "${a.definition.id}" berpindah state terus-menerus lewat onEnter.`);
    }
    call(a, 'onExit');
    const completed = next === a.definition.initial;
    a.state = next;
    a.generation++;
    if (completed) settle(a);
    const gen = a.generation;
    const chained = call(a, 'onEnter');
    if (active === a && gen === a.generation) transition(a, chained, depth + 1);
    if (completed && active === a && a.definition.oneShot && a.state === a.definition.initial) {
      switchTo(defaultTool);
    }
  }

  /** Rollback interaksi tool aktif, lalu kembali ke state awal. */
  function cancelActive(): boolean {
    const a = active;
    if (!a) return false;
    const busy = a.state !== a.definition.initial || interaction.active;
    if (!busy) return false;
    a.generation++;
    try {
      interaction.rollback();
      if (active === a) call(a, 'onCancel');
      if (active === a && a.state !== a.definition.initial) {
        call(a, 'onExit');
        a.state = a.definition.initial;
        a.generation++;
        settle(a);
        call(a, 'onEnter');
      }
    } finally {
      // Apa pun yang terjadi di handler, interaksi tidak boleh tertinggal terbuka.
      if (interaction.active) interaction.discard();
      if (active === a) {
        a.state = a.definition.initial;
        a.pointerId = null;
      }
    }
    return true;
  }

  /** Menjalankan handler; bila melempar, interaksi di-rollback lalu error diteruskan. */
  function guarded(a: Active, run: () => void): void {
    try {
      run();
    } catch (error) {
      try {
        if (active === a) cancelActive();
      } catch {
        // Error asli lebih penting daripada error saat membatalkan.
      }
      throw error;
    }
  }

  function switchTo(id: string | null): void {
    const previous = active?.definition.id ?? null;
    if (id === previous) return;
    const next = id === null ? undefined : byId.get(id);
    if (id !== null && !next) {
      throw new ToolError('unknown-tool', `Tool "${id}" tidak terdaftar.`, id);
    }
    const current = active;
    if (current) {
      cancelActive();
      if (active === current) {
        active = null;
        call(current, 'onExit');
      }
    }
    if (next) {
      const a = activate(next);
      active = a;
      guarded(a, () => transition(a, call(a, 'onEnter')));
    } else {
      active = null;
    }
    onToolChange(active?.definition.id ?? null, previous);
  }

  function handleSpace(event: ToolKeyEvent): boolean | undefined {
    if (event.code !== 'Space') return undefined;
    if (event.type === 'key-down') {
      if (springFrom !== null) return true;
      if (event.repeat || !byId.has(HAND_TOOL_ID) || !active) return undefined;
      if (active.definition.id === HAND_TOOL_ID || active.state !== active.definition.initial) {
        return undefined;
      }
      const from = active.definition.id;
      switchTo(HAND_TOOL_ID);
      springFrom = from;
      return true;
    }
    if (springFrom === null) return undefined;
    const back = springFrom;
    springFrom = null;
    switchTo(byId.has(back) ? back : null);
    return true;
  }

  function handleEscape(event: ToolKeyEvent): boolean {
    if (event.type !== 'key-down' || event.key !== 'Escape' || !active) return false;
    if (cancelActive()) return true;
    if (active.definition.id !== defaultTool && byId.has(defaultTool)) {
      springFrom = null;
      switchTo(defaultTool);
      return true;
    }
    return false;
  }

  function dispatchPointer(a: Active, event: ToolPointerEvent): boolean {
    if (a.pointerId !== null && event.pointerId !== a.pointerId) return false;
    if (event.type === 'pointer-cancel') {
      return a.pointerId !== null ? cancelActive() : false;
    }
    return deliver(a, event);
  }

  function deliver(a: Active, event: BoardInputEvent): boolean {
    const key = HANDLER_FOR[event.type];
    if (!key || !stateDef(a)[key]) return false;
    const wasIdle = a.state === a.definition.initial;
    guarded(a, () => {
      const gen = a.generation;
      const next = call(a, key, event);
      if (active === a && gen === a.generation) transition(a, next);
      // Perubahan di state awal (misalnya klik sekali untuk menaruh elemen) langsung di-commit.
      if (active === a && a.state === a.definition.initial) interaction.commit(a.definition.id);
    });
    if (
      wasIdle &&
      active === a &&
      a.state !== a.definition.initial &&
      event.type === 'pointer-down'
    ) {
      a.pointerId = event.pointerId;
    }
    return true;
  }

  const api: BoardTools = {
    register(definition) {
      assertValidTool(definition);
      const { id } = definition;
      if (byId.has(id)) {
        throw new ToolError(
          'duplicate-tool',
          `Tool "${id}" sudah terdaftar. Setiap ID hanya boleh didaftarkan sekali; pakai ID lain ` +
            'atau pastikan plugin yang sama tidak dipasang dua kali.',
          id,
        );
      }
      const frozen = Object.isFrozen(definition) ? definition : Object.freeze({ ...definition });
      byId.set(id, frozen);
      return () => {
        if (byId.get(id) !== frozen) return;
        byId.delete(id);
        if (springFrom === id) springFrom = null;
        if (active?.definition === frozen) {
          springFrom = null;
          switchTo(byId.has(defaultTool) ? defaultTool : null);
        }
      };
    },
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    list: () => Object.freeze([...byId.values()]),
  };

  return {
    api,
    get tool() {
      return active?.definition.id ?? null;
    },
    get state() {
      return active?.state ?? null;
    },
    get cursor() {
      if (!active) return 'default';
      return stateDef(active).cursor ?? active.definition.cursor ?? 'default';
    },
    get busy() {
      return active !== null && (active.state !== active.definition.initial || interaction.active);
    },
    setTool(id) {
      if (typeof id !== 'string') throw new TypeError('ID tool wajib berupa string.');
      springFrom = null;
      switchTo(id);
    },
    dispatch(event) {
      if (!active || !event || !(event.type in HANDLER_FOR)) return false;
      if (event.type === 'key-down' || event.type === 'key-up') {
        if (handleEscape(event)) return true;
        const spring = handleSpace(event);
        if (spring !== undefined) return spring;
        return active ? deliver(active, event) : false;
      }
      if (
        event.type === 'pointer-down' ||
        event.type === 'pointer-move' ||
        event.type === 'pointer-up' ||
        event.type === 'pointer-cancel'
      ) {
        return dispatchPointer(active, event);
      }
      return deliver(active, event);
    },
    cancel: cancelActive,
    reset() {
      interaction.discard();
      if (!active || active.state === active.definition.initial) return;
      const a = active;
      a.generation++;
      a.state = a.definition.initial;
      a.pointerId = null;
      a.data = makeData(a.definition);
    },
    clear() {
      interaction.discard();
      active = null;
      springFrom = null;
      byId.clear();
    },
  };
}
