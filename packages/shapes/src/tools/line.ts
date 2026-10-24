/**
 * Polyline creation tool (`id: 'line'`) (BOARD-1106).
 *
 * - Each click adds a point; pressing, dragging, and releasing adds the release point too, so a
 *   single drag draws a two-point line.
 * - Double click or Enter finishes the line and selects it (lines need at least 2 points), and so
 *   does switching to another tool. Backspace or Delete removes the last placed point. Esc drops
 *   the unfinished line.
 * - Shift snaps the next segment to 45 degree steps.
 * - While placing, `ctx.data.connectorPreview` holds the placed points plus the pointer, drawn by
 *   the renderer overlay like a connector preview.
 *
 * Points are collected without leaving the initial state, so every tap may come from a new
 * pointer (touch, pen), and the finished line is created in one transaction (one undo step).
 */

import {
  defineTool,
  indexAbove,
  type Board,
  type ElementRecord,
  type Point,
  type ToolContext,
  type ToolKeyEvent,
} from '@kujam/core';
import type { ColorKey } from '../colors.js';
import type {
  ArrowheadStyle,
  ConnectorDash,
  ConnectorPreview,
} from '../elements/connector-routing.js';
import {
  lineElement,
  MAX_LINE_POINTS,
  normalizeLinePoints,
  type LineProps,
} from '../elements/line.js';
import { GEO_STROKE_WIDTHS, rememberedProps } from '../styles.js';
import { handlePinch, handleWheel } from './navigation.js';

/** Screen distance a press must travel before its release adds a second point. */
const DRAG_POINT_THRESHOLD_PX = 4;
/** Screen distance under which a new point repeats the previous one and is ignored. */
const DUPLICATE_POINT_PX = 2;

/** State names for {@link lineTool}. @beta */
export type LineToolState = 'idle';

/**
 * Placement state of {@link lineTool}, exposed via `board.toolData`.
 *
 * @beta
 */
export interface LineToolData {
  /** Points placed so far, in board coordinates. */
  points: Point[];
  /** Screen position of the press in progress, or `null` between presses. */
  pressScreen: Point | null;
  /** Preview of the unfinished line through the pointer, for the overlay. */
  connectorPreview?: ConnectorPreview;
}

type Ctx = ToolContext<LineToolState, LineToolData>;

function initialData(): LineToolData {
  return { points: [], pressScreen: null };
}

function highestIndex(board: Board): string | null {
  const elements = board.query();
  return elements.length > 0 ? (elements[elements.length - 1]?.index ?? null) : null;
}

/** Style props of a line, everything but its points. */
interface LineStyle {
  color: ColorKey;
  strokeWidth: number;
  dash: ConnectorDash;
  startArrow: ArrowheadStyle;
  endArrow: ArrowheadStyle;
}

/** Remembered line style merged over the element defaults. */
function lineStyle(board: Board): LineStyle {
  const merged = {
    ...lineElement.defaults,
    ...(board.elements.get('line')?.defaults ?? {}),
    ...rememberedProps(board, 'line', 'line'),
  } as Partial<LineStyle>;
  return {
    color: merged.color ?? 'black',
    strokeWidth: merged.strokeWidth ?? GEO_STROKE_WIDTHS.m,
    dash: merged.dash ?? 'solid',
    startArrow: merged.startArrow ?? 'none',
    endArrow: merged.endArrow ?? 'none',
  };
}

/** `to` turned around `from` to the nearest 45 degree direction. */
function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/** The pointer position, snapped from the last point while Shift is held. */
function target(ctx: Ctx, point: Point, shift: boolean): Point {
  const last = ctx.data.points[ctx.data.points.length - 1];
  return shift && last ? snapAngle(last, point) : point;
}

function updatePreview(ctx: Ctx, pointer: Point | null): void {
  const { data } = ctx;
  const points = pointer ? [...data.points, pointer] : [...data.points];
  if (points.length < 2) {
    delete data.connectorPreview;
    return;
  }
  const style = lineStyle(ctx.board);
  data.connectorPreview = {
    start: points[0]!,
    end: points[points.length - 1]!,
    points,
    style: 'straight',
    startArrow: style.startArrow,
    endArrow: style.endArrow,
    color: style.color,
    strokeWidth: style.strokeWidth,
    dash: style.dash,
  };
}

