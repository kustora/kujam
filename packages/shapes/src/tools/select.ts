import {
  containedInBox,
  defineTool,
  intersectsBox,
  moveElements,
  resizeElements,
  resolveElementGeometry,
  rotateElements,
  ROTATION_SNAP_DEGREES,
  selectionFrame,
  snapTranslation,
  transformHandles,
  type BindingRecord,
  type Board,
  type BoxBounds,
  type ElementRecord,
  type Point,
  type ResizeHandle,
  type SnapGuide,
  type ToolContext,
  type ToolKeyEvent,
  type ToolPointerEvent,
  type TransformResult,
} from '@kujam/core';
import {
  findSnapAnchor,
  normalizeConnectorBounds,
  type ConnectorSnapTarget,
} from '../elements/connector-routing.js';
import type { ConnectorProps } from '../elements/connector.js';
import { handlePinch, handleWheel } from './navigation.js';

/** Screen distance a press must travel before it becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Screen distance within which a resize or rotate handle is grabbed. */
export const HANDLE_TOLERANCE_PX = 8;
/** Screen distance of the rotate handle above the top edge of the selection frame. */
export const ROTATE_HANDLE_OFFSET_PX = 24;
/** Hit-test tolerance for clicking elements, in screen pixels. */
export const HIT_TOLERANCE_PX = 4;

/** Handle identifier for select tool interactions. */
export type SelectHandle = ResizeHandle | 'rotate' | 'connector-start' | 'connector-end';

/**
 * `ctx.data` of the select tool. The renderer reads it from `board.toolData` to draw feedback:
 * `brush` (selection box) and `guides` (snap guides). The other fields are internal.
 *
 * @beta
 */
export interface SelectToolData {
  /** Selection box in board coordinates while dragging on empty space, otherwise `null`. */
  brush: BoxBounds | null;
  /** Snap guides while moving elements. */
  guides: readonly SnapGuide[];
  /** Handle being dragged while resizing, rotating, or reconnecting a connector endpoint. */
  handle: SelectHandle | null;
  /** Active snap target while dragging a connector endpoint. */
  connectorSnap?: ConnectorSnapTarget;
  /** Generated binding ID reused during a connector endpoint drag session. */
  reconnectBindingId?: string;
  /** Board and screen position of the press that started the interaction. */
  start: Point;
  startScreen: Point;
  /** Snapshot of the transformed elements when the drag started. */
  originals: readonly Readonly<ElementRecord>[];
  /** Selection when the interaction started, restored when it is cancelled. */
  initialSelection: readonly string[];
  /** Element under the press, if any. */
  hitId: string | null;
  /** Whether the pressed element was already selected (a click then narrows the selection). */
  wasSelected: boolean;
}

type State =
  | 'idle'
  | 'pointing'
  | 'translating'
  | 'brushing'
  | 'resizing'
  | 'rotating'
  | 'reconnecting';
type Ctx = ToolContext<State, SelectToolData>;

function initialData(): SelectToolData {
  return {
    brush: null,
    guides: [],
    handle: null,
    start: { x: 0, y: 0 },
    startScreen: { x: 0, y: 0 },
    originals: [],
    initialSelection: [],
    hitId: null,
    wasSelected: false,
  };
}

/** Selected elements that may be transformed: not locked and allowed by the permission hooks. */
function transformable(board: Board): Readonly<ElementRecord>[] {
  return board.selection
    .map((id) => board.getElement(id))
    .filter((el): el is Readonly<ElementRecord> => !!el && !el.locked && board.can('update', el));
}

