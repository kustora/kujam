/**
 * `@kujam/core` — Framework-agnostic whiteboard core with no DOM and no runtime dependencies.
 *
 * @packageDocumentation
 */

import { deepClone } from './clone.js';
import { createCommandRegistry, type BoardCommands } from './commands.js';
import {
  createElementRegistry,
  type ElementAction,
  type ElementRegistry,
  type ResolveResult,
} from './elements.js';
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
  type PermissionAction,
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
import { migrateSchema } from './migrations.js';
import { createSelection, type SelectionInput } from './selection.js';
import { createSpatialIndex, type BoxBounds, type SpatialIndex } from './spatial.js';
import { queryElements, type QueryFilter } from './query.js';
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
export {
  computeElementAABB,
  createSpatialIndex,
  isBoxBounds,
  isRectBounds,
  normalizeBounds,
  type Bounds,
  type BoxBounds,
  type RectBounds,
  type SpatialIndex,
} from './spatial.js';
export { queryElements, type QueryFilter } from './query.js';
export {
  CORE_MIGRATIONS,
  MigrationError,
  migrateSchema,
  type SchemaMigration,
  type SchemaMigrations,
} from './migrations.js';
export type { SelectionInput } from './selection.js';

/**
 * Global map from element type to props type, for declaration merging (BOARD-607).
 *
 * @example
 * ```ts
 * declare module '@kujam/core' {
 *   interface BoardElementTypes {
 *     'custom-card': { title: string; count: number };
 *   }
 * }
 * ```
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BoardElementTypes {}

/**
 * Helper type that resolves props from a registered element type name, or falls back to a generic (BOARD-607).
 *
 * @public
 */
export type ResolveElementProps<T> = T extends keyof BoardElementTypes
  ? BoardElementTypes[T]
  : unknown extends T
    ? T
    : T extends Record<string, unknown>
      ? T
      : Record<string, unknown>;

/**
 * UI locales supported by the package.
 *
 * @public
 */
export type BoardLocale = 'id' | 'en';

/**
 * Camera zoom bounds.
 *
 * @public
 */
export interface ZoomRange {
  min: number;
  max: number;
}

/**
 * Default zoom bounds: 10% to 400%.
 *
 * @public
 */
export const DEFAULT_ZOOM_RANGE: Readonly<ZoomRange> = Object.freeze({ min: 0.1, max: 4 });

/**
 * Function that fetches external data by ID (BOARD-604).
 *
 * @beta
 */
export type BoardResolver<D = unknown> = (id: string) => ResolveResult<D>;

/**
 * Map from resolver name to external data fetcher (BOARD-211, BOARD-604).
 *
 * @beta
 */
export type BoardResolvers = Readonly<Record<string, BoardResolver>>;

/**
 * Adapter for resolving and uploading media assets for image elements (BOARD-211, BOARD-1103).
 *
 * @beta
 */
export interface AssetAdapter {
  /** Returns the asset URL (sync or async), or `null`/`undefined` when unavailable. */
  resolve(assetId: string): string | null | undefined | PromiseLike<string | null | undefined>;
  /** Uploads an asset file/blob and returns the new `assetId`. */
  upload?(file: unknown): string | PromiseLike<string>;
}

/**
 * Limits on board size and entity counts (BOARD-005, BOARD-210, BOARD-211).
 *
 * @public
 */
export interface BoardLimits {
  /** Maximum serialized document size in bytes. Defaults to 10 MB (`10_485_760`). */
  readonly maxDocumentBytes: number;
  /** Maximum number of elements per board. Defaults to `5_000`. */
  readonly maxElements: number;
  /** Maximum number of points per freehand (`draw`) element. Defaults to `5_000`. */
  readonly maxDrawPoints: number;
}

/**
 * Default board limits: 10 MB document, 5,000 elements, 5,000 points per stroke.
 *
 * @public
 */
export const DEFAULT_BOARD_LIMITS: Readonly<BoardLimits> = Object.freeze({
  maxDocumentBytes: 10 * 1024 * 1024,
  maxElements: 5_000,
  maxDrawPoints: 5_000,
});

/**
 * Options for creating a `Board` instance (BOARD-211).
 *
 * @public
 */
