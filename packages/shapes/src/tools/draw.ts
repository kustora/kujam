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
  type Transaction,
} from '@kujam/core';
import type { ColorKey } from '../colors.js';
import { MAX_DRAW_POINTS } from '../elements/draw.js';
import { handlePinch, handleWheel } from './navigation.js';

interface DrawPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

export type DrawToolState = 'idle' | 'drawing';

export interface DrawToolData {
  points: DrawPoint[];
  elementId: string | null;
  color: ColorKey;
  thickness: number;
  brush: string;
}

export interface DrawToolOptions {
  readonly id?: string;
  readonly color?: ColorKey;
  readonly thickness?: number;
  readonly brush?: string;
}

function highestIndex(board: Board): string | null {
  const elements = board.query();
  return elements.length > 0 ? (elements[elements.length - 1]?.index ?? null) : null;
}

function initialData(options?: DrawToolOptions): () => DrawToolData {
  return () => ({
    points: [],
    elementId: null,
    color: options?.color ?? 'black',
    thickness: options?.thickness ?? 4,
    brush: options?.brush ?? 'pen',
  });
}

/**
 * Creates a freehand drawing tool (BOARD-913).
 *
 * Streams points to a `draw` element in local coordinates.
 * Remains active until Escape.
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
          const { board, data } = ctx;
          const id = board.createId();
          data.elementId = id;
          const pressure = e.pressure || 0.5;
          data.points = [{ x: e.point.x, y: e.point.y, pressure }];

          const el: ElementRecord = {
            id,
            kind: 'element',
            type: 'draw',
            pageId: board.pages.current,
            parentId: null,
            index: indexAbove(highestIndex(board)),
            x: e.point.x,
            y: e.point.y,
            w: 1,
            h: 1,
            rotation: 0,
            locked: false,
            opacity: 1,
            props: {
              points: [[0, 0, pressure]],
              color: data.color,
              thickness: data.thickness,
              brush: data.brush,
            },
            typeVersion: 1,
            meta: {},
          };

          ctx.change((tx: Transaction) => tx.put(el), {
            label: toolId,
          });

          return 'drawing';
        },
        onWheel: (ctx, e) => handleWheel(ctx.board, e),
        onPinch: (ctx, e) => handlePinch(ctx.board, e),
      },

      drawing: {
        cursor: 'crosshair',
        onPointerMove(ctx, e) {
          const { board, data } = ctx;
          if (!data.elementId || data.points.length >= MAX_DRAW_POINTS) return;

          const pressure = e.pressure || 0.5;
          data.points.push({ x: e.point.x, y: e.point.y, pressure });

          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;

          for (const p of data.points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }

          const w = Math.max(1, maxX - minX);
          const h = Math.max(1, maxY - minY);

          const localPoints = data.points.map((p: DrawPoint) => [
            p.x - minX,
            p.y - minY,
            p.pressure,
          ]);

          const existing = board.getElement(data.elementId);
          if (existing) {
            const updated: ElementRecord = {
              ...existing,
              x: minX,
              y: minY,
              w,
              h,
              props: {
                ...existing.props,
                points: localPoints,
              },
            };
            ctx.change((tx: Transaction) => tx.put(updated), {
              label: toolId,
            });
          }
        },

        onPointerUp(ctx: ToolContext<DrawToolState, DrawToolData>) {
          const { board, data } = ctx;
          if (data.elementId) {
            board.select([data.elementId]);
          }
          data.elementId = null;
          data.points = [];
          return 'idle';
        },

        onCancel(ctx: ToolContext<DrawToolState, DrawToolData>) {
          const { data } = ctx;
          if (data.elementId) {
            ctx.change((tx: Transaction) => tx.remove(data.elementId!), {
              label: toolId,
            });
          }
          data.elementId = null;
          data.points = [];
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
