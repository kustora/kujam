/**
 * `@kujam/core` — Framework-agnostic whiteboard core with no DOM and no runtime dependencies.
 *
 * @packageDocumentation
 */

import { createBrushRegistry, type BrushDefinition, type BrushRegistry } from './elements/brushes.js';
import { deepClone } from './utils/clone.js';
import { createCommandRegistry, type BoardCommands } from './tools/commands.js';
import {
  createElementRegistry,
  type ElementAction,
  type ElementActionContext,
  type ElementContext,
  type ElementRegistry,
  type ResolveResult,
} from './elements/elements.js';
import {
  createEmitter,
  reportUnhandled,
  type BoardErrorCode,
  type BoardEventMap,
  type Listener,
  type Unsubscribe,
} from './events/events.js';
import {
  createLocalHistory,
  resolveHistoryLimit,
  resolveMergeWindow,
  type BoardHistory,
  type HistoryOptions,
} from './history/history.js';
import { createId as createRandomId, type IdGenerator } from './utils/ids.js';
import { createInteraction } from './tools/interaction.js';
import { createToolStyles, type ToolStyles } from './tools/tool-styles.js';
import { resolveLimits, type BoardLimits } from './document/limits.js';
import {
  createPluginRuntime,
  resolvePluginOrder,
  type AnyPluginDefinition,
  type BoardPlugins,
  type BoardUser,
  type PermissionAction,
  type PermissionHook,
  type PluginMigrations,
} from './plugins/plugins.js';
import { createRecordStore, type TransactOptions, type Transaction } from './document/store.js';
import {
  createToolRuntime,
  DEFAULT_TOOL_ID,
  type BoardInputEvent,
  type BoardTools,
  type ToolKeyEvent,
} from './tools/tools.js';
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
} from './document/mutate.js';
import {
  createCamera,
  resolveFrameScheduler,
  resolveZoomRange,
  type BoardCamera,
  type FrameScheduler,
  type ZoomRange,
} from './camera/camera.js';
import {
  findTooNew,
  latestPluginVersion,
  migrateContent,
  migrateSchema,
  type DocumentTooNewReason,
} from './document/migrations.js';
import { createPages, type BoardPages } from './pages/pages.js';
import { createSelection, type SelectionInput } from './selection/selection.js';
import { resolveSnapOptions, type SnapOptions } from './geometry/snap.js';
import { createSpatialIndex, unionBounds, type BoxBounds, type SpatialIndex } from './geometry/spatial.js';
import { hitTestElements, queryElements, type HitTestOptions, type QueryFilter } from './geometry/query.js';
import { resolveElementGeometry, toBoardTolerance, type Geometry, type Point } from './geometry/geometry.js';
import type { BoardDocument, CameraState, ElementRecord } from './types.js';
import { CURRENT_SCHEMA_VERSION } from './types.js';
import { InvalidDocumentError, inspectDocument } from './document/validate.js';
import {
  createKeymap,
  detectPlatform,
  type BoardKeybindings,
  type KeyboardPlatform,
} from './tools/keybindings.js';
import {
  resolveTheme,
  type ThemeDefinition,
  type ThemeMode,
} from './theme/theme.js';

