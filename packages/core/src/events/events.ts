/**
 * Per-board event emitter (BOARD-207). There is no global state: every board creates its own
 * emitter, so two boards never share listeners.
 */

import type { HistoryEvent } from '../history/history.js';
import type { ElementDataEvent } from '../elements/element-data.js';
import type { ChangeEvent } from '../document/store.js';
import type { ThemeDefinition } from '../theme/theme.js';
import type { ToolStyleEvent } from '../tools/tool-styles.js';
import type { CameraState } from '../types.js';
import type { Point } from '../geometry/geometry.js';
import type { SyncChangeEvent } from '../sync/sync.js';
import type { ContextMenuEvent } from '../tools/context-menu.js';

/**
 * Typed event listener.
 *
 * @public
 */
export type Listener<T> = (event: T) => void;

/**
 * Function that stops listening to an event. Safe to call more than once.
 *
 * @public
 */
export type Unsubscribe = () => void;

/**
 * Payload of the `camera` event: emitted only when the camera actually changes.
 *
 * @public
 */
export interface CameraEvent {
  /** Camera after the change (same as `board.getCamera()`). */
  readonly camera: Readonly<CameraState>;
  /** Camera before the change. */
  readonly previous: Readonly<CameraState>;
}

/**
 * Payload of the `selection` event: emitted only when the selection actually changes (BOARD-405).
 *
 * @beta
 */
export interface SelectionEvent {
  /** Selected element IDs after the change, in selection order. */
  readonly ids: readonly string[];
  /** Selected element IDs before the change. */
  readonly previous: readonly string[];
}

/**
 * Payload of the `page` event: emitted when the current page changes (BOARD-208).
 *
 * @beta
 */
export interface PageEvent {
  /** ID of the now-current page. */
  readonly id: string;
  /** ID of the previous current page. */
  readonly previous: string;
}

/**
 * Payload of the `tool` event: emitted when the active tool changes (BOARD-501).
 *
 * @beta
 */
export interface ToolEvent {
  /** ID of the now-active tool, or `null` when no tool is active (the active tool was unregistered). */
  readonly id: string | null;
  /** ID of the previous tool, or `null` when there was no active tool. */
  readonly previous: string | null;
}

/**
 * Payload of the `action` event: emitted by plugins via `ctx.emit(name, payload)` (BOARD-605) so
 * the application can listen to it.
 *
 * @beta
 */
export interface ActionEvent {
  /** Namespaced action name, for example `'example.change-color'`. */
  readonly name: string;
  /** Free-form data from the plugin; not validated by core. */
  readonly payload: unknown;
}

/**
 * Stable error codes for the `error` event. Consumers should branch on the code,
 * not the message. New codes may be added in minor releases.
 *
 * - `listener-error`: another event listener threw (BOARD-207).
 * - `invalid-props`: element props failed the type schema (BOARD-205).
 * - `invalid-record`: an external record (document or peer) is invalid and was ignored
 *   (BOARD-210, BOARD-1502).
 * - `forbidden`: a permission hook rejected the operation (BOARD-212).
 * - `limit-exceeded`: a board size limit was reached (BOARD-005, BOARD-210).
 * - `document-too-new`: the document's `schemaVersion`, an element `typeVersion`, or a plugin
 *   version is newer than known; the board is now read-only, and `cause` is a
 *   `DocumentTooNewReason` (BOARD-703).
 * - `page-not-found`: `board.create` or `board.update` was given a `pageId` that is not an existing
 *   page; `cause` is `{ pageId }` (BOARD-208).
 * - `render-error`: an element's canvas or HTML render callback threw an unhandled error (BOARD-810).
 * - `resolve-error`: an element data resolver failed (BOARD-604).
 * - `action-error`: an element action failed (BOARD-1205).
 * - `undo-hook-error`: a callback registered via `tx.onUndo` or `tx.onRedo` threw an error or rejected (BOARD-303).
 * - `drop-error`: a drop handler threw an unhandled error (BOARD-608).
 * - `plugin-error`: a plugin hook (such as `onDocumentSaved`) threw an error or rejected (BOARD-1210).
 *
 * @beta
 */
export type BoardErrorCode =
  | 'listener-error'
  | 'invalid-props'
  | 'invalid-record'
  | 'forbidden'
  | 'limit-exceeded'
  | 'document-too-new'
  | 'page-not-found'
  | 'render-error'
  | 'resolve-error'
  | 'action-error'
  | 'undo-hook-error'
  | 'drop-error'
  | 'plugin-error';

/**
 * Payload of the `error` event.
 *
 * @public
 */
export interface BoardErrorEvent {
  /** Stable code (see {@link BoardErrorCode}). */
  readonly code: BoardErrorCode;
  /** Log message, in Indonesian; do not base logic on it. */
  readonly message: string;
  /** Original value that caused the error, for example what a listener threw. */
  readonly cause: unknown;
  /** For `listener-error`: name of the event whose listener threw. */
  readonly eventType?: keyof BoardEventMap;
}

/**
 * Payload of the `drag-preview` event: emitted during canvas dragover or cleared on dragleave/drop (BOARD-608).
 *
 * @beta
 */
export interface DragPreviewEvent {
  /** Target point on the board, or `null` when drag preview is cleared. */
  readonly point: Point | null;
  /** MIME or custom application data type being dragged, if known. */
  readonly type?: string;
}

/**
 * Payload of the `camera-follow` and `follow` events (BOARD-1506).
 *
 * @public
 */
export interface CameraFollowEvent {
  /** User ID being followed, or null when follow mode is deactivated. */
  readonly userId: string | null;
  /** Previous user ID that was followed, or null. */
  readonly previous: string | null;
}

