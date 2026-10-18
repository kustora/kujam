/**
 * Freehand drawing tool (BOARD-913, BOARD-1002).
 */

import {
  defineTool,
  indexAbove,
  type Board,
  type ElementRecord,
  type ToolContext,
  type ToolDefinition,
  type ToolPointerEvent,
  type Transaction,
} from '@kujam/core';
import { COLOR_VALUES, type ColorKey } from '../colors.js';
import { MAX_DRAW_POINTS } from '../elements/draw.js';
import { chunkPoints, simplifyPoints } from '../elements/stroke-utils.js';
import { rememberedProps } from '../styles.js';
import { handlePinch, handleWheel } from './navigation.js';

export interface ActiveStroke {
  readonly points: readonly (readonly number[])[];
  readonly color: string;
  readonly thickness: number;
  readonly brush: string;
}

export type DrawToolState = 'idle' | 'drawing';

export interface DrawToolData {
  points: number[][];
  activeStroke: ActiveStroke | null;
  elementId?: string | null;
  color: ColorKey;
  thickness: number;
  brush: string;
}

/**
 * Options of {@link createDrawTool}. `color`, `thickness`, and `brush` are the starting style; the
 * style remembered for the tool in `board.toolStyles` wins over them (BOARD-1108).
 */
export interface DrawToolOptions {
  readonly id?: string;
  readonly color?: ColorKey;
  /** Stroke thickness. Defaults to the brush's `strokeOptions.size`, else 4. */
  readonly thickness?: number;
  readonly brush?: string;
}

function highestIndex(board: Board): string | null {
  const elements = board.query();
  return elements.length > 0 ? (elements[elements.length - 1]?.index ?? null) : null;
}

/**
 * Applies the tool's current style to `data` (BOARD-1108): the remembered style, then the tool
 * options, then the brush's default size for the thickness.
 */
function applyStyle(board: Board, toolId: string, data: DrawToolData, options?: DrawToolOptions) {
  const style = rememberedProps(board, toolId, 'draw') as {
    color?: ColorKey;
    thickness?: number;
    brush?: string;
  };
  data.color = style.color ?? options?.color ?? 'black';
  data.brush = style.brush ?? options?.brush ?? 'pen';
  data.thickness =
    style.thickness ?? options?.thickness ?? board.brushes.get(data.brush)?.strokeOptions.size ?? 4;
}

function initialData(options?: DrawToolOptions): () => DrawToolData {
  return () => ({
    points: [],
    activeStroke: null,
    elementId: null,
    color: options?.color ?? 'black',
    thickness: options?.thickness ?? 4,
    brush: options?.brush ?? 'pen',
  });
}

/**
 * Creates a freehand drawing tool (BOARD-913, BOARD-1002).
 *
 * Streams active stroke points to the overlay canvas during drawing, simplifies them
 * with RDP and chunks if exceeding MAX_DRAW_POINTS, and finalizes them as regular board
 * element(s) upon pointer completion.
 *
 * @public
 */
export function createDrawTool(
  options?: DrawToolOptions,
): ToolDefinition<DrawToolState, DrawToolData> {
  const toolId = options?.id ?? 'draw';

  return defineTool<DrawToolState, DrawToolData>({
    id: toolId,
    initial: 'idle',
    cursor: 'crosshair',
    data: initialData(options),
    states: {
      idle: {
        onPointerDown(ctx, e) {
          if (e.button !== 0) return;
          const { data } = ctx;
          applyStyle(ctx.board, toolId, data, options);
          const pressure = e.pressure || 0.5;
          data.points = [[e.point.x, e.point.y, pressure]];
          data.activeStroke = {
            points: data.points,
            color: COLOR_VALUES[data.color] ?? data.color,
            thickness: data.thickness,
            brush: data.brush,
          };
          return 'drawing';
        },
        onWheel: (ctx, e) => handleWheel(ctx.board, e),
        onPinch: (ctx, e) => handlePinch(ctx.board, e),
      },

      drawing: {
        cursor: 'crosshair',
        onPointerMove(ctx, e) {
          const { data } = ctx;
          const pressure = e.pressure || 0.5;
          data.points.push([e.point.x, e.point.y, pressure]);
          data.activeStroke = {
            points: data.points,
            color: COLOR_VALUES[data.color] ?? data.color,
            thickness: data.thickness,
            brush: data.brush,
          };
        },

        onPointerUp(ctx: ToolContext<DrawToolState, DrawToolData>, e?: ToolPointerEvent) {
          const { board, data } = ctx;
          if (e?.point) {
            const last = data.points.at(-1);
            if (!last || last[0] !== e.point.x || last[1] !== e.point.y) {
              data.points.push([e.point.x, e.point.y, e.pressure || 0.5]);
            }
          }

          if (data.points.length > 0) {
            // Simplify points with Ramer-Douglas-Peucker tolerance ~0.5 px (BOARD-1002)
            const simplified = simplifyPoints(data.points, 0.5);
            // Split if points exceed MAX_DRAW_POINTS (BOARD-1002)
            const chunks = chunkPoints(simplified, MAX_DRAW_POINTS);
            let lastIndex = highestIndex(board);
            const elements: ElementRecord[] = [];

            for (const chunk of chunks) {
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -Infinity;
              let maxY = -Infinity;

              for (const p of chunk) {
                const x = p[0] ?? 0;
                const y = p[1] ?? 0;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
              }

              const w = Math.max(1, maxX - minX);
              const h = Math.max(1, maxY - minY);
              const localPoints = chunk.map((p) => [
                (p[0] ?? 0) - minX,
                (p[1] ?? 0) - minY,
                p[2] ?? 0.5,
              ]);

              const nextIndex = indexAbove(lastIndex);
              lastIndex = nextIndex;

              elements.push({
                id: board.createId(),
                kind: 'element',
                type: 'draw',
                pageId: board.pages.current,
                parentId: null,
                index: nextIndex,
                x: minX,
                y: minY,
                w,
                h,
                rotation: 0,
                locked: false,
                opacity: 1,
                props: {
                  points: localPoints,
                  color: data.color,
                  thickness: data.thickness,
                  brush: data.brush,
                },
                typeVersion: 1,
                meta: {},
              });
            }

            if (elements.length > 0) {
              ctx.change(
                (tx: Transaction) => {
                  for (const el of elements) {
                    tx.put(el);
                  }
                },
                { label: toolId },
              );
              board.select(elements.map((el) => el.id));
            }
          }

          data.points = [];
          data.activeStroke = null;
          return 'idle';
        },

        onCancel(ctx: ToolContext<DrawToolState, DrawToolData>) {
          const { data } = ctx;
          data.points = [];
          data.activeStroke = null;
          return 'idle';
        },
      },
    },
  });
}

/**
 * Built-in draw tool (P shortcut).
 *
 * @public
 */
export const drawTool = createDrawTool();
