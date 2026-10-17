/**
 * Plugin system (`definePlugin`) and deterministic plugin installation (BOARD-602).
 *
 * Plugins are the only way to register bundles of elements, tools, brushes, commands, shortcuts,
 * toolbar items, exporters, document migrations, permission hooks, document-save hooks, and lifecycle
 * effects (`setup(board) => teardown`). Built-in elements and tools from `@kujam/shapes` (`defaultElements`,
 * `defaultTools`) use the same API with no internal shortcuts.
 */

import { collectBrushErrors, type BrushInput, type BrushRegistry } from '../elements/brushes.js';
import {
  defineCommand,
  type AnyCommandDefinition,
  type BoardCommands,
  type CommandError,
} from '../tools/commands.js';
import {
  defineElement,
  type AnyElementDefinition,
  type ElementDefinitionError,
  type ElementRegistry,
} from '../elements/elements.js';
import type { Board } from '../index.js';
import { checkKeybindingMap } from '../tools/keybindings.js';
import { defineTool, type AnyToolDefinition, type BoardTools, type ToolError } from '../tools/tools.js';
import type { BoardDocument, ElementRecord } from '../types.js';

// ---------- Plugin extension points ----------

/**
 * Freehand brush provided by a plugin (BOARD-603): a {@link defineBrush} result or a plain
 * {@link BrushInput}, validated the same way.
 *
 * @beta
 */
export type PluginBrushDefinition = BrushInput;

/**
 * An extra main-toolbar item provided by a plugin (BOARD-1402).
 *
 * @beta
 */
export interface PluginToolbarItem {
  /** Unique toolbar item ID. */
  readonly id: string;
  /** i18n key or label for the tooltip and screen readers. */
  readonly label: string;
  /** Optional icon name or markup. */
  readonly icon?: string;
  /** Tool ID activated when the item is selected. */
  readonly toolId?: string;
  /** Command ID run when the item is clicked. */
  readonly commandId?: string;
  /** Placement group in the toolbar. */
  readonly group?: string;
  /** Relative order within the group. */
  readonly order?: number;
}

/**
 * Additional export format provided by a plugin (BOARD-1707).
 *
 * @beta
 */
export interface PluginExporter {
  /** Export format name, for example `'pdf'` or `'markdown'`. */
  readonly format: string;
  /** i18n key or label of the format. */
  readonly label?: string;
  /** Exporter function that receives the public `Board` instance. */
  export(board: Board, options?: unknown): unknown;
}

/**
 * A single plugin document migration step from version `n` to `n + 1` (BOARD-702).
 * Must be pure: it receives a frozen document and returns a new one. Changes to `schemaVersion`
 * and `pluginVersions` in the result are ignored.
 *
 * @beta
 */
export type PluginDocumentMigration = (doc: BoardDocument) => BoardDocument;

/**
 * Map of plugin document migration steps keyed by the plugin's own document version (`0`, `1`,
 * ...), which is recorded per plugin in `BoardDocument.pluginVersions` (missing means `0`).
 * Run on load after core schema and element props migrations, in plugin installation order
 * (BOARD-702). New boards start at the latest version, so steps only run on loaded documents.
 * Steps after a gap in the keys are never reached.
 *
 * @beta
 */
export type PluginMigrations = Readonly<Record<number, PluginDocumentMigration>>;

/**
 * Operation kinds checked by permission hooks (BOARD-212).
 *
 * @beta
 */
export type PermissionAction = 'create' | 'update' | 'delete' | 'action' | (string & {});

/**
 * Board user identity for collaboration and permission checks (BOARD-211, BOARD-212).
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
 * Permission hook that checks whether an action on an element is allowed (BOARD-212).
 * Return `false` to cancel the operation and emit an `error` event with code `'forbidden'`.
 *
 * @remarks
 * **IMPORTANT — Security & permission enforcement:**
 * This hook runs entirely on the client (in memory) and is meant purely for UI convenience
 * (such as disabling action buttons, hiding context menus, or cancelling local operations before
 * they reach the network). It provides **NO** security guarantee. Real authorization and access control
 * **MUST** be enforced on the server (for example when validating Yjs updates or storage API
 * endpoints). The client must never be trusted.
 *
 * @beta
 */
