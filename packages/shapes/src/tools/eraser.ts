/**
 * Eraser tool for whole strokes and point slices (BOARD-913, BOARD-1005).
 */

import {
  defineTool,
  indexAbove,
  localToBoard,
  type Point,
  type ToolContext,
  type ToolDefinition,
  type Transaction,
} from '@kujam/core';
import {
  cutStrokePoints,
  distanceToSegment,
  segmentDistance,
} from '../elements/stroke-utils.js';
import { handlePinch, handleWheel } from './navigation.js';

/** Eraser operating mode (`stroke` cuts polylines; `area` deletes intersected elements). @public */
export type EraserMode = 'stroke' | 'area';
/** Element filter targeted by the eraser tool. @public */
export type EraserTargets = 'stroke' | 'all' | 'draw';
/** State names for {@link createEraserTool}. @public */
export type EraserToolState = 'idle' | 'erasing';

/** Runtime tool data for {@link createEraserTool}. @public */
export interface EraserToolData {
  mode: EraserMode;
  targets: EraserTargets;
  tolerance: number;
  lastPoint: Point | null;
  erasedIds: Set<string>;
}

/** Configuration options for {@link createEraserTool}. @public */
export interface EraserToolOptions {
  readonly id?: string;
  readonly mode?: EraserMode;
  readonly targets?: EraserTargets;
  readonly tolerance?: number;
}