export interface CreateBoardOptions {
  /** Initial board document; when omitted, a new document with one page (`page:main`) is created. */
  document?: BoardDocument;
  /**
   * Plugins, installed deterministically by order and `dependsOn`
   * (BOARD-602). For example `[defaultElements, defaultTools]`.
   */
  plugins?: Iterable<AnyPluginDefinition>;
  /**
   * Map from resolver name to external data fetcher for custom elements (BOARD-604).
   *
   * @beta
   */
  resolvers?: BoardResolvers;
  /**
   * Adapter for resolving URLs and uploading image asset files (BOARD-1103).
   *
   * @beta
   */
  assets?: AssetAdapter;
  /**
   * Local user identity for collaboration and permission checks (BOARD-212).
   *
   * @beta
   */
  user?: BoardUser | null;
  /**
   * Read-only mode. Local document changes are rejected; camera and selection can still change,
   * and `loadDocument` is still allowed so documents from the server can be received.
   */
  readOnly?: boolean;
  /** UI locale. Defaults to `'id'`. */
  locale?: BoardLocale;
  /**
   * Limits on document size, element count, and stroke points (BOARD-210). Omitted values
   * fall back to {@link DEFAULT_BOARD_LIMITS}.
   */
  limits?: Partial<BoardLimits>;
  /**
   * Application-level permission hook; combined with plugin permission hooks using AND logic
   * (BOARD-212).
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
  permissions?: PermissionHook;
  /** Camera zoom bounds. Defaults to {@link DEFAULT_ZOOM_RANGE}. */
  zoomRange?: ZoomRange;
  /**
   * Deep-freezes snapshots (`Object.freeze`) so accidental mutation throws a `TypeError`
   * immediately. Defaults to `true` (development mode, safe).
   *
   * With `false` (production mode), snapshots still use structural sharing but are not
   * frozen, making transactions slightly cheaper on large documents. The contract is the
   * same: snapshots must not be mutated; mutating them silently corrupts board state.
   * Core does not read `process.env`, so callers decide, for example
   * `freezeSnapshots: import.meta.env.DEV`.
   */
  freezeSnapshots?: boolean;
  /**
   * Record ID generator. Defaults to {@link createId} (nanoid). Replace with a sequential
   * generator for deterministic tests.
   */
  createId?: IdGenerator;
  /** Local undo history options, for example `{ limit: 50 }`. Defaults to 200 steps. */
  history?: HistoryOptions;
  /**
   * Tool to return to when Esc is pressed in the initial state and after a `oneShot` tool finishes.
   * Defaults to {@link DEFAULT_TOOL_ID} (`'select'`). The board starts with no active tool; call `setTool`.
   *
   * @beta
   */
  defaultTool?: string;
}

/**
 * Public interface of a `Board` instance.
 *
 * @public
 */