export * from './types.js';
export { deepClone } from './utils/clone.js';
export {
  InvalidDocumentError,
  validateDocument,
  type DocumentPropsValidator,
  type ValidateDocumentOptions,
  type ValidationResult,
} from './document/validate.js';
export { DEFAULT_BOARD_LIMITS, DOCUMENT_LIMITS, type BoardLimits } from './document/limits.js';
export * from './document/schema.js';
export {
  DEFAULT_URL_SCHEMES,
  isSafeUrl,
  MAX_URL_LENGTH,
  SAFE_LINK_REL,
  safeLinkAttributes,
  sanitizeUrl,
  type SafeUrlOptions,
} from './utils/url.js';
export * from './elements/elements.js';
export * from './geometry/geometry.js';
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
} from './plugins/plugins.js';
export {
  CommandError,
  defineCommand,
  type AnyCommandDefinition,
  type BoardCommands,
  type CommandDefinition,
  type CommandErrorCode,
} from './tools/commands.js';
export {
  DEFAULT_TOOL_ID,
  defineTool,
  ERASER_TOOL_ID,
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
} from './tools/tools.js';
export type {
  ToolStyle,
  ToolStyleEvent,
  ToolStylePatch,
  ToolStyles,
  ToolStyleValue,
} from './tools/tool-styles.js';
export {
  BRUSH_BLEND_MODES,
  BrushError,
  DEFAULT_BRUSH_ID,
  defineBrush,
  type BrushBlendMode,
  type BrushDefinition,
  type BrushErrorCode,
  type BrushInput,
  type BrushRegistry,
  type BrushStrokeOptions,
} from './elements/brushes.js';
export { createId, DEFAULT_ID_LENGTH, type IdGenerator } from './utils/ids.js';
export { compareIndex, indexAbove, indexBelow, indexBetween, indicesBetween } from './document/indexing.js';
export {
  CLIPBOARD_MIME_TYPE,
  ContentError,
  extractContent,
  insertContent,
  parseClipboard,
  serializeClipboard,
  type ClipboardPayload,
  type ContentErrorCode,
  type InsertContentOptions,
  type InsertContentResult,
} from './clipboard/clipboard.js';
export type {
  ActionEvent,
  BoardErrorCode,
  BoardErrorEvent,
  BoardEventMap,
  CameraEvent,
  Listener,
  PageEvent,
  SelectionEvent,
  ToolEvent,
  Unsubscribe,
} from './events/events.js';
export {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_MERGE_WINDOW_MS,
  type BoardHistory,
  type HistoryEvent,
  type HistoryOptions,
  type HistoryStep,
} from './history/history.js';
export {
  CHANGE_ORIGINS,
  ReadOnlyBoardError,
  type ChangeEvent,
  type ChangeOrigin,
  type RecordUpdate,
  type RecordsDiff,
  type TransactOptions,
  type Transaction,
} from './document/store.js';
export {
  type DeleteOptions,
  type ElementPatch,
  type MutateOptions,
  type PartialElement,
  type UpdateOptions,
} from './document/mutate.js';
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
} from './geometry/spatial.js';
export { queryElements, type HitTestOptions, type QueryFilter } from './geometry/query.js';
export type { BoardKeybindings, Keybinding, KeyboardPlatform } from './tools/keybindings.js';
export {
  DEFAULT_DUPLICATE_OFFSET,
  defaultCommands,
  NUDGE_DISTANCE,
  NUDGE_DISTANCE_LARGE,
  type DuplicateArgs,
  type NudgeArgs,
} from './tools/default-commands.js';
export {
  getReadingOrder,
  nextInReadingOrder,
  revealBounds,
  sortReadingOrder,
  type ReadingDirection,
  type ReadingOrder,
  type ReadingOrderItem,
  type RevealOptions,
} from './a11y/reading-order.js';
export {
  DEFAULT_MIN_SIZE,
  moveElements,
  resizeElements,
  RESIZE_HANDLES,
  rotateElements,
  ROTATION_SNAP_DEGREES,
  selectionFrame,
  transformHandles,
  type ResizeHandle,
  type ResizeOptions,
  type RotateOptions,
  type TransformBehavior,
  type TransformHandlePoint,
  type TransformOptions,
  type TransformResult,
} from './geometry/transform.js';
export {
  computeSnap,
  DEFAULT_SNAP_OPTIONS,
  isSnapSuppressed,
  snapTranslation,
  type ComputeSnapOptions,
  type SnapGuide,
  type SnapOptions,
  type SnapResult,
  type SnapTranslationOptions,
} from './geometry/snap.js';
export {
  CORE_MIGRATIONS,
  MigrationError,
  migrateSchema,
  type DocumentTooNewReason,
  type MigrationSource,
  type SchemaMigration,
  type SchemaMigrations,
} from './document/migrations.js';
export type { BoardPages, PageInput } from './pages/pages.js';
export type { SelectionInput } from './selection/selection.js';
export {
  DEFAULT_CAMERA_ANIMATION_MS,
  DEFAULT_ZOOM_PADDING,
  DEFAULT_ZOOM_RANGE,
  type BoardCamera,
  type CameraAnimation,
  type FrameScheduler,
  type ViewportSize,
  type ZoomRange,
  type ZoomToOptions,
} from './camera/camera.js';
export {
  attachStorage,
  DEFAULT_SAVE_DEBOUNCE_MS,
  type AttachStorageOptions,
  type PageLifecycleTarget,
  type SaveErrorEvent,
  type SaveRetryOptions,
  type SaveStartEvent,
  type SaveSuccessEvent,
  type StorageAttachment,
  type StorageEventMap,
  type StorageStatus,
} from './storage/storage.js';
export {
  COLOR_KEYS,
  createTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  STICKY_COLORS,
  type ColorKey,
  type CustomThemeOverrides,
  type StickyColor,
  type ThemeCanvasTokens,
  type ThemeDefinition,
  type ThemeMode,
  type ThemeSelectionTokens,
  type ThemeTypographyTokens,
} from './theme/theme.js';

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
 * Options for creating a `Board` instance (BOARD-211).
 *
 * @public
 */
