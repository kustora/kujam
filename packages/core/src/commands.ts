/**
 * Per-board command registry (BOARD-503). Commands are the single source for the command palette
 * (BOARD-1405), shortcuts (BOARD-504), and built-in commands (BOARD-505). There is no global state:
 * every board has its own registry.
 */

import type { Unsubscribe } from './events.js';
import type { Board } from './index.js';

/**
 * Command definition.
 *
 * @typeParam A - Argument type of `board.run(id, args)`. Core does not validate arguments; commands
 *   that accept arguments from outside should check them themselves.
 *
 * @public
 */
export interface CommandDefinition<A = unknown> {
  /**
   * Namespaced ID: two or more dot-separated segments, each made of lowercase letters, digits, and
   * hyphens, for example `'layer.bring-forward'` or `'example.card.insert'`.
   */
  readonly id: string;
  /** i18n key for the command label (used by the command palette and tooltips). */
  readonly label: string;
  /**
   * Whether the command can run right now, for example `false` when nothing is selected or the
   * board is `readOnly`. When omitted, the command is always enabled.
   */
  readonly isEnabled?: (board: Board, args: A | undefined) => boolean;
  /**
   * Runs the command. Must be synchronous. Commands are not automatically wrapped in a transaction:
   * commands that change the document call `board.transact` themselves, so commands such as undo
   * or camera commands are still possible.
   */
  readonly run: (board: Board, args: A | undefined) => void;
}

/**
 * Command definition with any argument type, for mixed collections.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommandDefinition = CommandDefinition<any>;

/**
 * Codes for {@link CommandError}.
 *
 * - `invalid-command`: the command definition is invalid.
 * - `duplicate-command`: the command ID is already registered (for example two plugins use the same ID).
 * - `unknown-command`: `board.run` was called with an unregistered ID.
 *
 * @public
 */
export type CommandErrorCode = 'invalid-command' | 'duplicate-command' | 'unknown-command';

/**
 * Command registry error.
 *
 * @public
 */
export class CommandError extends Error {
  readonly code: CommandErrorCode;
  /** The offending command ID, or `undefined` when `id` itself is invalid. */
  readonly commandId: string | undefined;
  /** Definition problems; empty except for `invalid-command`. */
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
 * Defines a command. The definition is validated immediately (see {@link CommandError}) and the object is
 * shallow-frozen.
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
 * Command registry owned by one board (`board.commands`).
 *
 * @public
 */
export interface BoardCommands {
  /**
   * Registers a command and returns a function that unregisters it (safe to call more than
   * once). Throws {@link CommandError} with code `duplicate-command` when the ID is already registered,
   * or `invalid-command` when the definition is invalid.
   *
   * @beta Plugins will register commands via `definePlugin` (BOARD-602).
   */
  register(definition: AnyCommandDefinition): Unsubscribe;
  /** Definition for the ID, or `undefined` when not registered. */
  get(id: string): AnyCommandDefinition | undefined;
  has(id: string): boolean;
  /** All commands in registration order. */
  list(): readonly AnyCommandDefinition[];
  /**
   * Whether the command is registered and enabled. `false` for unregistered IDs, so it is safe
   * to use from the command palette and toolbar.
   */
  isEnabled(id: string, args?: unknown): boolean;
}

/** Internal part of the registry used by `createBoard`. */
export interface CommandRegistry {
  readonly api: BoardCommands;
  /**
   * Runs a command. Returns `false` without running when `isEnabled` rejects it.
   * Errors from `isEnabled` or `run` are propagated to the caller.
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
        // Only unregister this definition, not another one re-registered with the same ID.
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