export type PermissionHook = (
  action: PermissionAction,
  element: Readonly<ElementRecord> | null,
  user: Readonly<BoardUser> | null,
) => boolean;

/**
 * Hook called after a document is successfully saved by a storage adapter (BOARD-1210).
 *
 * @beta
 */
export type DocumentSavedHook = (doc: Readonly<BoardDocument>) => void | PromiseLike<void>;

/**
 * Cleanup function returned by `setup(board)` and run on `board.dispose()`.
 *
 * @public
 */
export type PluginTeardown = () => void;

/**
 * Plugin initialization hook run when installed on `board`. Receives only the public {@link Board} interface.
 *
 * @public
 */
export type PluginSetup = (board: Board) => PluginTeardown | void;

/**
 * Command entry when `commands` is written as a map object `{ [id]: entry }`:
 * may be an {@link AnyCommandDefinition}, an object `{ label?, isEnabled?, run }`, or directly a
 * function `(board, args) => void` (with the default `label` equal to the `id` key).
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
 * Shape of a plugin's `commands` declaration: a list of {@link AnyCommandDefinition} or a map
 * `{ [id]: entry }`.
 *
 * @public
 */
export type PluginCommandsInput =
  readonly AnyCommandDefinition[] | Readonly<Record<string, PluginCommandMapEntry>>;

// ---------- Plugin definition ----------

/**
 * Board plugin definition. Created with {@link definePlugin}.
 *
 * @typeParam Id - Literal type of the plugin ID.
 * @typeParam Elements - Collection of element definitions provided by the plugin.
 * @typeParam Tools - Collection of tool definitions provided by the plugin.
 *
 * @public
 */
export interface PluginDefinition<
  Id extends string = string,
  Elements extends readonly AnyElementDefinition[] = readonly AnyElementDefinition[],
  Tools extends readonly AnyToolDefinition[] = readonly AnyToolDefinition[],
> {
  /** Unique plugin ID: lowercase letters, digits, dots, or hyphens (for example `'default-elements'`). */
  readonly id: Id;
  /** IDs of other plugins that must be installed before this one. */
  readonly dependsOn?: readonly string[];
  /** Element type definitions registered into `board.elements`. */
  readonly elements?: Elements;
  /** Tool definitions registered into `board.tools`. */
  readonly tools?: Tools;
  /**
   * Additional freehand brush definitions (BOARD-603).
   *
   * @beta
   */
  readonly brushes?: readonly PluginBrushDefinition[];
  /** Commands registered into `board.commands`. */
  readonly commands?: PluginCommandsInput;
  /**
   * Map from keyboard shortcut to command ID or `'tool:<id>'` (BOARD-504), for example
   * `{ 'Mod+D': 'element.duplicate', h: 'tool:hand' }`. See `board.keybindings` for the
   * notation. A later plugin wins over an earlier one, and the consumer's
   * `createBoard({ keybindings })` wins over every plugin.
   *
   * @beta
   */
  readonly keybindings?: Readonly<Record<string, string>>;
  /**
   * Extra items for the main toolbar (BOARD-1402).
   *
   * @beta
   */
  readonly toolbarItems?: readonly PluginToolbarItem[];
  /**
   * Additional format exporters (BOARD-1707).
   *
   * @beta
   */
  readonly exporters?: readonly PluginExporter[];
  /**
   * Plugin-level document migrations (BOARD-702).
   *
   * @beta
   */
  readonly migrations?: PluginMigrations;
  /**
   * Operation permission check hook (BOARD-212).
   *
   * @beta
   */
  readonly permissions?: PermissionHook;
  /**
   * Hook run after a storage adapter saves the document (BOARD-1210).
   *
   * @beta
   */
  readonly onDocumentSaved?: DocumentSavedHook;
  /**
   * Initialization when the plugin is installed on `board`. May return a `teardown` function that is
   * called on `board.dispose()` in reverse installation order.
   */
  readonly setup?: PluginSetup;
}