export interface Board {
  /**
   * Current document snapshot. A new snapshot object is created per transaction; unchanged
   * records keep the same object (structural sharing). Frozen when `freezeSnapshots` is enabled.
   */
  getDocument(): Readonly<BoardDocument>;
  /**
   * Replaces the whole document as a single transaction with origin `'load'` and emits one
   * `change` event with the diff against the old document. Also allowed when `readOnly`.
   * Throws {@link InvalidDocumentError} when invalid (state is left unchanged).
   */
  loadDocument(doc: BoardDocument): void;
  /**
   * Creates a new element with default values and stores it in the document (BOARD-205).
   *
   * @returns The new element record, or `undefined` when rejected (for example props fail the
   *   type schema or the maximum element count is reached).
   * @beta
   */
  create<T = Record<string, unknown>>(
    element: PartialElement<ResolveElementProps<T>>,
    options?: MutateOptions,
  ): Readonly<ElementRecord<ResolveElementProps<T>>> | undefined;
  /**
   * Updates an existing element with a partial patch (BOARD-205). Props are merged per key.
   *
   * @returns The updated element record, or `undefined` when the element is not found, is
   *   locked (without `force`), or the new props fail the type schema.
   * @beta
   */
  update<T = Record<string, unknown>>(
    id: string,
    patch: ElementPatch<ResolveElementProps<T>>,
    options?: UpdateOptions,
  ): Readonly<ElementRecord<ResolveElementProps<T>>> | undefined;
  /**
   * Deletes elements together with their children (frames/groups) and attached bindings (BOARD-205).
   *
   * @returns IDs of the records that were deleted.
   * @beta
   */
  delete(ids: string | Iterable<string>, options?: DeleteOptions): readonly string[];
  /** Element record with the given ID, or `undefined` when missing or not an element. */
  getElement<T = Record<string, unknown>>(
    id: string,
  ): Readonly<ElementRecord<ResolveElementProps<T>>> | undefined;
  /**
   * Finds elements in the document by type, page, parent, and spatial bounds filters (BOARD-206).
   *
   * @typeParam T - Element type name registered in {@link BoardElementTypes}, or a custom props type.
   * @returns Matching element records, deterministically ordered from bottom layer to top.
   * @public
   */
  query<T = Record<string, unknown>>(
    filter?: QueryFilter,
  ): readonly Readonly<ElementRecord<ResolveElementProps<T>>>[];
  /**
   * Runs `fn` as a single transaction and returns its result.
   *
   * - Nested transactions are merged into the outermost one (their options are ignored). When an inner
   *   `fn` throws, only its changes are rolled back, then the error propagates to the outer transaction.
   * - When `fn` throws, all changes are rolled back and the error is rethrown.
   * - On completion, one `change` event is emitted if there is a net change.
   * - `fn` must be synchronous.
   *
   * @throws {@link ReadOnlyBoardError} when the board is `readOnly` and the origin is `'local'`.
   */
  transact<T>(fn: (tx: Transaction) => T, options?: TransactOptions): T;
  /**
   * Listens to board events (see {@link BoardEventMap}). Returns a function that stops
   * listening. A throwing listener does not stop other listeners and does not make the
   * caller (for example `transact`) throw; its error is emitted as an `error` event
   * with code `listener-error`.
   */
  on<K extends keyof BoardEventMap>(type: K, listener: Listener<BoardEventMap[K]>): Unsubscribe;
  /** Creates a new record ID using the `createId` option (nanoid by default). */
  createId(): string;
  /** Frozen camera snapshot. */
  getCamera(): Readonly<CameraState>;
  /**
   * Changes the camera. Non-finite values are ignored, and zoom is clamped to `zoomRange`.
   * Emits a `camera` event when the camera actually changes.
   */
  setCamera(patch: Partial<CameraState>): void;
  /**
   * IDs of the selected elements, in selection order (BOARD-405). A frozen array that stays the same
   * object until the selection changes.
   *
   * The selection is local UI state: it is not part of the document, is not saved, and is not
   * recorded in undo history. It only ever holds IDs of existing elements; elements deleted by any
   * origin (local, remote, undo, `loadDocument`) leave the selection automatically.
   *
   * @beta
   */
  readonly selection: readonly string[];
  /**
   * Axis-aligned bounds enclosing every selected element, accounting for rotation and element
   * geometry (BOARD-405), or `null` when nothing is selected. Computed on every read.
   *
   * @beta
   */
  readonly selectionBounds: Readonly<BoxBounds> | null;
  /**
   * Replaces the selection. IDs that are not existing elements are ignored, and duplicates are
   * dropped. Emits a `selection` event only when the selection actually changes. Allowed on
   * `readOnly` boards.
   *
   * @throws `TypeError` when `ids` is not a string or an array of strings, or `Error` after `dispose`.
   * @beta
   */
  select(ids: SelectionInput): void;
  /**
   * Appends elements to the end of the selection; already-selected IDs keep their position.
   * Same filtering, events, and errors as {@link Board.select}.
   *
   * @beta
   */
  addToSelection(ids: SelectionInput): void;
  /**
   * Removes elements from the selection. Same events and errors as {@link Board.select}.
   *
   * @beta
   */
  removeFromSelection(ids: SelectionInput): void;
  /**
   * Empties the selection. Emits a `selection` event only when something was selected.
   *
   * @throws `Error` after `dispose`.
   * @beta
   */
  clearSelection(): void;
  /**
   * Undoes the last local step: its inverse diff is applied as a transaction with origin
   * `'undo'` and the original transaction's label. Records changed by another party (for example
   * `remote`) since that step are skipped; a step that cannot be reversed at all is dropped and
   * undo continues with the previous step.
   *
   * @returns `true` when changes were applied, `false` when there is nothing to undo
   *   (always the case on a `readOnly` board, since its history is always empty). When a tool is
   *   mid-interaction, undo only cancels that interaction and returns `true`.
   * @throws `Error` when called inside `transact` or after `dispose`.
   */
  undo(): boolean;
  /**
   * Reapplies the most recently undone step as a transaction with origin `'redo'`. Conflict
   * rules, return value, and errors are the same as {@link Board.undo}. An in-progress tool
   * interaction is cancelled first.
   */
  redo(): boolean;
  /**
   * Undo history state. Only transactions with origin `'local'` are recorded; a new local change
   * clears the redo stack; `loadDocument` and migrations clear the history. Changes to
   * `canUndo`/`canRedo` are emitted through the `history` event.
   */
  readonly history: BoardHistory;
  /**
   * Runs a registered command (BOARD-503).
   *
   * @returns `true` when the command ran, `false` when `isEnabled` rejected it.
   * @throws {@link CommandError} with code `unknown-command` when the ID is not registered, or `Error`
   *   after `dispose`. Errors from `isEnabled` or `run` are propagated as-is.
   */
  run(id: string, args?: unknown): boolean;
  /** This board's command registry: the source for the command palette and shortcuts. */
  readonly commands: BoardCommands;
  /** This board's element type registry (BOARD-601, BOARD-602). */
  readonly elements: ElementRegistry;
  /** Plugins installed on this board, in installation order (BOARD-602). */
  readonly plugins: BoardPlugins;
  /**
   * This board's tool registry (BOARD-501).
   *
   * @beta
   */
  readonly tools: BoardTools;
  /**
   * Activates a tool. The previous tool's interaction is cancelled (rolled back). Emits a `tool`
   * event when the tool changes.
   *
   * @throws `ToolError` with code `unknown-tool` when the ID is not registered.
   * @beta
   */
  setTool(id: string): void;
  /**
   * Active tool ID, or `null` when none is set.
   *
   * @beta
   */
  readonly tool: string | null;
  /**
   * Active tool state (for example `'idle'`), or `null` when no tool is active.
   *
   * @beta
   */
  readonly toolState: string | null;
  /**
   * CSS cursor for the current tool state. The renderer reads it after `dispatch`.
   *
   * @beta
   */
  readonly cursor: string;
  /**
   * Sends a normalized input event from the renderer to the active tool.
   *
   * @returns `true` when the event was handled (the renderer should call `preventDefault`).
   * @throws `Error` after `dispose`. Errors from tool handlers are propagated after the interaction
   *   is rolled back.
   * @beta
   */
  dispatch(event: BoardInputEvent): boolean;
  /** Read-only mode (see {@link CreateBoardOptions.readOnly}). */
  readonly readOnly: boolean;
  readonly locale: BoardLocale;
  /**
   * External data resolver map for custom elements (BOARD-211, BOARD-604).
   *
   * @beta
   */
  readonly resolvers: BoardResolvers;
  /**
   * Adapter for resolving URLs and uploading media assets (BOARD-211, BOARD-1103).
   *
   * @beta
   */
  readonly assets: Readonly<AssetAdapter> | null;
  /**
   * Local user identity (BOARD-211, BOARD-212).
   *
   * @beta
   */
  readonly user: Readonly<BoardUser> | null;
  /**
   * Limits on document size, element count, and stroke points (BOARD-210, BOARD-211).
   *
   * @public
   */
  readonly limits: Readonly<BoardLimits>;
  /**
   * Combined permission hook from the application and all installed plugins (BOARD-211, BOARD-212).
   * `null` when no permission hook is registered.
   *
   * @beta
   */
  readonly permissions: PermissionHook | null;
  /**
   * Checks whether an operation is allowed by the application and plugin permission hooks (BOARD-212).
   * All hooks are combined with AND logic: the operation is allowed only if no hook
   * returns `false`.
   *
   * @param action - Operation kind: `'create'`, `'update'`, `'delete'`, `'action'`, or a custom action string.
   * @param element - Target element, or `null` for a general/global action.
   * @returns `true` when allowed, `false` when rejected by any hook.
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
  can(action: PermissionAction, element?: Readonly<ElementRecord> | null): boolean;
  /**
   * Runs an element's contextual action with a permission check (BOARD-212, BOARD-605).
   *
   * Before calling `action.run()`, checks permission with `board.can('action', element)`.
   * When rejected, emits an `error` event with code `'forbidden'` and returns `false` without
   * calling `action.run()`.
   *
   * @param action - The element action to run.
   * @param element - The element that owns the action.
   * @returns `true` when the action ran, `false` when rejected by a permission hook or `action.isEnabled()`.
   *
   * @beta
   */
  runAction(action: ElementAction, element: Readonly<ElementRecord>): boolean;
  /**
   * Whether the board has been disposed with {@link Board.dispose}.
   *
   * @public
   */
  readonly disposed: boolean;
  /**
   * R-tree spatial index (rbush) for area queries and viewport culling (BOARD-404, BOARD-206).
   *
   * @public
   */
  readonly spatial: SpatialIndex;
  /**
   * Runs plugin teardowns in reverse order, then releases all listeners, commands, tools,
   * and history. Safe to call more than once. Afterwards `transact`, `loadDocument`, `undo`,
   * `redo`, `run`, `setTool`, and `dispatch` throw.
   */
  dispose(): void;
}