function computeBoundingBox(points: readonly (readonly number[])[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    const x = pt[0] ?? 0;
    const y = pt[1] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  return { minX, minY, maxX, maxY };
}

function initialData(options?: EraserToolOptions): () => EraserToolData {
  return () => ({
    mode: options?.mode ?? 'stroke',
    targets: options?.targets ?? 'stroke',
    tolerance: options?.tolerance ?? 8,
    lastPoint: null,
    erasedIds: new Set<string>(),
  });
}

/**
 * Creates an eraser tool (BOARD-913, BOARD-1005).
 *
 * Supports stroke mode (deleting touched strokes completely) and area mode (slicing
 * strokes into one or more surviving fragments). By default only coretan (`draw`)
 * elements are affected; caller can pass `targets: 'all'` to affect other elements.
 * All mutations within one drag interaction form a single undo step.
 *
 * @public
 */
export function createEraserTool(
  options?: EraserToolOptions,
): ToolDefinition<EraserToolState, EraserToolData> {
  const toolId = options?.id ?? 'eraser';

  function eraseBetween(
    ctx: ToolContext<EraserToolState, EraserToolData>,
    p0: Point,
    p1: Point,
  ): void {
    const { board, data } = ctx;
    const { mode, targets, tolerance } = data;

    const minX = Math.min(p0.x, p1.x) - tolerance;
    const minY = Math.min(p0.y, p1.y) - tolerance;
    const maxX = Math.max(p0.x, p1.x) + tolerance;
    const maxY = Math.max(p0.y, p1.y) + tolerance;

    const candidates = board.query({
      inBounds: { minX, minY, maxX, maxY },
    });

    for (const el of candidates) {
      if (el.locked || data.erasedIds.has(el.id)) continue;

      const isStroke = el.type === 'draw';
      if (!isStroke && targets !== 'all') continue;

      if (isStroke) {
        const localPts = (el.props.points ?? []) as readonly (readonly number[])[];
        const boardPts = localPts.map((p) => {
          const bp = localToBoard(el, { x: p[0] ?? 0, y: p[1] ?? 0 });
          return [bp.x, bp.y, p[2] ?? 0.5];
        });

        if (mode === 'stroke') {
          const thickness = typeof el.props.thickness === 'number' ? el.props.thickness : 4;
          const hitRadius = tolerance + thickness / 2;
          let hit = false;

          for (let i = 0; i + 1 < boardPts.length; i++) {
            if (
              segmentDistance(boardPts[i]!, boardPts[i + 1]!, [p0.x, p0.y], [p1.x, p1.y]) <=
              hitRadius
            ) {
              hit = true;
              break;
            }
          }
          if (!hit && boardPts.length === 1) {
            if (distanceToSegment(boardPts[0]!, [p0.x, p0.y], [p1.x, p1.y]) <= hitRadius) {
              hit = true;
            }
          }

          if (hit) {
            data.erasedIds.add(el.id);
            ctx.change((tx: Transaction) => tx.remove(el.id), { label: toolId });
          }
        } else {
          // mode === 'area'
          const pieces = cutStrokePoints(boardPts, p0, p1, tolerance);
          if (pieces.length === 1 && pieces[0] === boardPts) {
            // Untouched
            continue;
          }

          if (pieces.length === 0) {
            data.erasedIds.add(el.id);
            ctx.change((tx: Transaction) => tx.remove(el.id), { label: toolId });
          } else {
            ctx.change(
              (tx: Transaction) => {
                const piece0 = pieces[0]!;
                const b0 = computeBoundingBox(piece0);
                const w0 = Math.max(1, b0.maxX - b0.minX);
                const h0 = Math.max(1, b0.maxY - b0.minY);
                const local0 = piece0.map((pt) => [
                  (pt[0] ?? 0) - b0.minX,
                  (pt[1] ?? 0) - b0.minY,
                  pt[2] ?? 0.5,
                ]);

                tx.put({
                  ...el,
                  x: b0.minX,
                  y: b0.minY,
                  w: w0,
                  h: h0,
                  rotation: 0,
                  props: {
                    ...el.props,
                    points: local0,
                  },
                });

                let prevIndex = el.index;
                for (let k = 1; k < pieces.length; k++) {
                  const pk = pieces[k]!;
                  const bk = computeBoundingBox(pk);
                  const wk = Math.max(1, bk.maxX - bk.minX);
                  const hk = Math.max(1, bk.maxY - bk.minY);
                  const localk = pk.map((pt) => [
                    (pt[0] ?? 0) - bk.minX,
                    (pt[1] ?? 0) - bk.minY,
                    pt[2] ?? 0.5,
                  ]);
                  const nextIndex = indexAbove(prevIndex);
                  prevIndex = nextIndex;

                  tx.put({
                    ...el,
                    id: board.createId(),
                    index: nextIndex,
                    x: bk.minX,
                    y: bk.minY,
                    w: wk,
                    h: hk,
                    rotation: 0,
                    props: {
                      ...el.props,
                      points: localk,
                    },
                  });
                }
              },
              { label: toolId },
            );
          }
        }
      } else {
        // targets === 'all' and non-stroke element
        const hit =
          board.hitTest(p1, { tolerance }) ??
          board.hitTest(p0, { tolerance }) ??
          board.hitTest({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, { tolerance });

        if (hit && hit.id === el.id && !hit.locked && !data.erasedIds.has(hit.id)) {
          data.erasedIds.add(hit.id);
          ctx.change((tx: Transaction) => tx.remove(hit.id), { label: toolId });
        }
      }
    }
  }

  return defineTool<EraserToolState, EraserToolData>({
    id: toolId,
    initial: 'idle',
    cursor: 'crosshair',
    data: initialData(options),
    states: {
      idle: {
        onPointerDown(ctx, e) {
          if (e.button !== 0 && e.button !== 5 && (e.buttons & 32) === 0) return;
          const { data } = ctx;
          data.erasedIds.clear();
          data.lastPoint = e.point;
          eraseBetween(ctx, e.point, e.point);
          return 'erasing';
        },
        onWheel: (ctx, e) => handleWheel(ctx.board, e),
        onPinch: (ctx, e) => handlePinch(ctx.board, e),
      },

      erasing: {
        cursor: 'crosshair',
        onPointerMove(ctx, e) {
          const { data } = ctx;
          const prev = data.lastPoint ?? e.point;
          eraseBetween(ctx, prev, e.point);
          data.lastPoint = e.point;
        },

        onPointerUp(ctx, e) {
          const { data } = ctx;
          if (data.lastPoint && e?.point) {
            eraseBetween(ctx, data.lastPoint, e.point);
          }
          data.lastPoint = null;
          data.erasedIds.clear();
          return 'idle';
        },

        onCancel(ctx) {
          const { data } = ctx;
          data.lastPoint = null;
          data.erasedIds.clear();
          return 'idle';
        },
      },
    },
  });
}

/**
 * Built-in eraser tool (E shortcut).
 *
 * @public
 */
export const eraserTool = createEraserTool();
