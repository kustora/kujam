/**
 * Attachment points (anchors) for application overlays such as comment pins (BOARD-1211).
 *
 * The package does not implement any comment system: it only resolves where an anchor is on the
 * board and on screen, tells the application when an element anchor moves or loses its element,
 * and offers a "place an anchor" mode that turns one click on the board into an anchor.
 *
 * @packageDocumentation
 */

import { boardToLocal, localToBoard, type Point } from '../geometry/geometry.js';
import type { ChangeEvent } from '../document/store.js';
import type { Board } from '../index.js';
import { defineTool, type ToolPointerEvent } from '../tools/tools.js';
import type { ElementRecord } from '../types.js';

/**
 * Anchor at a fixed board position.
 *
 * @public
 */
export interface PointAnchor {
  readonly kind: 'point';
  /** X in board coordinates. */
  readonly x: number;
  /** Y in board coordinates. */
  readonly y: number;
  /** Page the point belongs to. When omitted, the point is shown on every page. */
  readonly pageId?: string;
}

/**
 * Anchor attached to an element: follows the element when it moves, resizes, or rotates.
 *
 * @public
 */
export interface ElementAnchor {
  readonly kind: 'element';
  /** ID of the element the anchor is attached to. */
  readonly elementId: string;
  /**
   * Offset from the element's top-left corner in element-local board units (before rotation),
   * so the anchor rotates with the element. `{ x: 0, y: 0 }` is the top-left corner.
   */
  readonly offset: Point;
}

/**
 * Attachment point for application overlays (BOARD-1211): a board point, or an element plus an
 * offset. Anchors are plain JSON, so applications can store them with their own data.
 *
 * @public
 */
export type Anchor = PointAnchor | ElementAnchor;

/**
 * Board position of an anchor, from {@link BoardAnchors.resolve}.
 *
 * @public
 */
export interface ResolvedAnchor {
  /** X in board coordinates. */
  readonly x: number;
  /** Y in board coordinates. */
  readonly y: number;
  /** Page of the anchor, or `null` for a point anchor without `pageId`. */
  readonly pageId: string | null;
}

/**
 * Payload of the `anchor` event (BOARD-1211), emitted for anchors registered with
 * {@link BoardAnchors.track}.
 *
 * - `move`: the element of an element anchor moved, resized, rotated, or changed page.
 * - `remove`: the element was deleted (by any origin: local, remote, undo, `loadDocument`).
 *   `position` is `null`.
 * - `restore`: a deleted element came back (for example after undo or a remote change).
 *
 * @public
 */
export interface AnchorEvent {
  /** ID the application passed to {@link BoardAnchors.track}. */
  readonly id: string;
  readonly anchor: Anchor;
  readonly reason: 'move' | 'remove' | 'restore';
  /** New position, or `null` when the element no longer exists. */
  readonly position: ResolvedAnchor | null;
  /** Position before the change, or `null` when the element did not exist. */
  readonly previous: ResolvedAnchor | null;
}

/**
 * Options for {@link BoardAnchors.fromPoint} and {@link BoardAnchors.place}.
 *
 * @public
 */
export interface AnchorFromPointOptions {
  /**
   * What the anchor attaches to:
   * - `'auto'` (default): the topmost element under the point, otherwise the point itself.
   * - `'point'`: always a point anchor.
   * - `'element'`: only an element anchor; `fromPoint` returns `null` (and `place` keeps waiting)
   *   when no element is under the point.
   */
  readonly target?: 'auto' | 'point' | 'element';
  /**
   * Returns `false` to reject the topmost element under the point as a target, for example element
   * types the application does not annotate. A rejected element counts as no element.
   */
  readonly filter?: (element: Readonly<ElementRecord>) => boolean;
  /** Also attach to locked elements. Defaults to `true`. */
  readonly includeLocked?: boolean;
}

/**
 * Options for {@link BoardAnchors.place}.
 *
 * @public
 */
export interface AnchorPlaceOptions extends AnchorFromPointOptions {
  /** CSS cursor while placing. Defaults to `'crosshair'`. */
  readonly cursor?: string;
  /**
   * Largest pointer movement in screen pixels between press and release that still counts as a
   * click. Defaults to 6.
   */
  readonly clickTolerance?: number;
}

/**
 * Comment anchors API of a board (BOARD-1211), available as `board.anchors`.
 *
 * @public
 */