/**
 * Map from event name to event payload for `board.on`.
 *
 * A throwing listener does not stop other listeners; its error is emitted as an
 * `error` event with code `listener-error`. When there is no `error` listener, or an `error` listener itself
 * throws, the error is reported to `console.error` (when available) and not re-emitted,
 * so there is no recursion.
 *
 * @public
 */
export interface BoardEventMap {
  /** One event per transaction that produces a net change, and per `loadDocument`. */
  change: ChangeEvent;
  /**
   * The selection changed via `select`, `addToSelection`, `removeFromSelection`, `clearSelection`,
   * or because selected elements were deleted (BOARD-405).
   *
   * @beta
   */
  selection: SelectionEvent;
  /** The camera changed via `setCamera`. */
  camera: CameraEvent;
  /**
   * Follow status changed via `camera.follow()` or automatic unfollow (BOARD-1506).
   *
   * @public
   */
  'camera-follow': CameraFollowEvent;
  /**
   * Alias for `camera-follow` (BOARD-1506).
   *
   * @public
   */
  follow: CameraFollowEvent;
  /**
   * The active tool changed via `setTool`, Esc, a `oneShot` tool, or Space (BOARD-501).
   *
   * @beta
   */
  tool: ToolEvent;
  /**
   * A tool's remembered style changed via `board.toolStyles.set` (BOARD-1108).
   *
   * @beta
   */
  'tool-style': ToolStyleEvent;
  /**
   * The current page changed via `board.pages.setCurrent`, or because the current page was
   * deleted (BOARD-208).
   *
   * @beta
   */
  page: PageEvent;
  /**
   * Plugin action, emitted through `ctx.emit(name, payload)` of the element context, for example
   * from `onDoubleClick` (`board.elementContext`, BOARD-502, BOARD-605).
   *
   * @beta
   */
  action: ActionEvent;
  /**
   * Data of these elements changed: a `resolve` finished or failed, or `invalidate` reset it
   * (BOARD-604). Read the new state with `board.getElementData`.
   *
   * @beta
   */
  data: ElementDataEvent;
  /** Errors not thrown to the caller (see {@link BoardErrorCode}). */
  error: BoardErrorEvent;
  /** `canUndo` or `canRedo` changed (BOARD-301). */
  history: HistoryEvent;
  /**
   * The board theme changed via `setTheme` (BOARD-1006).
   *
   * @beta
   */
  theme: Readonly<ThemeDefinition>;
  /**
   * The board is being disposed. Emitted once at the start of `board.dispose()`, before plugin
   * teardowns, while the document is still readable (used by `attachStorage` for the final save).
   *
   * @beta
   */
  dispose: undefined;
  /**
   * Visual drag-and-drop target preview on the board (BOARD-608). Emitted during dragover
   * or cleared during dragleave/drop.
   *
   * @beta
   */
  'drag-preview': DragPreviewEvent;
  /**
   * A sync adapter was attached with `attachSync` or detached; `board.sync` changed. UI that
   * shows the connection status listens to it to (re)bind to the adapter.
   *
   * @beta
   */
  sync: SyncChangeEvent;
  /**
   * Whiteboard context menu requested via right-click or long-press (BOARD-912).
   *
   * @beta
   */
  contextmenu: ContextMenuEvent;
}

/**
 * Called by the emitter for every listener that throws. `type` is the event being
 * emitted, `error` the value the listener threw.
 *
 * @internal
 */
export type ListenerErrorHandler<M> = (type: keyof M, error: unknown) => void;

/** @internal */
export interface Emitter<M> {
  on<K extends keyof M>(type: K, listener: Listener<M[K]>): Unsubscribe;
  emit<K extends keyof M>(type: K, event: M[K]): void;
  /** Whether any listener is registered for `type`. */
  has(type: keyof M): boolean;
  clear(): void;
}

/**
 * Creates a new emitter. Listeners are called in registration order. A throwing listener
 * does not stop other listeners and never makes `emit` throw: its error is
 * forwarded to `onListenerError` (the board forwards it to the `error` event).
 *
 * @internal
 */
export function createEmitter<M>(onListenerError: ListenerErrorHandler<M>): Emitter<M> {
  const listeners = new Map<keyof M, Set<Listener<never>>>();

  return {
    on(type, listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('Listener event wajib berupa fungsi.');
      }
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      // Wrap so the same function can be registered twice and removed one at a time.
      const entry: Listener<M[typeof type]> = (event) => listener(event);
      set.add(entry as Listener<never>);
      return () => {
        set.delete(entry as Listener<never>);
      };
    },
    emit(type, event) {
      const set = listeners.get(type);
      if (!set || set.size === 0) return;
      // Copy first: listeners may unsubscribe or subscribe during emit.
      for (const listener of [...set] as Listener<M[typeof type]>[]) {
        // A listener removed by an earlier listener is not called again.
        if (!set.has(listener as Listener<never>)) continue;
        try {
          listener(event);
        } catch (error) {
          onListenerError(type, error);
        }
      }
    },
    has(type) {
      const set = listeners.get(type);
      return set !== undefined && set.size > 0;
    },
    clear() {
      listeners.clear();
    },
  };
}

/**
 * Reports errors that have nowhere else to go to `console.error` when available (Node, Worker,
 * browser). Core does not depend on the `console` type (ES2022 lib without DOM), so it is accessed
 * defensively via `globalThis`. Never throws.
 *
 * @internal
 */
export function reportUnhandled(message: string, error: unknown): void {
  try {
    const sink = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console;
    sink?.error?.(message, error);
  } catch {
    // There is nowhere else to report; ignored to avoid triggering recursion.
  }
}