/**
 * Creates an empty board document with one default page (`page:main`).
 *
 * @param meta - Free-form caller metadata; shallow-copied and never modified by the package.
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

/**
 * Runs core schema migrations (BOARD-701), validates, and then copies the input document so it is
 * not linked to board state.
 */
function toOwnedDocument(input: BoardDocument): BoardDocument {
  const doc = migrateSchema(input);
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
  if (user.role !== undefined && typeof user.role !== 'string') {
    throw new TypeError('user.role wajib berupa string.');
  }
  if (user.meta !== undefined && !isPlainObject(user.meta)) {
    throw new TypeError('user.meta wajib berupa objek.');
  }
  return Object.freeze({
    id: user.id,
    ...(user.name !== undefined ? { name: user.name } : {}),
    ...(user.color !== undefined ? { color: user.color } : {}),
    ...(user.role !== undefined ? { role: user.role } : {}),
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
 * Creates a new `Board` instance with no DOM dependency.
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
    // Errors from an `error` listener itself, or with no `error` listener, are not re-emitted
    // (preventing infinite recursion) but are not silently swallowed either.
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

  const elements = createElementRegistry();
  const spatial = createSpatialIndex((el) => {
    const def = elements.get(el.type);
    return def?.geometry ? def.geometry(el as never) : undefined;
  });

  const store = createRecordStore(
    options.document ? toOwnedDocument(options.document) : createEmptyDocument(),
    {
      freeze,
      readOnly,
      onChange: (event) => {
        // Update the spatial index incrementally (BOARD-404, BOARD-206)
        if (event.origin === 'load') {
          spatial.clear();
          spatial.load(
            Object.values(store.getDocument().records).filter(
              (r): r is ElementRecord => r.kind === 'element',
            ),
          );
        } else {
          for (const rec of Object.values(event.added)) {
            if (rec.kind === 'element') spatial.insert(rec);
          }
          for (const update of Object.values(event.updated)) {
            if (update.after.kind === 'element') spatial.update(update.after);
            else if (update.before.kind === 'element') spatial.remove(update.before.id);
          }
          for (const rec of Object.values(event.removed)) {
            if (rec.kind === 'element') spatial.remove(rec.id);
          }
        }

        // Tool interaction transactions are recorded as a single step when the interaction ends.
        if (interaction.capturing) interaction.observe(event);
        // History is updated first so `change` listeners read the new canUndo/canRedo.
        else history.observe(event);
        events.emit('change', event);
        history.flush();
        // After `change`, so `selection` listeners see the document that caused the change.
        selection.observe(event);
      },
    },
  );

  // Initialize the spatial index from the initial document
  spatial.load(
    Object.values(store.getDocument().records).filter(
      (r): r is ElementRecord => r.kind === 'element',
    ),
  );
  const history = createLocalHistory(store, {
    limit: historyLimit,
    onStateChange: (state) => events.emit('history', state),
  });
  let camera: CameraState = Object.freeze({ x: 0, y: 0, zoom: 1 });
  const selection = createSelection({
    isElement: (id) => store.getRecord(id)?.kind === 'element',
    getBounds: (id) => spatial.getBounds(id),
    onChange: (event) => events.emit('selection', event),
  });
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

  function checkPermissions(
    action: PermissionAction,
    element: Readonly<ElementRecord> | null,
    targetUser: Readonly<BoardUser> | null,
  ): boolean {
    if (permissions !== null) {
      try {
        if (permissions(action, element, targetUser) === false) {
          return false;
        }
      } catch {
        return false;
      }
    }
    for (const hook of plugins.getPermissions()) {
      try {
        if (hook(action, element, targetUser) === false) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  function can(action: PermissionAction, element: Readonly<ElementRecord> | null = null): boolean {
    if (disposed) return false;
    return checkPermissions(action, element, user);
  }

  const mutationCtx: MutationContext = {
    getDocument: () => store.getDocument(),
    getElement: (id) => board.getElement(id),
    transact: (fn, txOpts) => store.transact(fn, txOpts),
    elements,
    limits,
    user,
    checkPermission: (action, element) => can(action, element),
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
    get permissions(): PermissionHook | null {
      const pluginHooks = plugins.getPermissions();
      if (pluginHooks.length === 0) {
        return permissions;
      }
      if (permissions === null && pluginHooks.length === 1) {
        return pluginHooks[0]!;
      }
      return checkPermissions;
    },
    can(action, element) {
      return can(action, element ?? null);
    },
    runAction(action, element) {
      assertUsable();
      if (!isPlainObject(action) || typeof action.run !== 'function') {
        throw new TypeError(
          'Argumen action pada board.runAction wajib berupa objek dengan method run().',
        );
      }
      if (!isPlainObject(element) || element.kind !== 'element') {
        throw new TypeError('Argumen element pada board.runAction wajib berupa ElementRecord.');
      }
      if (!can('action', element)) {
        emitError(
          'forbidden',
          `Menjalankan aksi "${action.id}" pada elemen "${element.id}" ditolak oleh hook izin.`,
          { action: 'action', actionId: action.id, element, user },
        );
        return false;
      }
      if (typeof action.isEnabled === 'function' && !action.isEnabled()) {
        return false;
      }
      action.run();
      return true;
    },
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
      let currentDoc = doc;
      for (const plugin of plugins.api.list()) {
        if (plugin.migrations) {
          let step = plugin.migrations[currentDoc.schemaVersion];
          while (typeof step === 'function') {
            const prevVersion = currentDoc.schemaVersion;
            currentDoc = step(currentDoc);
            if (currentDoc.schemaVersion === prevVersion) break;
            step = plugin.migrations[currentDoc.schemaVersion];
          }
        }
      }
      const owned = toOwnedDocument(currentDoc);
      // The diff of an in-progress interaction does not apply to the new document.
      tools.reset();
      history.api.clear();
      store.replaceDocument(owned, 'load');
    },
    getElement(id: string) {
      const rec = store.getRecord(id);
      return rec?.kind === 'element' ? (rec as never) : undefined;
    },
    query(filter) {
      assertUsable();
      return queryElements(store.getDocument(), spatial, filter) as never;
    },
    spatial,
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
    get selection() {
      return selection.ids;
    },
    get selectionBounds() {
      return selection.bounds;
    },
    select(ids: SelectionInput): void {
      assertUsable();
      selection.select(ids);
    },
    addToSelection(ids: SelectionInput): void {
      assertUsable();
      selection.add(ids);
    },
    removeFromSelection(ids: SelectionInput): void {
      assertUsable();
      selection.remove(ids);
    },
    clearSelection(): void {
      assertUsable();
      selection.clear();
    },
    dispose(): void {
      if (disposed) return;
      try {
        plugins.dispose();
      } finally {
        disposed = true;
        spatial.clear();
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