export interface CreateBoardOptions {
  /**
   * Initial board document; when omitted, a new document with one page (`page:main`) is created.
   *
   * Validated like {@link Board.loadDocument} (BOARD-210), with props checked against the element
   * types of `plugins` (types registered later, inside a plugin's `setup`, are not checked here).
   * Document-level problems make `createBoard` throw {@link InvalidDocumentError}. Invalid records
   * are dropped and reported as `invalid-record` `error` events on the next microtask, so listeners
   * attached right after `createBoard` receive them.
   *
   * Migrated like {@link Board.loadDocument}: element and plugin migrations run once plugins are
   * installed, with origin `'migration'`. When a migration fails, the board is disposed and the
   * {@link MigrationError} is thrown.
   */
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
   *
   * Independently of this option, a document newer than this board understands (its
   * `schemaVersion`, an element `typeVersion`, or a plugin version) is opened read-only and is
   * never migrated; an `error` event with code `document-too-new` is emitted (BOARD-703). For the
   * initial document, that event is emitted asynchronously so listeners registered right after
   * `createBoard` receive it.
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
   * Starts with camera animations turned off (BOARD-402, BOARD-1905). The renderer usually sets it
   * later from `prefers-reduced-motion` via `board.camera.setReducedMotion`. Defaults to `false`.
   *
   * @beta
   */
  reducedMotion?: boolean;
  /**
   * Frame and clock source for camera animations (BOARD-402). Defaults to `requestAnimationFrame`
   * (or `setTimeout` where it is missing) and `performance.now()`.
   *
   * @beta
   */
  frameScheduler?: FrameScheduler;
  /**
   * Snap settings for dragging (BOARD-407); omitted fields use {@link DEFAULT_SNAP_OPTIONS}
   * (enabled, 8-unit grid, 8-pixel threshold).
   *
   * @beta
   */
  snap?: Partial<SnapOptions>;
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
  /**
   * Consumer shortcuts (BOARD-504), for example `{ 'Mod+D': 'element.duplicate', k: 'tool:pen' }`.
   * They win over plugin `keybindings` for the same chord; `null` removes a plugin shortcut. See
   * {@link BoardKeybindings} for the notation.
   *
   * @beta
   */
  keybindings?: Readonly<Record<string, string | null>>;
  /**
   * Platform that decides what `Mod` means in shortcuts: Cmd on `'mac'`, Ctrl elsewhere. Detected
   * from `navigator` when available, otherwise `'other'`.
   *
   * @beta
   */
  platform?: KeyboardPlatform;
  /**
   * Whiteboard theme: `'light'` (default), `'dark'`, or a custom {@link ThemeDefinition} (BOARD-1006).
   *
   * @beta
   */
  theme?: ThemeMode | ThemeDefinition;
}

/**
 * Result of {@link Board.prepareDocument}.
 *
 * @beta
 */
