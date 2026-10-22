import {
  containedInPolygon,
  defineTool,
  intersectsPolygon,
  resolveElementGeometry,
  type Board,
  type Point,
  type ToolPointerEvent,
} from '@kujam/core';
import { handlePinch, handleWheel } from './navigation.js';

/** Screen distance the pointer must travel before the lasso gets a new point (BOARD-910). @public */
export const LASSO_MIN_POINT_DISTANCE_PX = 3;

/**
 * Most points a lasso keeps. Past this, the path stops growing and closes straight back to its
 * start, which keeps hit-testing bounded for very long drags (BOARD-910).
 *
 * @public
 */
export const MAX_LASSO_POINTS = 2000;

/**
 * `ctx.data` of the lasso tool (BOARD-910). The renderer reads `lasso` from `board.toolData` and
 * draws it as a closed, filled path.
 *
 * @beta
 */
export interface LassoToolData {
  /** Lasso path in board coordinates while dragging, otherwise `null`. Closed implicitly. */
  lasso: readonly Point[] | null;
  /** Screen position of the last point added to `lasso`. */
  lastScreen: Point | null;
  /** Selection when the drag started, kept with Shift and restored when it is cancelled. */
  initialSelection: readonly string[];
}

/**
 * IDs of the unlocked elements the closed polygon `points` (board coordinates) covers fully, or
 * touches at all with `partial` (BOARD-910). Each element is tested against its own contour
 * (`geometry`, with rotation), not its bounding box, so concave lassos select precisely.
 *
 * @beta
 */
export function elementsInLasso(
  board: Board,
  points: readonly Point[],
  partial: boolean,
): string[] {
  if (points.length < 3) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return board
    .query({ inBounds: { minX, minY, maxX, maxY } })
    .filter((el) => {
      if (el.locked) return false;
      const def = board.elements.get(el.type);
      const geometry = resolveElementGeometry(el, def?.geometry && (() => def.geometry!(el)));
      return partial
        ? intersectsPolygon(geometry, points, el)
        : containedInPolygon(geometry, points, el);
    })
    .map((el) => el.id);
}

/** Lasso drag state shared by the lasso tool and the select tool's Ctrl/Cmd+drag mode. */
export interface LassoDrag {
  lasso: readonly Point[] | null;
  lastScreen: Point | null;
  initialSelection: readonly string[];
}

/** Starts a lasso at the press; without Shift the current selection is cleared. */
export function startLasso(board: Board, data: LassoDrag, e: ToolPointerEvent): void {
  data.initialSelection = board.selection;
  if (!e.modifiers.shift) board.clearSelection();
  data.lasso = [e.point];
  data.lastScreen = e.screen;
}

/**
 * Extends the lasso to the pointer and selects what it covers: fully covered elements, or touched
 * ones with Alt. Shift adds to the selection the drag started with.
 */
export function extendLasso(board: Board, data: LassoDrag, e: ToolPointerEvent): void {
  const path = data.lasso ?? [e.point];
  const last = data.lastScreen ?? e.screen;
  if (
    path.length < MAX_LASSO_POINTS &&
    Math.hypot(e.screen.x - last.x, e.screen.y - last.y) >= LASSO_MIN_POINT_DISTANCE_PX
  ) {
    data.lasso = [...path, e.point];
    data.lastScreen = e.screen;
  }
  const inside = elementsInLasso(board, data.lasso ?? path, e.modifiers.alt);
  board.select(e.modifiers.shift ? [...new Set([...data.initialSelection, ...inside])] : inside);
}

/**
 * Lasso tool (BOARD-910): dragging draws a free-form polygon and selects the elements it covers
 * fully; with Alt, the elements it touches. Shift adds to the existing selection; Esc (or pointer
 * cancel) restores the selection from before the drag. Locked elements are never selected. Wheel
 * and pinch navigate like in the select tool.
 *
 * The select tool offers the same lasso with Ctrl/Cmd+drag on empty space.
 *
 * @beta
 */
export const lassoTool = defineTool({
  id: 'lasso',
  cursor: 'crosshair',
  initial: 'idle',
  data: (): LassoToolData => ({ lasso: null, lastScreen: null, initialSelection: [] }),
  states: {
    idle: {
      onPointerDown(ctx, e) {
        if (e.button !== 0) return;
        startLasso(ctx.board, ctx.data, e);
        return 'lassoing';
      },
      onWheel: (ctx, e) => handleWheel(ctx.board, e),
      onPinch: (ctx, e) => handlePinch(ctx.board, e),
    },
    lassoing: {
      onPointerMove: (ctx, e) => extendLasso(ctx.board, ctx.data, e),
      onPointerUp: () => 'idle',
      onCancel(ctx) {
        ctx.board.select(ctx.data.initialSelection);
      },
    },
  },
});
