/**
 * Eraser tool (BOARD-913).
 */

import {
  defineTool,
  type Point,
  type ToolContext,
  type ToolDefinition,
  type Transaction,
} from '@kujam/core';
import { handlePinch, handleWheel } from './navigation.js';

export type EraserToolState = 'idle' | 'erasing';

export interface EraserToolData {
  erasedIds: Set<string>;
}

export interface EraserToolOptions {
  readonly id?: string;
  readonly tolerance?: number;
}

function initialData(): EraserToolData {
  return {
    erasedIds: new Set<string>(),
  };
}

/**
 * Creates an eraser tool (BOARD-913).
 *
 * Click or drag over elements to delete them via hit-testing.
 * All deletions in a single drag share a tool interaction for 1-step undo.
 * Remains active until Escape.
 *
 * @public
 */
export function createEraserTool(
  options?: EraserToolOptions,
): ToolDefinition<EraserToolState, EraserToolData> {
  const toolId = options?.id ?? 'eraser';
  const tolerance = options?.tolerance ?? 6;

  function eraseAt(ctx: ToolContext<EraserToolState, EraserToolData>, point: Point): void {
    const { board, data } = ctx;
    const hit = board.hitTest(point, { tolerance });
    if (hit && !hit.locked && !data.erasedIds.has(hit.id)) {
      data.erasedIds.add(hit.id);
      ctx.change((tx: Transaction) => tx.remove(hit.id), {
        label: toolId,
      });
    }
  }

  return defineTool<EraserToolState, EraserToolData>({
    id: toolId,
    initial: 'idle',
    cursor: 'crosshair',
    data: initialData,
    states: {
      idle: {
        onPointerDown(ctx, e) {
          if (e.button !== 0) return;
          const { data } = ctx;
          data.erasedIds.clear();
          eraseAt(ctx, e.point);
          return 'erasing';
        },
        onWheel: (ctx, e) => handleWheel(ctx.board, e),
        onPinch: (ctx, e) => handlePinch(ctx.board, e),
      },

      erasing: {
        cursor: 'crosshair',
        onPointerMove(ctx, e) {
          eraseAt(ctx, e.point);
        },

        onPointerUp(ctx) {
          const { data } = ctx;
          data.erasedIds.clear();
          return 'idle';
        },

        onCancel(ctx) {
          const { data } = ctx;
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