/** Adds `point` unless it repeats the previous point or the line is full. */
function addPoint(ctx: Ctx, point: Point): void {
  const { board, data } = ctx;
  if (data.points.length >= MAX_LINE_POINTS) return;
  const last = data.points[data.points.length - 1];
  if (last) {
    const a = board.camera.boardToScreen(last);
    const b = board.camera.boardToScreen(point);
    if (Math.hypot(a.x - b.x, a.y - b.y) < DUPLICATE_POINT_PX) return;
  }
  data.points.push({ x: point.x, y: point.y });
}

/** Builds a `line` record through `world` points (board coordinates) with the remembered style. @internal */
export function buildLineElement(
  board: Board,
  id: string,
  world: readonly Point[],
): ElementRecord<LineProps> {
  const box = normalizeLinePoints(world);
  return {
    id,
    kind: 'element',
    type: 'line',
    pageId: board.pages.current,
    parentId: null,
    index: indexAbove(highestIndex(board)),
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rotation: 0,
    locked: false,
    opacity: 1,
    props: { ...lineStyle(board), points: box.points },
    typeVersion: board.elements.get('line')?.version ?? 1,
    meta: {},
  };
}

/** Creates the placed line (when it has 2 or more points) and starts a new one. */
function finish(ctx: Ctx): void {
  const { board, data } = ctx;
  const points = data.points;
  data.points = [];
  data.pressScreen = null;
  delete data.connectorPreview;
  if (points.length < 2 || board.readOnly) return;
  const el = buildLineElement(board, board.createId(), points);
  ctx.change((tx) => tx.put(el), { label: 'line' });
  if (board.getElement(el.id)) board.select([el.id]);
}

function plainKey(e: ToolKeyEvent): boolean {
  const m = e.modifiers;
  return !e.repeat && !m.shift && !m.alt && !m.ctrl && !m.meta;
}

/**
 * Polyline creation tool (BOARD-1106): click by click adds points, double click or Enter finishes.
 *
 * @beta
 */
export const lineTool = defineTool<LineToolState, LineToolData>({
  id: 'line',
  cursor: 'crosshair',
  initial: 'idle',
  data: initialData,
  states: {
    idle: {
      onPointerDown(ctx, e) {
        if (e.button !== 0 || ctx.board.readOnly) return;
        if ((e.clickCount ?? 1) >= 2) {
          // The first press of the double click already placed the last point.
          finish(ctx);
          return;
        }
        // A new line starts with nothing selected, so Backspace and Delete reach this tool
        // instead of deleting the previous line.
        if (ctx.data.points.length === 0) ctx.board.clearSelection();
        addPoint(ctx, target(ctx, e.point, e.modifiers.shift));
        ctx.data.pressScreen = e.screen;
        updatePreview(ctx, null);
      },
      onPointerMove(ctx, e) {
        if (ctx.data.points.length === 0) return;
        updatePreview(ctx, target(ctx, e.point, e.modifiers.shift));
      },
      onPointerUp(ctx, e) {
        const { data } = ctx;
        const press = data.pressScreen;
        data.pressScreen = null;
        if (!press) return;
        if (Math.hypot(e.screen.x - press.x, e.screen.y - press.y) >= DRAG_POINT_THRESHOLD_PX) {
          addPoint(ctx, target(ctx, e.point, e.modifiers.shift));
        }
        updatePreview(ctx, null);
      },
      onKeyDown(ctx, e) {
        const { data } = ctx;
        if (e.key === 'Enter' && plainKey(e)) {
          if (data.points.length === 0) return false;
          finish(ctx);
          return;
        }
        if ((e.key === 'Backspace' || e.key === 'Delete') && plainKey(e)) {
          if (data.points.length === 0) return false;
          data.points.pop();
          updatePreview(ctx, null);
          return;
        }
        return false;
      },
      // Switching tools (toolbar, shortcut) keeps the line placed so far; Esc clears it first.
      onExit: finish,
      onWheel: (ctx, e) => handleWheel(ctx.board, e),
      onPinch: (ctx, e) => handlePinch(ctx.board, e),
    },
  },
});