/** The resize, rotate, or connector endpoint handle under `screen`, closest first. */
function handleAt(board: Board, screen: Point): SelectHandle | null {
  const items = transformable(board);
  if (items.length === 1 && items[0]!.type === 'connector') {
    const conn = items[0]! as ElementRecord<ConnectorProps>;
    const startWorld: Point = {
      x: conn.x + conn.props.start.x,
      y: conn.y + conn.props.start.y,
    };
    const endWorld: Point = {
      x: conn.x + conn.props.end.x,
      y: conn.y + conn.props.end.y,
    };
    const sStart = board.camera.boardToScreen(startWorld);
    const sEnd = board.camera.boardToScreen(endWorld);
    const dStart = Math.hypot(sStart.x - screen.x, sStart.y - screen.y);
    const dEnd = Math.hypot(sEnd.x - screen.x, sEnd.y - screen.y);
    if (dStart <= HANDLE_TOLERANCE_PX || dEnd <= HANDLE_TOLERANCE_PX) {
      return dStart <= dEnd ? 'connector-start' : 'connector-end';
    }
    return null;
  }

  const frame = selectionFrame(items, { registry: board.elements });
  if (!frame) return null;
  const zoom = board.camera.get().zoom;
  let best: ResizeHandle | 'rotate' | null = null;
  let bestDistance = HANDLE_TOLERANCE_PX;
  for (const point of transformHandles(frame, ROTATE_HANDLE_OFFSET_PX / zoom)) {
    const s = board.camera.boardToScreen(point);
    const d = Math.hypot(s.x - screen.x, s.y - screen.y);
    if (d <= bestDistance) {
      bestDistance = d;
      best = point.handle;
    }
  }
  return best;
}

function dragConnectorEndpoint(ctx: Ctx, e: ToolPointerEvent): void {
  const { board, data } = ctx;
  const orig = data.originals[0] as ElementRecord<ConnectorProps> | undefined;
  if (!orig || orig.type !== 'connector') return;
  const isStart = data.handle === 'connector-start';

  const snap = findSnapAnchor(board, e.point, new Set([orig.id]));
  if (snap) {
    data.connectorSnap = snap;
  } else {
    delete data.connectorSnap;
  }

  const targetPoint = snap ? snap.worldPoint : e.point;
  const origStartWorld: Point = {
    x: orig.x + orig.props.start.x,
    y: orig.y + orig.props.start.y,
  };
  const origEndWorld: Point = {
    x: orig.x + orig.props.end.x,
    y: orig.y + orig.props.end.y,
  };
  const startWorld = isStart ? targetPoint : origStartWorld;
  const endWorld = isStart ? origEndWorld : targetPoint;
  const oldBindingId = isStart ? orig.props.startBindingId : orig.props.endBindingId;

  if (snap && !data.reconnectBindingId) {
    data.reconnectBindingId = oldBindingId ?? board.createId();
  }

  ctx.change(
    (tx) => {
      let nextBindingId: string | null = null;
      if (snap) {
        nextBindingId = data.reconnectBindingId ?? oldBindingId ?? board.createId();
        if (oldBindingId && oldBindingId !== nextBindingId) {
          tx.remove(oldBindingId);
        }
        const b: BindingRecord = {
          id: nextBindingId,
          kind: 'binding',
          fromId: orig.id,
          toId: snap.elementId,
          anchor: snap.anchor,
        };
        tx.put(b);
      } else {
        if (oldBindingId) {
          tx.remove(oldBindingId);
        }
        if (data.reconnectBindingId && data.reconnectBindingId !== oldBindingId) {
          tx.remove(data.reconnectBindingId);
        }
        nextBindingId = null;
      }

      const bounds = normalizeConnectorBounds(startWorld, endWorld);
      tx.put({
        ...orig,
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h,
        props: {
          ...orig.props,
          start: bounds.start,
          end: bounds.end,
          ...(isStart ? { startBindingId: nextBindingId } : { endBindingId: nextBindingId }),
        },
      });
    },
    { label: 'reconnect' },
  );
}

function apply(ctx: Ctx, results: readonly TransformResult[], label: string): void {
  const byId = new Map(ctx.data.originals.map((el) => [el.id, el]));
  ctx.change(
    (tx) => {
      for (const r of results) {
        const original = byId.get(r.id);
        if (!original) continue;
        tx.put({ ...original, x: r.x, y: r.y, w: r.w, h: r.h, rotation: r.rotation });
      }
    },
    { label },
  );
}