export interface PreparedDocument {
  /** Validated, migrated copy, not linked to the input or the board; invalid records removed. */
  readonly document: BoardDocument;
  /** Records left out because they are invalid, with the reasons (same as `invalid-record`). */
  readonly rejected: readonly { readonly id: string; readonly errors: readonly string[] }[];
  /** Why the document is newer than this board understands, or `null` (BOARD-703). */
  readonly tooNew: DocumentTooNewReason | null;
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
   *
   * Migrations run first (BOARD-701, BOARD-702): core schema migrations before validation, then
   * element props and plugin document migrations. When those change anything, the result is
   * applied as a second transaction with origin `'migration'`, which never enters undo history.
   *
   * Throws {@link InvalidDocumentError} when invalid, or {@link MigrationError} when a migration
   * fails (state is left unchanged in both cases).
   *
   * The document is checked with {@link validateDocument} against this board's element registry
   * and `limits` (BOARD-210). Invalid records are dropped one by one and each is reported as an
   * `error` event with code `invalid-record` after the `change` event; the rest still loads.
   * Document-level problems (shape, schema version, byte size, element count) throw
   * {@link InvalidDocumentError} and leave the state unchanged.
   */
  loadDocument(doc: BoardDocument): void;
  /**
   * Runs the same incoming-document pipeline as {@link Board.loadDocument} without touching the
   * board: core schema migrations, validation against this board's element registry and `limits`,
   * then element and plugin migrations (BOARD-210, BOARD-701, BOARD-702). Emits no events.
   * Used to import content into an existing board (BOARD-1701).
   *
   * A document newer than this board understands is returned unmigrated with `tooNew` set
   * (BOARD-703); callers must not write it into the board.
   *
   * @throws {@link InvalidDocumentError} for document-level problems, or {@link MigrationError}
   *   when a migration fails.
   * @beta
   */
  prepareDocument(doc: BoardDocument): PreparedDocument;
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
   * Elements whose type is not registered (BOARD-209) can still be moved, resized, locked, and
   * deleted, but their props are kept as loaded: a `props` patch is rejected with `invalid-props`.
   *
   * @returns The updated element record, or `undefined` when the element is not found, is
   *   locked (without `force`), the new props fail the type schema, or the type is not registered
   *   and the patch changes props.
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
   * Without `pageId`, only the current page is searched (BOARD-208); pass `allPages: true` to
   * search every page.
   *
   * @typeParam T - Element type name registered in {@link BoardElementTypes}, or a custom props type.
   * @returns Matching element records, deterministically ordered from bottom layer to top.
   * @public
   */
  query<T = Record<string, unknown>>(
    filter?: QueryFilter,
  ): readonly Readonly<ElementRecord<ResolveElementProps<T>>>[];
  /**
   * Finds the topmost element at a board point, using the spatial index (BOARD-403, BOARD-404).
   *
   * Elements are tested against their `geometry` (or their `w × h` box), with rotation applied.
   * The topmost element follows paint order: siblings by layer index, and children of a frame or
   * group above their container. `locked` elements are skipped unless `includeLocked` is set.
   * Without `pageId`, only the current page is tested (BOARD-208) unless `allPages` is set.
   *
   * @param point - Point in board coordinates.
   * @returns The hit element, or `undefined` when nothing is under the point.
   * @throws `TypeError` when `point` or `tolerance` is not a finite number, or `Error` after `dispose`.
   * @beta
   */
  hitTest(point: Point, options?: HitTestOptions): Readonly<ElementRecord> | undefined;
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
  /**
   * Reports a runtime error through the board's `error` event (BOARD-207, BOARD-810).
   *
   * @param code - Error code (see {@link BoardErrorCode}).
   * @param message - Diagnostic message in Indonesian.
   * @param cause - Error instance or contextual metadata.
   * @beta
   */
  reportError(code: BoardErrorCode, message: string, cause?: unknown): void;
  /** Creates a new record ID using the `createId` option (nanoid by default). */
  createId(): string;
  /**
   * Camera: position, zoom, viewport size, and screen/board coordinate conversion (BOARD-401).
   * Camera changes are local UI state: not part of the document, not saved, not in undo history,
   * and allowed on `readOnly` boards.
   *
   * @beta
   */
  readonly camera: BoardCamera;
  /**
   * Current snap settings (BOARD-407), frozen. Local UI state, like the camera.
   *
   * @beta
   */
  readonly snapOptions: Readonly<SnapOptions>;
  /**
   * Changes snap settings, for example `{ grid: null }` to turn off grid snapping or
   * `{ enabled: false }` to turn snapping off.
   *
   * @throws `TypeError` or `RangeError` for invalid values (settings are left unchanged).
   * @beta
   */
  setSnapOptions(patch: Partial<SnapOptions>): void;
  /** Frozen camera snapshot. Same as `board.camera.get()`. */
  getCamera(): Readonly<CameraState>;
  /**
   * Changes the camera. Non-finite values are ignored, and zoom is clamped to `zoomRange`.
   * Emits a `camera` event when the camera actually changes. Same as `board.camera.set()`.
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
   * Pages of the document and the current page (BOARD-208). Query, hit-test, new elements, and
   * the selection default to the current page.
   *
   * @beta
   */
  readonly pages: BoardPages;
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
   * `canUndo`/`canRedo` are emitted through the `history` event. A tool interaction is one step;
   * other continuous edits merge with `mergeKey` or `history.batch` (BOARD-302).
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
   * This board's freehand brush registry (BOARD-603). Plugins register their `brushes` here; the
   * renderer and pen tool look strokes up with `resolve`, which falls back to the default pen.
   *
   * @beta
   */
  readonly brushes: BrushRegistry;
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
   * `ctx.data` of the active tool, or `undefined` when no tool is active. The renderer reads it
   * after `dispatch` to draw tool feedback, for example the selection box or snap guides of the
   * select tool (BOARD-502). Treat it as read-only.
   *
   * @beta
   */
  readonly toolData: unknown;
  /**
   * Context passed to element callbacks such as `onDoubleClick` (BOARD-502): the board locale and
   * `emit`, which emits an `action` event (BOARD-605).
   *
   * @beta
   */
  readonly elementContext: ElementContext;
  /**
   * Shortcut map: plugin `keybindings` overridden by the consumer's (BOARD-504).
   *
   * @beta
   */
  readonly keybindings: BoardKeybindings;
  /**
   * Sends a normalized input event from the renderer to the active tool.
   *
   * Key events run a matching shortcut (BOARD-504) when the tool is idle; during a tool
   * interaction they only go to the tool, so Esc cancels it. With `inTextInput`, every key except
   * Escape is ignored.
   *
   * @returns `true` when the event was handled (the renderer should call `preventDefault`).
   * @throws `Error` after `dispose`. Errors from tool handlers are propagated after the interaction
   *   is rolled back.
   * @beta
   */
  dispatch(event: BoardInputEvent): boolean;
  /**
   * Read-only mode: the `readOnly` option, or forced while the loaded document is too new
   * (see {@link CreateBoardOptions.readOnly}). Loading a supported document lifts the forced mode.
   */
  readonly readOnly: boolean;
  /**
   * Sets or unsets the read-only mode for this board.
   *
   * @param readOnly - Whether the board should be read-only.
   * @throws `Error` after `dispose`.
   * @beta
   */
  setReadOnly(readOnly: boolean): void;
  readonly locale: BoardLocale;
  /**
   * Updates the UI locale ('id' | 'en') of this board.
   *
   * @param locale - Target locale.
   * @throws `Error` after `dispose`.
   * @beta
   */
  setLocale(locale: BoardLocale): void;
  /**
   * Active whiteboard theme (BOARD-1006).
   *
   * @beta
   */
  readonly theme: Readonly<ThemeDefinition>;
  /**
   * Updates the active whiteboard theme and emits a `theme` event (BOARD-1006).
   *
   * @beta
   */
  setTheme(theme: ThemeMode | ThemeDefinition): void;
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
   * Contextual actions shared by every given element, `board.selection` by default (BOARD-605,
   * BOARD-1108): only actions whose ID every element provides, in the first element's order. With
   * no element, or an element whose type has no `actions`, the list is empty.
   *
   * The returned actions apply to all the elements at once: `run()` runs each element's action in
   * one transaction (one undo step, labelled with the action ID). Like {@link Board.runAction}, it
   * checks `board.can('action', element)` first; when any element is rejected, nothing runs and an
   * `error` event with code `'forbidden'` is emitted. `isEnabled()` is `true` only when every
   * element allows and enables the action; `isActive()` only when the action is active on every
   * element.
   *
   * @beta
   */
  getActions(ids?: SelectionInput): readonly ElementAction[];
  /**
   * Remembered style per tool (BOARD-1108): creation tools read it for the next element, and the UI
   * and element style actions write it. Session state: not in the document, not saved, not in undo
   * history, and allowed on `readOnly` boards. Changes emit a `tool-style` event.
   *
   * @beta
   */
  readonly toolStyles: ToolStyles;
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

/** An incoming record left out of a loaded document because it is invalid (BOARD-210). */
interface RejectedRecord {
  readonly id: string;
  readonly errors: readonly string[];
  readonly record: unknown;
}

/**
 * Runs core schema migrations (BOARD-701), validates the document (BOARD-210), and copies it so it is
 * not linked to board state. Document-level problems throw {@link InvalidDocumentError}; invalid
 * records are left out of the copy one by one and returned so the caller can report them.
 *
 * Props are only checked for elements already at their registered type version: older ones are
 * checked again after element migrations (BOARD-702), and newer ones are left untouched (BOARD-703).
 * With `allowNewerSchema`, a document newer than {@link CURRENT_SCHEMA_VERSION} is accepted as-is so
 * it can be opened read-only.
 */
function toOwnedDocument(
  input: BoardDocument,
  registry: ElementRegistry | undefined,
  limits: Readonly<BoardLimits>,
  allowNewerSchema = false,
): { document: BoardDocument; rejected: RejectedRecord[] } {
  const doc = migrateSchema(input);
  const { documentErrors, invalidRecords } = inspectDocument(doc, registry, limits, {
    allowNewerSchema,
    checkProps: (element) => {
      const def = registry?.get(element.type as string);
      return def === undefined || (element.typeVersion ?? 1) === def.version;
    },
  });
  if (documentErrors.length > 0) {
    throw new InvalidDocumentError(documentErrors);
  }
  const rejected: RejectedRecord[] = [];
  const records: Record<string, unknown> = {};
  for (const [id, record] of Object.entries(doc.records)) {
    if (Object.hasOwn(invalidRecords, id))
      rejected.push({ id, errors: invalidRecords[id]!, record });
    // `Object.defineProperty` keeps IDs such as `__proto__` as own keys.
    else
      Object.defineProperty(records, id, {
        value: record,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return { document: deepClone({ ...doc, records } as BoardDocument), rejected };
}

/**
 * Element registry built from the element definitions of `plugins`, used to validate the props of
 * the initial document before the plugins are installed. Returns `undefined` when the plugins are
 * invalid; installing them throws the proper error later.
 */
function previewElementRegistry(
  plugins: Iterable<AnyPluginDefinition> | undefined,
): ElementRegistry | undefined {
  if (plugins === undefined) return undefined;
  try {
    return createElementRegistry(
      resolvePluginOrder(plugins).flatMap((p) => [...(p.elements ?? [])]),
    );
  } catch {
    return undefined;
  }
}

/**
 * Creates the initial document for a board without `options.document`. Plugin document versions
 * start at each plugin's latest version, so plugin migrations never run on a brand-new document.
 * Invalid plugin definitions are skipped here and rejected by plugin installation.
 */
function createDocumentFor(plugins: unknown): BoardDocument {
  const doc = createEmptyDocument();
  if (!Array.isArray(plugins)) return doc;
  const versions: Record<string, number> = {};
  for (const plugin of plugins as unknown[]) {
    if (!isPlainObject(plugin) || typeof plugin.id !== 'string') continue;
    if (!isPlainObject(plugin.migrations)) continue;
    const version = latestPluginVersion(plugin.migrations as PluginMigrations);
    if (version > 0) versions[plugin.id] = version;
  }
  return Object.keys(versions).length > 0 ? { ...doc, pluginVersions: versions } : doc;
}

/** `error` event message for a document newer than this board understands (BOARD-703). */
function tooNewMessage(reason: DocumentTooNewReason): string {
  const what =
    reason.kind === 'schema'
      ? 'schemaVersion dokumen'
      : reason.kind === 'element'
        ? `Versi tipe elemen "${reason.type}"`
        : `Versi dokumen plugin "${reason.id}"`;
  return (
    `${what} (${reason.version}) lebih baru dari yang didukung (${reason.supported}); ` +
    'papan dibuka dalam mode baca saja.'
  );
}

function resolveIdGenerator(generator: unknown): IdGenerator {
  if (generator === undefined) return () => createRandomId();
  if (typeof generator === 'function') return generator as IdGenerator;
  throw new TypeError('Opsi createId wajib berupa fungsi.');
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
  const frameScheduler = resolveFrameScheduler(options.frameScheduler);
  if (options.reducedMotion !== undefined && typeof options.reducedMotion !== 'boolean') {
    throw new TypeError('Opsi reducedMotion wajib berupa boolean.');
  }
  const reducedMotion = options.reducedMotion === true;
  let snapOptions = resolveSnapOptions(options.snap);
  let locale = resolveLocale(options.locale);
  let configuredReadOnly = resolveReadOnly(options.readOnly);
  /** Why the loaded document is too new for this board, or `null` (BOARD-703). */
  let tooNew: DocumentTooNewReason | null = null;
  const resolvers = resolveResolvers(options.resolvers);
  const assets = resolveAssets(options.assets);
  const user = resolveUser(options.user);
  const limits = resolveLimits(options.limits);
  const permissions = resolvePermissions(options.permissions);

  const freeze = options.freezeSnapshots !== false;
  const generateId = resolveIdGenerator(options.createId);
  const defaultTool = options.defaultTool ?? DEFAULT_TOOL_ID;
  const keymap = createKeymap(options.platform ?? detectPlatform(), options.keybindings);
  if (typeof defaultTool !== 'string') throw new TypeError('Opsi defaultTool wajib berupa string.');
  const historyLimit = resolveHistoryLimit(options.history);
  const mergeWindowMs = resolveMergeWindow(options.history);
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

  /** Reports records dropped from an incoming document, one `invalid-record` error each. */
  function reportRejected(rejected: readonly RejectedRecord[]): void {
    for (const item of rejected) {
      const message = `Record "${item.id}" dari dokumen masuk tidak valid dan diabaikan: ${item.errors.join(' ')}`;
      // Dropping data must never be silent: without an `error` listener, log it.
      if (events.has('error')) emitError('invalid-record', message, Object.freeze({ ...item }));
      else reportUnhandled(`[kujam] ${message}`, item.record);
    }
  }

  const elements = createElementRegistry();
  const brushes = createBrushRegistry();
  const initial = options.document
    ? toOwnedDocument(options.document, previewElementRegistry(options.plugins), limits, true)
    : { document: createDocumentFor(options.plugins), rejected: [] };
  const spatial = createSpatialIndex((el) => {
    const def = elements.get(el.type);
    return def?.geometry ? def.geometry(el as never) : undefined;
  });

  /** Element geometry for hit-testing; same fallbacks as the spatial index bounds. */
  function hitGeometry(el: ElementRecord): Geometry {
    const def = elements.get(el.type);
    return resolveElementGeometry(el, def?.geometry && (() => def.geometry!(el as never)));
  }

  const store = createRecordStore(initial.document, {
    freeze,
    isReadOnly: () => configuredReadOnly || tooNew !== null,
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
      // After `change`, so `page` and `selection` listeners see the document that caused it.
      pages.observe(event);
      selection.observe(event);
    },
  });

  // Initialize the spatial index from the initial document
  spatial.load(
    Object.values(store.getDocument().records).filter(
      (r): r is ElementRecord => r.kind === 'element',
    ),
  );
  const history = createLocalHistory(store, {
    limit: historyLimit,
    mergeWindowMs,
    onStateChange: (state) => events.emit('history', state),
  });
  const camera = createCamera({
    zoomRange,
    onChange: (event) => events.emit('camera', event),
    getContentBounds: () => unionBounds(board.query().map((el) => spatial.getBounds(el.id))),
    getSelectionBounds: () => selection.bounds,
    scheduler: frameScheduler,
    reducedMotion,
  });
  let activeTheme: Readonly<ThemeDefinition> = resolveTheme(options.theme);

  const elementContext: ElementContext = Object.freeze({
    get locale() {
      return locale;
    },
    get theme() {
      return activeTheme;
    },
    resolveBrush: (id: string): Readonly<BrushDefinition> => brushes.api.resolve(id),
    emit(name: string, payload?: unknown): void {
      if (typeof name !== 'string' || name === '') {
        throw new TypeError('Nama aksi wajib berupa string tidak kosong.');
      }
      events.emit('action', Object.freeze({ name, payload }));
    },
  });
  const toolStyles = createToolStyles((event) => events.emit('tool-style', event));

  /** Context for an element's `actions` (BOARD-605, BOARD-1108). */
  function actionContext(el: Readonly<ElementRecord>): ElementActionContext {
    return Object.freeze({
      get locale() {
        return locale;
      },
      get theme() {
        return activeTheme;
      },
      resolveBrush: elementContext.resolveBrush,
      emit: elementContext.emit,
      updateProps: (patch: Partial<Record<string, unknown>>): boolean =>
        board.update(el.id, { props: patch }) !== undefined,
      brushes: brushes.api.list(),
      toolStyles: toolStyles.api,
    });
  }

  /** Valid actions of one element by ID, or `null` when its type has no `actions`. */
  function actionsOf(el: Readonly<ElementRecord>): Map<string, ElementAction> | null {
    const def = elements.get(el.type);
    if (typeof def?.actions !== 'function') return null;
    const list: unknown = def.actions(el as never, undefined, actionContext(el) as never);
    const byId = new Map<string, ElementAction>();
    if (!Array.isArray(list)) return byId;
    for (const action of list as unknown[]) {
      if (!isPlainObject(action) || typeof action.id !== 'string') continue;
      if (typeof action.run !== 'function' || byId.has(action.id)) continue;
      byId.set(action.id, action as unknown as ElementAction);
    }
    return byId;
  }

  /** One action applied to several elements at once (BOARD-605, BOARD-1108). */
  function mergeAction(
    first: ElementAction,
    targets: readonly (readonly [Readonly<ElementRecord>, ElementAction])[],
  ): ElementAction {
    return Object.freeze({
      id: first.id,
      label: first.label,
      ...(first.icon !== undefined ? { icon: first.icon } : {}),
      ...(first.group !== undefined ? { group: first.group } : {}),
      isEnabled: () =>
        targets.every(([el, action]) => can('action', el) && action.isEnabled?.() !== false),
      ...(typeof first.isActive === 'function'
        ? { isActive: () => targets.every(([, action]) => action.isActive?.() === true) }
        : {}),
      run(): void {
        assertUsable();
        const denied = targets.find(([el]) => !can('action', el));
        if (denied) {
          const [element] = denied;
          emitError(
            'forbidden',
            `Menjalankan aksi "${first.id}" pada elemen "${element.id}" ditolak oleh hook izin.`,
            { action: 'action', actionId: first.id, element, user },
          );
          return;
        }
        store.transact(
          () => {
            for (const [, action] of targets) {
              if (action.isEnabled?.() !== false) action.run();
            }
          },
          { label: first.id },
        );
      },
    });
  }

  const selection = createSelection({
    isElement: (id) => {
      const rec = store.getRecord(id);
      return rec?.kind === 'element' && rec.pageId === pages.api.current;
    },
    getBounds: (id) => spatial.getBounds(id),
    onChange: (event) => events.emit('selection', event),
  });
  const pages = createPages({
    getDocument: () => store.getDocument(),
    transact: (fn, txOpts) => store.transact(fn, txOpts),
    createId: () => board.createId(),
    checkPermission: (action, element) => can(action, element),
    deleteElements: (ids, opts) => deleteElementRecords(mutationCtx, ids, opts),
    emitError: (code, message, cause) => emitError(code, message, cause),
    assertUsable: () => assertUsable(),
    onCurrentChange: (event) => {
      // Elements of another page are never selected.
      selection.clear();
      events.emit('page', event);
    },
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
    brushes: brushes.api,
    plugins: options.plugins,
  });

  /**
   * Runs the shortcut matching a key-down, if any (BOARD-504). Returns `false` when nothing ran: no
   * match, a repeat, an unregistered target, or a command whose `isEnabled` rejected it.
   */
  function runShortcut(event: ToolKeyEvent): boolean {
    const binding = keymap.api.match(event);
    if (!binding) return false;
    if (binding.target.startsWith('tool:')) {
      const id = binding.target.slice('tool:'.length);
      if (event.repeat || !tools.api.has(id)) return false;
      tools.setTool(id);
      return true;
    }
    const command = commands.api.get(binding.target);
    // A held key only repeats commands that ask for it (BOARD-1902), for example arrow-key nudges.
    if (!command || (event.repeat && command.repeatable !== true)) return false;
    return commands.run(binding.target, undefined);
  }

  function assertUsable(): void {
    if (disposed) throw new Error('Papan sudah di-dispose.');
  }

  /**
   * Runs element props and plugin document migrations (BOARD-702) on a validated document.
   * Returns `doc` itself when nothing changed, otherwise a validated, owned copy.
   */
  /**
   * Runs element and plugin migrations, then re-validates the result: props of migrated elements
   * are only checked now that they are at their registered type version.
   */
  function migrateDocumentContent(doc: BoardDocument): {
    document: BoardDocument;
    rejected: RejectedRecord[];
  } {
    const migrated = migrateContent(doc, elements, plugins.api.list());
    return migrated === doc
      ? { document: doc, rejected: [] }
      : toOwnedDocument(migrated, elements, limits);
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
    defaultPageId: () => pages.api.current,
    createId: () => board.createId(),
    emitError,
    assertUsable,
  };

  const board: Board = {
    get readOnly(): boolean {
      return configuredReadOnly || tooNew !== null;
    },
    setReadOnly(readOnly: boolean): void {
      assertUsable();
      if (typeof readOnly !== 'boolean') {
        throw new TypeError('readOnly wajib berupa boolean.');
      }
      configuredReadOnly = readOnly;
      if (readOnly) {
        tools.reset();
      }
    },
    get locale(): BoardLocale {
      return locale;
    },
    setLocale(nextLocale: BoardLocale): void {
      assertUsable();
      locale = resolveLocale(nextLocale);
    },
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
    getActions(ids) {
      assertUsable();
      const input = ids === undefined ? selection.ids : typeof ids === 'string' ? [ids] : ids;
      if (!Array.isArray(input) || input.some((id) => typeof id !== 'string')) {
        throw new TypeError(
          'Argumen ids pada board.getActions wajib berupa string atau array string.',
        );
      }
      const targets: Readonly<ElementRecord>[] = [];
      for (const id of new Set(input as readonly string[])) {
        const el = board.getElement(id);
        if (el) targets.push(el);
      }
      const lists: Map<string, ElementAction>[] = [];
      for (const el of targets) {
        const list = actionsOf(el);
        if (!list) return [];
        lists.push(list);
      }
      const [firstList] = lists;
      if (!firstList) return [];
      const merged: ElementAction[] = [];
      for (const [id, first] of firstList) {
        if (!lists.every((list) => list.has(id))) continue;
        merged.push(
          mergeAction(
            first,
            targets.map((el, i) => [el, lists[i]!.get(id)!] as const),
          ),
        );
      }
      return Object.freeze(merged);
    },
    toolStyles: toolStyles.api,
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
      const { document: owned, rejected } = toOwnedDocument(doc, elements, limits, true);
      const reason = findTooNew(owned, elements, plugins.api.list());
      // Every migration runs before the store is touched, so a failing step leaves state unchanged.
      // A document that is too new is never migrated: it would be rewritten in a lossy way.
      const migrated = reason ? null : migrateDocumentContent(owned);
      // The diff of an in-progress interaction does not apply to the new document.
      tools.reset();
      history.api.clear();
      tooNew = reason;
      store.replaceDocument(owned, 'load');
      if (migrated && migrated.document !== owned) {
        store.replaceDocument(migrated.document, 'migration');
      }
      reportRejected([...rejected, ...(migrated?.rejected ?? [])]);
      if (reason) emitError('document-too-new', tooNewMessage(reason), reason);
    },
    prepareDocument(doc: BoardDocument): PreparedDocument {
      assertUsable();
      const { document: owned, rejected } = toOwnedDocument(doc, elements, limits, true);
      const reason = findTooNew(owned, elements, plugins.api.list());
      const migrated = reason ? null : migrateDocumentContent(owned);
      return {
        document: migrated?.document ?? owned,
        rejected: [...rejected, ...(migrated?.rejected ?? [])].map(({ id, errors }) => ({
          id,
          errors,
        })),
        tooNew: reason,
      };
    },
    getElement(id: string) {
      const rec = store.getRecord(id);
      return rec?.kind === 'element' ? (rec as never) : undefined;
    },
    query(filter) {
      assertUsable();
      const { allPages, ...rest } = filter ?? {};
      const pageId = rest.pageId ?? (allPages ? undefined : pages.api.current);
      return queryElements(store.getDocument(), spatial, { ...rest, pageId }) as never;
    },
    hitTest(point, hitOptions = {}) {
      assertUsable();
      if (
        !isPlainObject(point) ||
        !Number.isFinite(point.x as number) ||
        !Number.isFinite(point.y as number)
      ) {
        throw new TypeError('Argumen point pada board.hitTest wajib berupa { x, y } berhingga.');
      }
      const tolerancePx = hitOptions.tolerance ?? 0;
      if (typeof tolerancePx !== 'number' || !Number.isFinite(tolerancePx)) {
        throw new TypeError('Opsi tolerance pada board.hitTest wajib berupa angka berhingga.');
      }
      return hitTestElements(
        store.getDocument(),
        spatial,
        hitGeometry,
        { x: point.x, y: point.y },
        toBoardTolerance(tolerancePx, camera.get().zoom),
        {
          ...hitOptions,
          pageId: hitOptions.pageId ?? (hitOptions.allPages ? undefined : pages.api.current),
        },
      );
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
    reportError(code: BoardErrorCode, message: string, cause?: unknown): void {
      assertUsable();
      emitError(code, message, cause);
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
    brushes: brushes.api,
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
    get toolData() {
      return tools.data;
    },
    elementContext,
    get theme() {
      return activeTheme;
    },
    setTheme(theme: ThemeMode | ThemeDefinition): void {
      assertUsable();
      const resolved = resolveTheme(theme);
      if (activeTheme === resolved) return;
      activeTheme = resolved;
      events.emit('theme', activeTheme);
    },
    keybindings: keymap.api,
    dispatch(event: BoardInputEvent): boolean {
      assertUsable();
      if (event?.type !== 'key-down' && event?.type !== 'key-up') return tools.dispatch(event);
      const escape = event.key === 'Escape';
      if (event.inTextInput === true && !escape) return false;
      // Esc and keys during an interaction belong to the tool first.
      if (escape || tools.busy) {
        const handled = tools.dispatch(event);
        if (handled || !escape) return handled;
      }
      if (runShortcut(event)) return true;
      return escape ? false : tools.dispatch(event);
    },
    camera,
    get snapOptions() {
      return snapOptions;
    },
    setSnapOptions(patch: Partial<SnapOptions>): void {
      snapOptions = resolveSnapOptions(patch, snapOptions);
    },
    getCamera(): Readonly<CameraState> {
      return camera.get();
    },
    setCamera(patch: Partial<CameraState>): void {
      camera.set(patch);
    },
    pages: pages.api,
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
        events.emit('dispose', undefined);
        plugins.dispose();
      } finally {
        disposed = true;
        camera.dispose();
        spatial.clear();
        events.clear();
        commands.clear();
        tools.clear();
        brushes.clear();
        toolStyles.clear();
        history.dispose();
        store.dispose();
      }
    },
  };

  // Read-only before plugin setup runs, so `setup` cannot rewrite a document that is too new.
  tooNew = findTooNew(store.getDocument(), elements, []);
  plugins.install();
  keymap.loadPlugins(plugins.api.list());
  const deferred: (() => void)[] = [];
  if (initial.rejected.length > 0) deferred.push(() => reportRejected(initial.rejected));
  if (options.document) {
    // Element types and plugins are only known after install.
    tooNew = findTooNew(store.getDocument(), elements, plugins.api.list());
    if (tooNew) {
      const reason = tooNew;
      deferred.push(() => emitError('document-too-new', tooNewMessage(reason), reason));
    } else {
      try {
        const current = store.getDocument();
        const migrated = migrateDocumentContent(current);
        if (migrated.document !== current) store.replaceDocument(migrated.document, 'migration');
        if (migrated.rejected.length > 0) {
          deferred.push(() => reportRejected(migrated.rejected));
        }
      } catch (error) {
        board.dispose();
        throw error;
      }
    }
  }
  if (deferred.length > 0) {
    // No listener can exist yet: report on the next microtask, so listeners attached right after
    // `createBoard` still receive the events.
    void Promise.resolve().then(() => {
      if (!disposed) for (const report of deferred) report();
    });
  }
  return board;
}