export interface BoardAnchors {
  /**
   * Board position of an anchor, or `null` when its element does not exist.
   *
   * @throws `TypeError` when `anchor` is not a valid {@link Anchor}.
   */
  resolve(anchor: Anchor): ResolvedAnchor | null;
  /**
   * Screen position of an anchor in CSS pixels relative to the board view, using the current
   * camera, or `null` when its element does not exist.
   */
  toScreen(anchor: Anchor): Point | null;
  /**
   * Creates an anchor for a board point: attached to the topmost element under it (current page)
   * or a point anchor, depending on `options.target`. Returns `null` only for `target: 'element'`
   * with no element under the point.
   */
  fromPoint(point: Point, options?: AnchorFromPointOptions): Anchor | null;
  /**
   * Element anchor for a board point on an element, keeping the point's place on the element.
   *
   * @throws `Error` when the element does not exist.
   */
  forElement(elementId: string, point?: Point): ElementAnchor;
  /**
   * Starts tracking an anchor under an application ID: `anchor` events are emitted when its
   * position changes or its element is deleted. Tracking the same ID again replaces the anchor.
   *
   * @returns Function that stops tracking.
   */
  track(id: string, anchor: Anchor): () => void;
  /** Stops tracking an anchor. */
  untrack(id: string): void;
  /** Tracked anchor with this ID. */
  get(id: string): Anchor | undefined;
  /** All tracked anchors, in tracking order. */
  list(): readonly { readonly id: string; readonly anchor: Anchor }[];
  /**
   * "Place an anchor" mode for an application comment tool: activates a temporary tool; the next
   * click on the board resolves with the anchor at that point (see {@link BoardAnchors.fromPoint}),
   * then the previous tool is restored. Resolves with `null` when cancelled: Esc, another tool
   * being selected, {@link BoardAnchors.cancelPlace}, a new `place` call, or `dispose`.
   *
   * Changes nothing in the document, so it also works on read-only boards.
   */
  place(options?: AnchorPlaceOptions): Promise<Anchor | null>;
  /** Cancels the running {@link BoardAnchors.place}, if any. */
  cancelPlace(): void;
  /** Whether {@link BoardAnchors.place} is waiting for a click. */
  readonly placing: boolean;
}

/**
 * ID of the temporary tool used by {@link BoardAnchors.place}.
 *
 * @public
 */
export const ANCHOR_PLACE_TOOL_ID = 'anchor-place';

const DEFAULT_CLICK_TOLERANCE = 6;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object' &&
    value !== null &&
    isFiniteNumber((value as Point).x) &&
    isFiniteNumber((value as Point).y)
  );
}

/**
 * Whether `value` is a valid {@link Anchor}, for example one read back from application storage.
 *
 * @public
 */
export function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== 'object' || value === null) return false;
  const anchor = value as {
    kind?: unknown;
    x?: unknown;
    y?: unknown;
    pageId?: unknown;
    elementId?: unknown;
    offset?: unknown;
  };
  if (anchor.kind === 'point') {
    return (
      isFiniteNumber(anchor.x) &&
      isFiniteNumber(anchor.y) &&
      (anchor.pageId === undefined || typeof anchor.pageId === 'string')
    );
  }
  if (anchor.kind === 'element') {
    return (
      typeof anchor.elementId === 'string' && anchor.elementId !== '' && isPoint(anchor.offset)
    );
  }
  return false;
}

function assertAnchor(anchor: unknown, where: string): asserts anchor is Anchor {
  if (!isAnchor(anchor)) {
    throw new TypeError(`Argumen anchor pada ${where} tidak valid.`);
  }
}

/** Frozen copy so stored anchors cannot be changed from outside. */
function freezeAnchor(anchor: Anchor): Anchor {
  if (anchor.kind === 'point') {
    return Object.freeze({
      kind: 'point',
      x: anchor.x,
      y: anchor.y,
      ...(anchor.pageId !== undefined ? { pageId: anchor.pageId } : {}),
    });
  }
  return Object.freeze({
    kind: 'element',
    elementId: anchor.elementId,
    offset: Object.freeze({ x: anchor.offset.x, y: anchor.offset.y }),
  });
}

function samePosition(a: ResolvedAnchor | null, b: ResolvedAnchor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.pageId === b.pageId;
}