/** Moves the snapshot by the pointer travel since the press, with snapping. */
function translate(ctx: Ctx, e: ToolPointerEvent): void {
  const { board, data } = ctx;
  const delta = { x: e.point.x - data.start.x, y: e.point.y - data.start.y };
  const snapped = snapTranslation(board, data.originals, delta, { modifiers: e.modifiers });
  data.guides = snapped.guides;
  apply(ctx, moveElements(data.originals, snapped.delta.x, snapped.delta.y), 'move');
}

function restoreSelection(ctx: Ctx): void {
  ctx.board.select(ctx.data.initialSelection);
}

function boxFrom(a: Point, b: Point): BoxBounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** Elements inside the box (or touching it with `partial`), excluding locked ones. */
function elementsInBox(board: Board, box: BoxBounds, partial: boolean): string[] {
  return board
    .query({ inBounds: box })
    .filter((el) => {
      if (el.locked) return false;
      const def = board.elements.get(el.type);
      const geometry = resolveElementGeometry(el, def?.geometry && (() => def.geometry!(el)));
      return partial ? intersectsBox(geometry, box, el) : containedInBox(geometry, box, el);
    })
    .map((el) => el.id);
}

function pressed(e: ToolPointerEvent): boolean {
  return e.button === 0;
}

function plainKey(e: ToolKeyEvent, key: string): boolean {
  const m = e.modifiers;
  return e.key === key && !e.repeat && !m.shift && !m.alt && !m.ctrl && !m.meta;
}

/**
 * Enter on a single selected element does what a double click does, for example opening the text
 * editor of a sticky (BOARD-1902). Returns `false` (key not handled) when there is nothing to edit.
 */
function editSelected(ctx: Ctx, e: ToolKeyEvent): false | void {
  if (!plainKey(e, 'Enter')) return false;
  const { board } = ctx;
  if (board.readOnly || board.selection.length !== 1) return false;
  const el = board.getElement(board.selection[0]!);
  const onDoubleClick = el && !el.locked ? board.elements.get(el.type)?.onDoubleClick : undefined;
  if (!el || !onDoubleClick) return false;
  onDoubleClick(el as never, board.elementContext);
}

/**
 * Select tool (BOARD-502).
 *
 * - Click selects the element under the pointer; Shift+click toggles it; clicking empty space
 *   clears the selection.
 * - Dragging on empty space draws a selection box: elements fully inside are selected, or touched
 *   ones with Alt. Shift adds to the existing selection.
 * - Dragging a selected element moves the selection, snapping to other elements and the grid
 *   (Ctrl/Cmd turns snapping off).
 * - Dragging a handle resizes (Shift keeps the ratio) or rotates (Shift snaps to 15 degrees).
 * - Double click forwards to the element type's `onDoubleClick`; so does Enter on a single
 *   selected, unlocked element (BOARD-1902). Other keys are left unhandled.
 * - Esc (or pointer cancel) rolls back the interaction and restores the previous selection.
 * - Wheel scrolls, Ctrl/Cmd+wheel and pinch zoom.
 *
 * Locked elements are never hit, boxed, or transformed. Feedback for the overlay is in
 * {@link SelectToolData}, read through `board.toolData`.
 *
 * @beta
 */
