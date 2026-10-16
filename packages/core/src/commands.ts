/**
 * Registri perintah per board (BOARD-503). Perintah adalah satu sumber untuk command palette
 * (BOARD-1405), shortcut (BOARD-504), dan perintah bawaan (BOARD-505). Tidak ada state global:
 * setiap board punya registri sendiri.
 */

import type { Unsubscribe } from './events.js';
import type { Board } from './index.js';

/**
 * Definisi perintah.
 *
 * @typeParam A - Tipe argumen `board.run(id, args)`. Core tidak memvalidasi argumen; perintah
 *   yang menerima argumen dari luar sebaiknya memeriksanya sendiri.
 *
 * @public
 */
export interface CommandDefinition<A = unknown> {
  /**
   * ID bernamespace: dua segmen atau lebih dipisah titik, tiap segmen huruf kecil, angka, dan
   * tanda hubung, misalnya `'layer.bring-forward'` atau `'contoh.kartu.sisipkan'`.
   */
  readonly id: string;
  /** Kunci i18n untuk label perintah (dipakai command palette dan tooltip). */
  readonly label: string;
  /**
   * Apakah perintah bisa dijalankan saat ini, misalnya `false` saat tidak ada seleksi atau
   * papan `readOnly`. Bila tidak diisi, perintah selalu aktif.
   */
  readonly isEnabled?: (board: Board, args: A | undefined) => boolean;
  /**
   * Menjalankan perintah. Wajib sinkron. Perintah tidak dibungkus transaksi otomatis: perintah
   * yang mengubah dokumen memanggil `board.transact` sendiri, sehingga perintah seperti undo
   * atau kamera tetap bisa dibuat.
   */
  readonly run: (board: Board, args: A | undefined) => void;
}

/**
 * Definisi perintah dengan tipe argumen apa pun, untuk koleksi campuran.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommandDefinition = CommandDefinition<any>;

/**
 * Kode {@link CommandError}.
 *
 * - `invalid-command`: definisi perintah tidak valid.
 * - `duplicate-command`: ID perintah sudah terdaftar (misalnya dua plugin memakai ID sama).
 * - `unknown-command`: `board.run` dipanggil dengan ID yang tidak terdaftar.
 *
 * @public
 */
export type CommandErrorCode = 'invalid-command' | 'duplicate-command' | 'unknown-command';

/**
 * Error registri perintah.
 *
 * @public
 */
export class CommandError extends Error {
  readonly code: CommandErrorCode;
  /** ID perintah yang bermasalah, atau `undefined` bila `id` sendiri tidak valid. */
  readonly commandId: string | undefined;
  /** Daftar masalah definisi; kosong selain untuk `invalid-command`. */
  readonly errors: readonly string[];

  constructor(
    code: CommandErrorCode,
    message: string,
    commandId: string | undefined,
    errors: readonly string[] = [],
  ) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.commandId = commandId;
    this.errors = errors;
  }
}

const COMMAND_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

function collectCommandErrors(definition: unknown): string[] {
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    return ['Definisi perintah wajib berupa objek.'];
  }
  const def = definition as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof def.id !== 'string' || !COMMAND_ID.test(def.id)) {
    errors.push(
      'id wajib bernamespace: segmen huruf kecil, angka, atau tanda hubung yang dipisah titik ' +
        "(misalnya 'layer.bring-forward').",
    );
  }
  if (typeof def.label !== 'string' || def.label.length === 0) {
    errors.push('label wajib berupa kunci i18n tidak kosong.');
  }
  if (typeof def.run !== 'function') errors.push('run wajib berupa fungsi.');
  if (def.isEnabled !== undefined && typeof def.isEnabled !== 'function') {
    errors.push('isEnabled wajib berupa fungsi.');
  }
  return errors;
}

function assertValidCommand(definition: unknown): void {
  const errors = collectCommandErrors(definition);
  if (errors.length === 0) return;
  const id = (definition as { id?: unknown } | null)?.id;
  const commandId = typeof id === 'string' && id ? id : undefined;
  throw new CommandError(
    'invalid-command',
    `Definisi perintah${commandId ? ` "${commandId}"` : ''} tidak valid: ${errors.join(' ')}`,
    commandId,
    errors,
  );
}

