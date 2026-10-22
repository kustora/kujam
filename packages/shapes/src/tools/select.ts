import {
  containedInBox,
  defineTool,
  intersectsBox,
  midpointHandles,
  moveElements,
  resizeElements,
  resolveElementGeometry,
  rotateElements,
  ROTATION_SNAP_DEGREES,
  segmentHandles,
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
  collectContainerDescendants,
  dropOnTarget,
  enterGroupOnDoubleClick,
  findDropTarget,
  reparentElementsToFrames,
  resolveTopmostGroupClick,
} from '@kujam/core';
import {
  findSnapAnchor,
  normalizeConnectorBounds,
  type ConnectorPreview,
  type ConnectorSnapTarget,
} from '../elements/connector-routing.js';
import { computeElementConnectorRoute, type ConnectorProps } from '../elements/connector.js';
import {
  insertLinePoint,
  lineWorldPoints,
  moveLinePoint,
  removeLinePoint,
  type LineProps,
} from '../elements/line.js';
import { buildDuplicate } from './duplicate.js';
import { extendLasso, startLasso } from './lasso.js';
import { handlePinch, handleWheel } from './navigation.js';
import {
  finishQuickConnect,
  quickConnectAt,
  quickConnectPreview,
  type QuickConnectTarget,
} from './quick-connect.js';

/** Screen distance a press must travel before it becomes a drag. @public */
export const DRAG_THRESHOLD_PX = 4;
/** Screen distance within which a resize or rotate handle is grabbed. @public */
export const HANDLE_TOLERANCE_PX = 8;
/** Screen distance of the rotate handle above the top edge of the selection frame. @public */
export const ROTATE_HANDLE_OFFSET_PX = 24;
/** Hit-test tolerance for clicking elements, in screen pixels. @public */
export const HIT_TOLERANCE_PX = 4;
/** Shortest elbow segment, in screen pixels, that gets a drag handle (twice the renderer's pill). */
const SEGMENT_MIN_LENGTH_PX = 32;
/** Shortest line segment, in screen pixels, that gets an insertion handle (same rule as the renderer). */
const LINE_MIDPOINT_MIN_LENGTH_PX = 24;

/** Handle identifier for select tool interactions. @public */
export type SelectHandle =
  | ResizeHandle
  | 'rotate'
  | 'connector-start'
  | 'connector-end'
  | 'connector-segment'
  | 'line-point'
  | 'line-insert';

/**
 * `ctx.data` of the select tool. The renderer reads it from `board.toolData` to draw feedback:
 * `brush` (selection box) and `guides` (snap guides). The other fields are internal.
 *
 * @beta
 */
export interface SelectToolData {
  /** Selection box in board coordinates while dragging on empty space, otherwise `null`. */
  brush: BoxBounds | null;
  /**
   * Lasso path in board coordinates during a Ctrl/Cmd+drag on empty space, otherwise `null`
   * (BOARD-910). Closed implicitly.
   */
  lasso: readonly Point[] | null;
  /** Screen position of the last point added to `lasso`. */
  lastScreen: Point | null;
  /** Snap guides while moving elements. */
  guides: readonly SnapGuide[];
  /** Handle being dragged while resizing, rotating, or reconnecting a connector endpoint. */
  handle: SelectHandle | null;
  /** Active snap target while dragging a connector endpoint. */
  connectorSnap?: ConnectorSnapTarget;
  /** Generated binding ID reused during a connector endpoint drag session. */
  reconnectBindingId?: string;
  /** Axis of the elbow segment being dragged (`connector-segment` handle). */
  segmentAxis?: 'x' | 'y';
  /**
   * Point of a `line` being dragged (`line-point` handle), or the segment whose middle gets a new
   * point (`line-insert` handle) (BOARD-1106).
   */
  linePoint?: number;
  /** Whether the `line-point` or `line-insert` press has turned into a drag. */
  lineDragging?: boolean;
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
  /**
   * Whether the pressed element is locked: a click selects it (so it can be unlocked from the
   * toolbar), and a drag draws a selection box instead of moving it (BOARD-902).
   */
  hitLocked: boolean;
  /** Whether the drag moves copies made with Alt instead of the selection (BOARD-903). */
  duplicating: boolean;
  /**
   * Element whose `dropTarget` accepts the moved elements under the pointer while translating,
   * highlighted by the overlay (BOARD-1208).
   */
  dropTargetId?: string | null;
  /** ID of the group currently entered for editing, or `null` at the root level (BOARD-909). */
  enteredGroupId: string | null;
  /** Quick-connect dot under the pointer while idle, highlighted by the overlay. */
  quickConnectHover?: string | null;
  /** Quick-connect dot being pressed or dragged from. */
  quickConnect?: QuickConnectTarget;
  /** Connector drawn while dragging from a quick-connect dot. */
  connectorPreview?: ConnectorPreview;
}