/**
 * Any plugin definition, for holding various plugins in a collection or the `createBoard` options.
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
 * Codes for {@link PluginError}.
 *
 * - `invalid-plugin`: the plugin definition is invalid or `setup` returned a non-function value.
 * - `duplicate-plugin`: two plugins with the same `id` are installed on one board.
 * - `missing-dependency`: a plugin in `dependsOn` is not being installed.
 * - `circular-dependency`: there is a cycle in the `dependsOn` graph.
 *
 * @public
 */
export type PluginErrorCode =
  'invalid-plugin' | 'duplicate-plugin' | 'missing-dependency' | 'circular-dependency';

/**
 * Error thrown when defining or installing a plugin.
 *
 * @public
 */
export class PluginError extends Error {
  readonly code: PluginErrorCode;
  /** The offending plugin ID, or `undefined` when `id` itself is invalid. */
  readonly pluginId: string | undefined;
  /** Validation problems; empty except for `invalid-plugin`. */
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

// ---------- Validation and normalization ----------

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
 * Converts a `commands` declaration (array or map object) into a validated list of
 * {@link AnyCommandDefinition}, collecting error messages for anything invalid.
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
    const item: unknown = brushes[i];
    if (!isPlainObject(item)) {
      errors.push(`brushes[${i}] wajib berupa objek.`);
      continue;
    }
    if (typeof item.id === 'string') {
      if (seen.has(item.id)) {
        errors.push(`brushes[${i}]: kuas "${item.id}" duplikat di dalam plugin yang sama.`);
      }
      seen.add(item.id);
    }
    for (const problem of collectBrushErrors(item)) errors.push(`brushes[${i}].${problem}`);
  }
}

function checkKeybindings(keybindings: unknown, errors: string[]): void {
  errors.push(...checkKeybindingMap(keybindings, 'keybindings', false));
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
 * Defines a whiteboard plugin.
 *
 * The definition is validated immediately (see {@link PluginError}) and the object is shallow-frozen. The
 * literal `id` type, the `elements` tuple, and the `tools` tuple are preserved as-is.
 *
 * @example
 * ```ts
 * const cardPlugin = definePlugin({
 *   id: 'example.card',
 *   dependsOn: ['default-elements'],
 *   elements: [contactCardElement],
 *   commands: {
 *     'example.add-card': (board) => { ... },
 *   },
 *   setup(board) {
 *     const off = board.on('change', () => {});
 *     return () => off();
 *   },
 * });
 * ```
 *
 * @throws {@link PluginError} with code `invalid-plugin`.
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

// ---------- Order resolution & installation ----------

/**
 * Sorts plugins deterministically by `dependsOn` (stable topological sort:
 * keeps input order as long as prerequisites are already satisfied).
 *
 * @throws {@link PluginError} with code `invalid-plugin`, `duplicate-plugin`, `missing-dependency`,
 *   or `circular-dependency`.
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

  // Check self-dependencies and missing dependencies before cycle traversal.
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
 * Registry of plugins installed on one board (`board.plugins`).
 *
 * @public
 */
export interface BoardPlugins {
  /** Plugin definition for the ID, or `undefined` when not installed. */
  get(id: string): AnyPluginDefinition | undefined;
  /** Whether a plugin with the ID is installed on this board. */
  has(id: string): boolean;
  /** All installed plugins in deterministic installation order (after `dependsOn` resolution). */
  list(): readonly AnyPluginDefinition[];
}

/** @internal */
export interface PluginRuntimeOptions {
  getBoard: () => Board;
  elements: ElementRegistry;
  tools: BoardTools;
  commands: BoardCommands;
  brushes: BrushRegistry;
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
  const { getBoard, elements, tools, commands, brushes } = options;
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
        // The original installation error matters more than errors during rollback.
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
          for (const brush of plugin.brushes ?? []) {
            unregisters.push(brushes.register(brush));
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
      // Run teardowns in reverse installation order.
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