/**
 * Mendefinisikan perintah. Definisi divalidasi segera (lihat {@link CommandError}) dan objeknya
 * dibekukan dangkal.
 *
 * @example
 * ```ts
 * const selectAll = defineCommand({
 *   id: 'selection.all',
 *   label: 'command.selection.all',
 *   run: (board) => { ... },
 * });
 * board.commands.register(selectAll);
 * board.run('selection.all');
 * ```
 *
 * @public
 */
export function defineCommand<A = unknown>(definition: CommandDefinition<A>): CommandDefinition<A> {
  assertValidCommand(definition);
  return Object.freeze({ ...definition });
}

/**
 * Registri perintah milik satu board (`board.commands`).
 *
 * @public
 */
export interface BoardCommands {
  /**
   * Mendaftarkan perintah dan mengembalikan fungsi untuk melepasnya (aman dipanggil lebih dari
   * sekali). Melempar {@link CommandError} berkode `duplicate-command` bila ID sudah terdaftar,
   * atau `invalid-command` bila definisi tidak valid.
   *
   * @beta Plugin akan mendaftarkan perintah lewat `definePlugin` (BOARD-602).
   */
  register(definition: AnyCommandDefinition): Unsubscribe;
  /** Definisi untuk ID, atau `undefined` bila tidak terdaftar. */
  get(id: string): AnyCommandDefinition | undefined;
  has(id: string): boolean;
  /** Semua perintah sesuai urutan pendaftaran. */
  list(): readonly AnyCommandDefinition[];
  /**
   * Apakah perintah terdaftar dan aktif. `false` untuk ID yang tidak terdaftar, sehingga aman
   * dipakai command palette dan toolbar.
   */
  isEnabled(id: string, args?: unknown): boolean;
}

/** Bagian internal registri yang dipakai `createBoard`. */
export interface CommandRegistry {
  readonly api: BoardCommands;
  /**
   * Menjalankan perintah. Mengembalikan `false` tanpa menjalankan bila `isEnabled` menolak.
   * Error dari `isEnabled` atau `run` diteruskan ke pemanggil.
   */
  run(id: string, args: unknown): boolean;
  clear(): void;
}

export function createCommandRegistry(getBoard: () => Board): CommandRegistry {
  const byId = new Map<string, AnyCommandDefinition>();

  function enabled(definition: AnyCommandDefinition, args: unknown): boolean {
    return definition.isEnabled ? definition.isEnabled(getBoard(), args) === true : true;
  }

  const api: BoardCommands = {
    register(definition) {
      assertValidCommand(definition);
      const { id } = definition;
      if (byId.has(id)) {
        throw new CommandError(
          'duplicate-command',
          `Perintah "${id}" sudah terdaftar. Setiap ID hanya boleh didaftarkan sekali; pakai ` +
            'namespace plugin sendiri atau pastikan plugin yang sama tidak dipasang dua kali.',
          id,
        );
      }
      const frozen = Object.isFrozen(definition) ? definition : Object.freeze({ ...definition });
      byId.set(id, frozen);
      return () => {
        // Hanya melepas definisi ini, bukan definisi lain yang didaftarkan ulang dengan ID sama.
        if (byId.get(id) === frozen) byId.delete(id);
      };
    },
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    list: () => Object.freeze([...byId.values()]),
    isEnabled(id, args) {
      const definition = byId.get(id);
      return definition !== undefined && enabled(definition, args);
    },
  };

  return {
    api,
    run(id, args) {
      const definition = byId.get(id);
      if (!definition) {
        throw new CommandError('unknown-command', `Perintah "${id}" tidak terdaftar.`, id);
      }
      if (!enabled(definition, args)) return false;
      definition.run(getBoard(), args);
      return true;
    },
    clear() {
      byId.clear();
    },
  };
}