function resolveOnElement(element: Readonly<ElementRecord>, offset: Point): ResolvedAnchor {
  const p = localToBoard(element, offset);
  return Object.freeze({ x: p.x, y: p.y, pageId: element.pageId });
}

interface PlaceSession {
  readonly options: AnchorPlaceOptions;
  readonly previousTool: string | null;
  readonly resolve: (anchor: Anchor | null) => void;
  result: Anchor | null;
  done: boolean;
}

interface PlaceData {
  start: Point | null;
}

/**
 * Creates the anchors runtime of a board (BOARD-1211).
 *
 * @internal
 */
export function createAnchorsRuntime(getBoard: () => Board): BoardAnchors {
  const tracked = new Map<string, { anchor: Anchor; position: ResolvedAnchor | null }>();
  let unlisten: (() => void)[] = [];
  let session: PlaceSession | null = null;
  let unregisterTool: (() => void) | null = null;

  function resolve(anchor: Anchor): ResolvedAnchor | null {
    assertAnchor(anchor, 'board.anchors.resolve');
    if (anchor.kind === 'point') {
      return Object.freeze({ x: anchor.x, y: anchor.y, pageId: anchor.pageId ?? null });
    }
    const element = getBoard().getElement(anchor.elementId);
    return element ? resolveOnElement(element, anchor.offset) : null;
  }

  function onChange(event: ChangeEvent): void {
    if (tracked.size === 0) return;
    const board = getBoard();
    const touched = (id: string): boolean =>
      Object.hasOwn(event.added, id) ||
      Object.hasOwn(event.updated, id) ||
      Object.hasOwn(event.removed, id);
    for (const [id, entry] of [...tracked]) {
      const { anchor } = entry;
      if (anchor.kind !== 'element' || !touched(anchor.elementId)) continue;
      const element = board.getElement(anchor.elementId);
      const position = element ? resolveOnElement(element, anchor.offset) : null;
      const previous = entry.position;
      if (samePosition(previous, position)) continue;
      entry.position = position;
      const reason = position === null ? 'remove' : previous === null ? 'restore' : 'move';
      board.emit('anchor', Object.freeze({ id, anchor, reason, position, previous }));
    }
  }

  function ensureListening(): void {
    if (unlisten.length > 0) return;
    const board = getBoard();
    unlisten = [
      board.on('change', onChange),
      board.on('dispose', () => {
        finishPlace(null, false);
        stopListening();
        tracked.clear();
      }),
    ];
  }

  function stopListening(): void {
    for (const off of unlisten) off();
    unlisten = [];
  }

  function fromPoint(point: Point, options: AnchorFromPointOptions = {}): Anchor | null {
    if (!isPoint(point)) {
      throw new TypeError(
        'Argumen point pada board.anchors.fromPoint wajib berupa { x, y } berhingga.',
      );
    }
    const board = getBoard();
    const target = options.target ?? 'auto';
    if (target !== 'point') {
      const element = hitElement(board, point, options);
      if (element)
        return freezeAnchor({
          kind: 'element',
          elementId: element.id,
          offset: boardToLocal(element, point),
        });
      if (target === 'element') return null;
    }
    return freezeAnchor({ kind: 'point', x: point.x, y: point.y, pageId: board.pages.current });
  }

  /** Topmost element under the point, or `undefined` when there is none or `filter` rejects it. */
  function hitElement(
    board: Board,
    point: Point,
    options: AnchorFromPointOptions,
  ): Readonly<ElementRecord> | undefined {
    const element = board.hitTest(point, { includeLocked: options.includeLocked !== false });
    if (!element || (options.filter && !options.filter(element))) return undefined;
    return element;
  }

  function finishPlace(result: Anchor | null, restoreTool: boolean): void {
    const current = session;
    if (!current || current.done) return;
    current.done = true;
    session = null;
    const board = getBoard();
    if (!board.disposed) {
      if (restoreTool && board.tool === ANCHOR_PLACE_TOOL_ID) {
        const back = current.previousTool;
        if (back !== null && back !== ANCHOR_PLACE_TOOL_ID && board.tools.has(back)) {
          board.setTool(back);
        }
      }
      // Unregistering the still-active tool switches to the default tool (or none).
      unregisterTool?.();
    }
    unregisterTool = null;
    current.resolve(result);
  }

  function registerPlaceTool(board: Board): void {
    if (board.tools.has(ANCHOR_PLACE_TOOL_ID)) return;
    unregisterTool = board.tools.register(
      defineTool<'idle' | 'pressing', PlaceData>({
        id: ANCHOR_PLACE_TOOL_ID,
        cursor: 'crosshair',
        initial: 'idle',
        data: () => ({ start: null }),
        states: {
          idle: {
            onEnter: (ctx) => {
              if (session?.options.cursor) ctx.setCursor(session.options.cursor);
            },
            onPointerDown: (ctx, event) => {
              if (event.button !== 0 && event.pointerType === 'mouse') return;
              ctx.data.start = event.screen;
              return 'pressing';
            },
            onKeyDown: (_ctx, event) => {
              if (event.key !== 'Escape') return false;
              finishPlace(null, true);
            },
          },
          pressing: {
            onPointerUp: (ctx, event: ToolPointerEvent) => {
              const start = ctx.data.start;
              const tolerance = session?.options.clickTolerance ?? DEFAULT_CLICK_TOLERANCE;
              if (
                session &&
                start &&
                Math.hypot(event.screen.x - start.x, event.screen.y - start.y) <= tolerance
              ) {
                const anchor = fromPoint(event.point, session.options);
                if (anchor) session.result = anchor;
              }
              return 'idle';
            },
            onExit: () => {
              const current = session;
              // Leave the tool after the dispatch that completed the click has returned.
              if (current?.result) {
                const result = current.result;
                void Promise.resolve().then(() => {
                  if (session === current) finishPlace(result, true);
                });
              }
            },
          },
        },
      }),
    );
  }

  const api: BoardAnchors = {
    resolve,

    toScreen(anchor) {
      const position = resolve(anchor);
      if (!position) return null;
      return getBoard().camera.boardToScreen({ x: position.x, y: position.y });
    },

    fromPoint,

    forElement(elementId, point) {
      const element = getBoard().getElement(elementId);
      if (!element) {
        throw new Error(`Elemen "${elementId}" tidak ditemukan.`);
      }
      const offset =
        point === undefined
          ? { x: 0, y: 0 }
          : isPoint(point)
            ? boardToLocal(element, point)
            : (() => {
                throw new TypeError('Argumen point pada board.anchors.forElement tidak valid.');
              })();
      return freezeAnchor({ kind: 'element', elementId, offset }) as ElementAnchor;
    },

    track(id, anchor) {
      if (typeof id !== 'string' || id === '') {
        throw new TypeError('ID anchor wajib berupa string tidak kosong.');
      }
      assertAnchor(anchor, 'board.anchors.track');
      const frozen = freezeAnchor(anchor);
      tracked.delete(id);
      tracked.set(id, { anchor: frozen, position: resolve(frozen) });
      ensureListening();
      return () => {
        if (tracked.get(id)?.anchor === frozen) api.untrack(id);
      };
    },

    untrack(id) {
      tracked.delete(id);
      if (tracked.size === 0 && session === null) stopListening();
    },

    get(id) {
      return tracked.get(id)?.anchor;
    },

    list() {
      return [...tracked].map(([id, entry]) => Object.freeze({ id, anchor: entry.anchor }));
    },

    place(options = {}) {
      const board = getBoard();
      if (board.disposed) return Promise.reject(new Error('Papan sudah di-dispose.'));
      // A new placement replaces a running one but keeps the tool to return to.
      const previousTool = session ? session.previousTool : board.tool;
      finishPlace(null, false);
      ensureListening();
      return new Promise<Anchor | null>((resolvePromise) => {
        session = { options, previousTool, resolve: resolvePromise, result: null, done: false };
        const current = session;
        registerPlaceTool(board);
        board.setTool(ANCHOR_PLACE_TOOL_ID);
        // Any switch away from the placing tool (Esc, toolbar, shortcut) cancels the placement.
        const offTool = board.on('tool', (event) => {
          if (event.previous === ANCHOR_PLACE_TOOL_ID && event.id !== ANCHOR_PLACE_TOOL_ID) {
            offTool();
            if (session === current) finishPlace(current.result, false);
          }
        });
      });
    },

    cancelPlace() {
      finishPlace(null, true);
    },

    get placing() {
      return session !== null;
    },
  };

  return api;
}