type State =
  | 'idle'
  | 'pointing'
  | 'translating'
  | 'brushing'
  | 'lassoing'
  | 'resizing'
  | 'rotating'
  | 'reconnecting'
  | 'bending'
  | 'reshaping'
  | 'quick-connecting';
type Ctx = ToolContext<State, SelectToolData>;

function initialData(): SelectToolData {
  return {
    brush: null,
    lasso: null,
    lastScreen: null,
    guides: [],
    handle: null,
    start: { x: 0, y: 0 },
    startScreen: { x: 0, y: 0 },
    originals: [],
    initialSelection: [],
    hitId: null,
    wasSelected: false,
    hitLocked: false,
    duplicating: false,
    enteredGroupId: null,
  };
}

/** Selected elements that may be transformed: not locked and allowed by the permission hooks. */
function transformable(board: Board): Readonly<ElementRecord>[] {
  return board.selection
    .map((id) => board.getElement(id))
    .filter((el): el is Readonly<ElementRecord> => !!el && !el.locked && board.can('update', el));
}

/** Transformable elements including all descendants of selected containers (groups and frames). */
function transformableWithDescendants(board: Board): Readonly<ElementRecord>[] {
  const selected = transformable(board);
  const descendants = collectContainerDescendants(
    board,
    selected.map((el) => el.id),
  );
  const allMoved = [...selected];
  const seen = new Set(selected.map((el) => el.id));
  for (const desc of descendants) {
    if (!seen.has(desc.id) && !desc.locked && board.can('update', desc)) {
      seen.add(desc.id);
      allMoved.push(desc);
    }
  }
  return allMoved;
}

/** Transformable elements for resize/rotate handles, expanding groups to their descendants. */
function transformableForHandles(board: Board): Readonly<ElementRecord>[] {
  const selected = transformable(board);
  const result: Readonly<ElementRecord>[] = [];
  for (const el of selected) {
    if (el.type === 'group') {
      const descendants = collectContainerDescendants(board, [el.id]);
      const content = descendants.filter(
        (d) => d.type !== 'group' && !d.locked && board.can('update', d),
      );
      if (content.length > 0) {
        result.push(...content);
      } else {
        result.push(el);
      }
    } else {
      result.push(el);
    }
  }
  return result;
}

function clearQuickConnect(ctx: Ctx): void {
  delete ctx.data.quickConnect;
  delete ctx.data.connectorPreview;
  delete ctx.data.connectorSnap;
  ctx.data.quickConnectHover = null;
}