export const selectTool = defineTool({
  id: 'select',
  initial: 'idle',
  data: initialData,
  states: {
    idle: {
      onPointerDown(ctx, e) {
        if (!pressed(e)) return;
        const { board } = ctx;
        const data = ctx.data;
        data.start = e.point;
        data.startScreen = e.screen;
        data.initialSelection = board.selection;

        const handle = handleAt(board, e.screen);
        if (handle) {
          data.handle = handle;
          data.originals = transformable(board);
          delete data.reconnectBindingId;
          delete data.connectorSnap;
          if (handle === 'connector-start' || handle === 'connector-end') {
            return 'reconnecting';
          }
          return handle === 'rotate' ? 'rotating' : 'resizing';
        }

        const hit = board.hitTest(e.point, { tolerance: HIT_TOLERANCE_PX });
        if (!hit) {
          if (!e.modifiers.shift) board.clearSelection();
          data.initialSelection = board.selection;
          return 'brushing';
        }

        if ((e.clickCount ?? 1) >= 2) {
          board.select(hit.id);
          board.elements.get(hit.type)?.onDoubleClick?.(hit as never, board.elementContext);
          return;
        }

        data.hitId = hit.id;
        data.wasSelected = board.selection.includes(hit.id);
        if (e.modifiers.shift) {
          if (data.wasSelected) {
            board.removeFromSelection(hit.id);
            return;
          }
          board.addToSelection(hit.id);
        } else if (!data.wasSelected) {
          board.select(hit.id);
        }
        return 'pointing';
      },
      onKeyDown: editSelected,
      onWheel: (ctx, e) => handleWheel(ctx.board, e),
      onPinch: (ctx, e) => handlePinch(ctx.board, e),
    },

    pointing: {
      onPointerMove(ctx, e) {
        const s = ctx.data.startScreen;
        if (Math.hypot(e.screen.x - s.x, e.screen.y - s.y) < DRAG_THRESHOLD_PX) return;
        ctx.data.originals = transformable(ctx.board);
        translate(ctx, e);
        return 'translating';
      },
      onPointerUp(ctx, e) {
        // Clicking an element of a multi-selection without dragging selects just that element.
        if (ctx.data.wasSelected && !e.modifiers.shift && ctx.data.hitId) {
          ctx.board.select(ctx.data.hitId);
        }
        return 'idle';
      },
      onCancel: restoreSelection,
    },

    translating: {
      cursor: 'move',
      onPointerMove: translate,
      onPointerUp: () => 'idle',
      onCancel: restoreSelection,
    },

    brushing: {
      cursor: 'crosshair',
      onPointerMove(ctx, e) {
        const { board, data } = ctx;
        const box = boxFrom(data.start, e.point);
        data.brush = box;
        const inside = elementsInBox(board, box, e.modifiers.alt);
        board.select(e.modifiers.shift ? [...data.initialSelection, ...inside] : inside);
      },
      onPointerUp: () => 'idle',
      onCancel: restoreSelection,
    },

    resizing: {
      cursor: 'nwse-resize',
      onPointerMove(ctx, e) {
        const { board, data } = ctx;
        if (
          !data.handle ||
          data.handle === 'rotate' ||
          data.handle === 'connector-start' ||
          data.handle === 'connector-end'
        ) {
          return;
        }
        const results = resizeElements(data.originals, data.handle, data.start, e.point, {
          keepRatio: e.modifiers.shift,
          registry: board.elements,
        });
        apply(ctx, results, 'resize');
      },
      onPointerUp: () => 'idle',
      onCancel: restoreSelection,
    },

    rotating: {
      cursor: 'grabbing',
      onPointerMove(ctx, e) {
        const { board, data } = ctx;
        const results = rotateElements(data.originals, data.start, e.point, {
          snap: e.modifiers.shift ? ROTATION_SNAP_DEGREES : 0,
          registry: board.elements,
        });
        apply(ctx, results, 'rotate');
      },
      onPointerUp: () => 'idle',
      onCancel: restoreSelection,
    },

    reconnecting: {
      cursor: 'crosshair',
      onPointerMove: dragConnectorEndpoint,
      onPointerUp(ctx) {
        delete ctx.data.connectorSnap;
        delete ctx.data.reconnectBindingId;
        return 'idle';
      },
      onCancel(ctx) {
        delete ctx.data.connectorSnap;
        delete ctx.data.reconnectBindingId;
        restoreSelection(ctx);
      },
    },
  },
});