/** The resize, rotate, or connector endpoint handle under `screen`, closest first. */
function handleAt(board: Board, screen: Point): SelectHandle | null {
  const items = transformable(board);
  if (items.length === 1 && items[0]!.type === 'line') {
    return (
      lineHandleAt(board, items[0] as Readonly<ElementRecord<LineProps>>, screen)?.handle ?? null
    );
  }
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
    return segmentAt(board, conn, screen) ? 'connector-segment' : null;
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

/** Resize cursors by handle direction, every 45 degrees clockwise from east. */
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;
const HANDLE_ANGLE: Readonly<Record<ResizeHandle, number>> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

/** CSS cursor for the handle under `screen`, or `null` for the default cursor. */
function hoverCursor(board: Board, screen: Point): string | null {
  const handle = handleAt(board, screen);
  if (!handle) return null;
  if (handle === 'rotate') return 'grab';
  if (handle === 'connector-start' || handle === 'connector-end') return 'crosshair';
  if (handle === 'line-point') return 'move';
  if (handle === 'line-insert') return 'copy';
  if (handle === 'connector-segment') {
    const items = transformable(board);
    const conn = items[0] as Readonly<ElementRecord<ConnectorProps>> | undefined;
    const segment = conn ? segmentAt(board, conn, screen) : null;
    return segment?.axis === 'x' ? 'ew-resize' : 'ns-resize';
  }
  // Rotated selections turn the resize arrows with them, snapped to 45 degrees.
  const frame = selectionFrame(transformable(board), { registry: board.elements });
  const angle = HANDLE_ANGLE[handle] + (frame?.rotation ?? 0);
  const step = ((Math.round(angle / 45) % 4) + 4) % 4;
  return RESIZE_CURSORS[step]!;
}

/** The draggable elbow segment of `conn` under `screen`, if any. */
function segmentAt(
  board: Board,
  conn: Readonly<ElementRecord<ConnectorProps>>,
  screen: Point,
): { axis: 'x' | 'y' } | null {
  if (conn.props.style !== 'elbow') return null;
  const route = computeElementConnectorRoute(conn as ElementRecord<ConnectorProps>, board);
  // Same screen-space rule as the renderer's segment pills.
  const onScreen = route.points.map((p) =>
    board.camera.boardToScreen({ x: conn.x + p.x, y: conn.y + p.y }),
  );
  for (const handle of segmentHandles(onScreen, SEGMENT_MIN_LENGTH_PX)) {
    if (Math.hypot(handle.x - screen.x, handle.y - screen.y) <= HANDLE_TOLERANCE_PX + 2) {
      return { axis: handle.axis };
    }
  }
  return null;
}

/**
 * The point handle (closest first) or segment insertion handle of `line` under `screen`
 * (BOARD-1106). Point handles win over insertion handles.
 */
function lineHandleAt(
  board: Board,
  line: Readonly<ElementRecord<LineProps>>,
  screen: Point,
): { handle: 'line-point' | 'line-insert'; index: number } | null {
  const onScreen = lineWorldPoints(line).map((p) => board.camera.boardToScreen(p));
  let best = -1;
  let bestDistance = HANDLE_TOLERANCE_PX;
  onScreen.forEach((p, i) => {
    const d = Math.hypot(p.x - screen.x, p.y - screen.y);
    if (d <= bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  if (best >= 0) return { handle: 'line-point', index: best };
  for (const mid of midpointHandles(onScreen, LINE_MIDPOINT_MIN_LENGTH_PX)) {
    if (Math.hypot(mid.x - screen.x, mid.y - screen.y) <= HANDLE_TOLERANCE_PX) {
      return { handle: 'line-insert', index: mid.index };
    }
  }
  return null;
}

/**
 * Point inserted by the last click on a line's insertion handle, per board: the second press of
 * a double click there lands on that new point and must not delete it again.
 */
const lastInsertedPoint = new WeakMap<Board, { id: string; index: number }>();

/**
 * Starts editing a lone selected `line` from the handle under the press (BOARD-1106): Alt+click or
 * double click on a point deletes it (lines keep at least 2 points); other presses start dragging
 * a point or a new one from a segment's middle. Returns the next state, or `undefined` when the
 * press was fully handled.
 */
function startLineEdit(ctx: Ctx, e: ToolPointerEvent): State | undefined {
  const { board, data } = ctx;
  const line = data.originals[0] as Readonly<ElementRecord<LineProps>> | undefined;
  if (!line || line.type !== 'line') return undefined;
  const hit = lineHandleAt(board, line, e.screen);
  if (!hit) return undefined;
  if (hit.handle === 'line-point' && (e.modifiers.alt || (e.clickCount ?? 1) >= 2)) {
    const inserted = lastInsertedPoint.get(board);
    lastInsertedPoint.delete(board);
    const justInserted =
      !e.modifiers.alt && inserted?.id === line.id && inserted.index === hit.index;
    const next = justInserted ? null : removeLinePoint(line, hit.index);
    if (next) ctx.change((tx) => tx.put(next as ElementRecord), { label: 'line-point-delete' });
    return undefined;
  }
  lastInsertedPoint.delete(board);
  data.linePoint = hit.index;
  return 'reshaping';
}

/** Applies a line point drag or insertion to the pointer (or `world`), from the snapshot. */
function reshapeLine(ctx: Ctx, world: Point): void {
  const { data } = ctx;
  const orig = data.originals[0] as Readonly<ElementRecord<LineProps>> | undefined;
  if (!orig || orig.type !== 'line' || data.linePoint === undefined) return;
  const next =
    data.handle === 'line-insert'
      ? insertLinePoint(orig, data.linePoint + 1, world)
      : moveLinePoint(orig, data.linePoint, world);
  ctx.change((tx) => tx.put(next as ElementRecord), {
    label: data.handle === 'line-insert' ? 'line-point-insert' : 'line-point',
  });
}

/** Moves the dragged elbow segment to the pointer, stored as the connector's `bend`. */
function dragConnectorSegment(ctx: Ctx, e: ToolPointerEvent): void {
  const { data } = ctx;
  const orig = data.originals[0] as ElementRecord<ConnectorProps> | undefined;
  if (!orig || orig.type !== 'connector' || !data.segmentAxis) return;
  const axis = data.segmentAxis;
  const mid =
    axis === 'x'
      ? orig.x + (orig.props.start.x + orig.props.end.x) / 2
      : orig.y + (orig.props.start.y + orig.props.end.y) / 2;
  const offset = (axis === 'x' ? e.point.x : e.point.y) - mid;
  const updated = { ...orig, props: { ...orig.props, bend: { axis, offset } } };
  ctx.change((tx) => tx.put(updated as ElementRecord), { label: 'connector-bend' });
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
  apply(
    ctx,
    moveElements(data.originals, snapped.delta.x, snapped.delta.y),
    data.duplicating ? 'duplicate' : 'move',
  );
  const target = findDropTarget(board, board.selection, e.point);
  if ((data.dropTargetId ?? null) !== (target?.id ?? null)) data.dropTargetId = target?.id ?? null;
}

/**
 * Alt+drag (BOARD-903): writes copies of the selection over the originals as part of the
 * interaction and selects them, so the drag moves the copies and the whole gesture is one undo step.
 * Returns `false` when nothing could be copied.
 */
function startDuplicate(ctx: Ctx): boolean {
  const { board, data } = ctx;
  if (board.readOnly || data.originals.length === 0) return false;
  const { records, copies } = buildDuplicate(board, data.originals);
  if (copies.length === 0) return false;
  ctx.change(
    (tx) => {
      for (const rec of records) tx.put(rec);
    },
    { label: 'duplicate' },
  );
  data.originals = copies;
  data.duplicating = true;
  board.select(copies.map((el) => el.id));
  return true;
}

/** Starts a selection box from the press point (empty space, or a locked element). */
function startBrushing(ctx: Ctx, e: ToolPointerEvent): 'brushing' {
  const { board, data } = ctx;
  if (!e.modifiers.shift) board.clearSelection();
  data.initialSelection = board.selection;
  return 'brushing';
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

/** Updates the selection box to the pointer and selects what it covers. */
function brush(ctx: Ctx, e: ToolPointerEvent): void {
  const { board, data } = ctx;
  const box = boxFrom(data.start, e.point);
  data.brush = box;
  const inside = elementsInBox(board, box, e.modifiers.alt);
  board.select(e.modifiers.shift ? [...data.initialSelection, ...inside] : inside);
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
 *   ones with Alt. Shift adds to the existing selection. Ctrl/Cmd+drag on empty space draws a
 *   free-form lasso with the same rules instead (BOARD-910).
 * - Dragging a selected element moves the selection, snapping to other elements and the grid
 *   (Ctrl/Cmd turns snapping off). Alt+drag moves copies instead and leaves the originals in
 *   place (BOARD-903).
 * - Clicking a locked element selects it, without handles, so it can be unlocked; dragging from
 *   it draws a selection box (BOARD-902).
 * - Dragging a handle resizes (Shift keeps the ratio) or rotates (Shift snaps to 15 degrees).
 * - Double click forwards to the element type's `onDoubleClick`; so does Enter on a single
 *   selected, unlocked element (BOARD-1902). Other keys are left unhandled.
 * - Esc (or pointer cancel) rolls back the interaction and restores the previous selection.
 * - Wheel scrolls, Ctrl/Cmd+wheel and pinch zoom.
 *
 * Locked elements are never boxed or transformed. Feedback for the overlay is in
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
          data.originals = transformableForHandles(board);
          delete data.reconnectBindingId;
          delete data.connectorSnap;
          if (handle === 'connector-start' || handle === 'connector-end') {
            return 'reconnecting';
          }
          if (handle === 'line-point' || handle === 'line-insert') {
            return startLineEdit(ctx, e);
          }
          if (handle === 'connector-segment') {
            const conn = data.originals[0] as ElementRecord<ConnectorProps> | undefined;
            const segment = conn ? segmentAt(board, conn, e.screen) : null;
            if (!segment) return;
            data.segmentAxis = segment.axis;
            return 'bending';
          }
          return handle === 'rotate' ? 'rotating' : 'resizing';
        }

        const quick = quickConnectAt(board, e.screen);
        if (quick) {
          data.quickConnect = quick;
          data.quickConnectHover = quick.side;
          return 'quick-connecting';
        }

        const rawHit = board.hitTest(e.point, {
          tolerance: HIT_TOLERANCE_PX,
          includeLocked: true,
        });
        data.duplicating = false;
        if (!rawHit) {
          data.enteredGroupId = null;
          // Ctrl/Cmd+drag on empty space draws a lasso instead of a box (BOARD-910).
          if (e.modifiers.ctrl || e.modifiers.meta) {
            startLasso(board, data, e);
            return 'lassoing';
          }
          return startBrushing(ctx, e);
        }

        const hit = resolveTopmostGroupClick(board, rawHit, data.enteredGroupId);

        data.hitId = hit.id;
        data.wasSelected = board.selection.includes(hit.id);
        data.hitLocked = hit.locked;
        // Locked: the selection changes on release, since a drag becomes a selection box.
        if (hit.locked) return 'pointing';

        if ((e.clickCount ?? 1) >= 2) {
          if (hit.type === 'group') {
            const entered = enterGroupOnDoubleClick(board, hit, e.point);
            if (entered) {
              data.enteredGroupId = entered.enteredGroupId;
              return;
            }
          }
          board.select(hit.id);
          board.elements.get(hit.type)?.onDoubleClick?.(hit as never, board.elementContext);
          return;
        }

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
      onKeyDown(ctx, e) {
        if (e.key === 'Escape' && !e.repeat && ctx.data.enteredGroupId) {
          const parentGroup = ctx.board.getElement(ctx.data.enteredGroupId);
          const outerGroupId =
            parentGroup?.parentId &&
            ctx.board.getElement(parentGroup.parentId)?.type === 'group'
              ? parentGroup.parentId
              : null;
          ctx.data.enteredGroupId = outerGroupId;
          if (parentGroup) {
            ctx.board.select(parentGroup.id);
          }
          return;
        }
        return editSelected(ctx, e);
      },
      onPointerMove(ctx, e) {
        const side = quickConnectAt(ctx.board, e.screen)?.side ?? null;
        if ((ctx.data.quickConnectHover ?? null) !== side) ctx.data.quickConnectHover = side;
        // The cursor shows what a press would grab; it stays during the drag that follows.
        ctx.setCursor(side ? 'crosshair' : hoverCursor(ctx.board, e.screen));
      },
      onWheel: (ctx, e) => handleWheel(ctx.board, e),
      onPinch: (ctx, e) => handlePinch(ctx.board, e),
    },

    'quick-connecting': {
      cursor: 'crosshair',
      onPointerMove(ctx, e) {
        const { board, data } = ctx;
        const s = data.startScreen;
        if (!data.quickConnect) return;
        if (
          !data.connectorPreview &&
          Math.hypot(e.screen.x - s.x, e.screen.y - s.y) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        const next = quickConnectPreview(board, data.quickConnect, e.point);
        if (!next) return;
        data.connectorPreview = next.preview;
        if (next.snap) data.connectorSnap = next.snap;
        else delete data.connectorSnap;
      },
      onPointerUp(ctx, e) {
        const { board, data } = ctx;
        const from = data.quickConnect;
        const dragged = Boolean(data.connectorPreview);
        clearQuickConnect(ctx);
        if (from) {
          finishQuickConnect(
            board,
            (fn) => ctx.change(fn, { label: 'quick-connect' }),
            from,
            dragged ? e.point : null,
          );
        }
        return 'idle';
      },
      onCancel: clearQuickConnect,
    },

    pointing: {
      onPointerMove(ctx, e) {
        const s = ctx.data.startScreen;
        if (Math.hypot(e.screen.x - s.x, e.screen.y - s.y) < DRAG_THRESHOLD_PX) return;
        if (ctx.data.hitLocked) {
          const next = startBrushing(ctx, e);
          brush(ctx, e);
          return next;
        }
        ctx.data.originals = transformableWithDescendants(ctx.board);
        if (e.modifiers.alt) startDuplicate(ctx);
        translate(ctx, e);
        return 'translating';
      },
      onPointerUp(ctx, e) {
        const { board, data } = ctx;
        if (data.hitLocked && data.hitId) {
          if (!e.modifiers.shift) board.select(data.hitId);
          else if (data.wasSelected) board.removeFromSelection(data.hitId);
          else board.addToSelection(data.hitId);
        } else if (data.wasSelected && !e.modifiers.shift && data.hitId) {
          // Clicking an element of a multi-selection without dragging selects just that element.
          board.select(data.hitId);
        }
        return 'idle';
      },
      onCancel: restoreSelection,
    },

    translating: {
      cursor: 'move',
      onPointerMove: translate,
      onPointerUp(ctx, e) {
        const { board } = ctx;
        const movedRoots = board.selection;
        // Dropping onto an element's `dropTarget` (BOARD-1208) joins the move's interaction, so
        // the move and the drop are one undo step.
        if (findDropTarget(board, movedRoots, e.point)) {
          let removedAll = false;
          let targetId: string | null = null;
          ctx.change(
            () => {
              const result = dropOnTarget(board, movedRoots, e.point);
              targetId = result?.targetId ?? null;
              removedAll = result !== null && result.removedIds.length === movedRoots.length;
            },
            { label: 'element.drop' },
          );
          // The target absorbed everything that was dragged: select it instead.
          if (removedAll && targetId !== null) board.select([targetId]);
        }
        reparentElementsToFrames(
          board,
          movedRoots.filter((id) => board.getElement(id) !== undefined),
        );
        return 'idle';
      },
      onCancel: restoreSelection,
    },

    brushing: {
      cursor: 'crosshair',
      onPointerMove: brush,
      onPointerUp: () => 'idle',
      onCancel: restoreSelection,
    },

    lassoing: {
      cursor: 'crosshair',
      onPointerMove: (ctx, e) => extendLasso(ctx.board, ctx.data, e),
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
          data.handle === 'connector-end' ||
          data.handle === 'connector-segment' ||
          data.handle === 'line-point' ||
          data.handle === 'line-insert'
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

    bending: {
      cursor: 'grabbing',
      onPointerMove: dragConnectorSegment,
      onPointerUp(ctx) {
        delete ctx.data.segmentAxis;
        return 'idle';
      },
      onCancel(ctx) {
        delete ctx.data.segmentAxis;
        restoreSelection(ctx);
      },
    },

    reshaping: {
      cursor: 'grabbing',
      onPointerMove(ctx, e) {
        const { data } = ctx;
        const s = data.startScreen;
        // A click leaves the line as it is; a drag has to travel first. Once started, small moves
        // back near the press still apply.
        if (
          !data.lineDragging &&
          Math.hypot(e.screen.x - s.x, e.screen.y - s.y) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        data.lineDragging = true;
        reshapeLine(ctx, e.point);
      },
      onPointerUp(ctx) {
        const { board, data } = ctx;
        const orig = data.originals[0] as Readonly<ElementRecord<LineProps>> | undefined;
        // A click on an insertion handle adds the point right in the middle of the segment.
        if (
          !data.lineDragging &&
          orig &&
          data.handle === 'line-insert' &&
          data.linePoint !== undefined
        ) {
          const world = lineWorldPoints(orig);
          const a = world[data.linePoint];
          const b = world[data.linePoint + 1];
          if (a && b) {
            reshapeLine(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            lastInsertedPoint.set(board, { id: orig.id, index: data.linePoint + 1 });
          }
        }
        delete data.linePoint;
        delete data.lineDragging;
        return 'idle';
      },
      onCancel(ctx) {
        delete ctx.data.linePoint;
        delete ctx.data.lineDragging;
        restoreSelection(ctx);
      },
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
