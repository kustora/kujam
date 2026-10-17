/**
 * Shared state machine factory for box-based element placement tools (BOARD-913).
 */

import {
  defineTool,
  indexAbove,
  type Board,
  type ElementRecord,
  type Point,
  type ToolContext,
  type ToolDefinition,
} from '@kujam/core';
import { handlePinch, handleWheel } from './navigation.js';

export const DRAG_THRESHOLD_PX = 4;

export type BoxToolState = 'idle' | 'pointing';

export interface BoxToolData {
  start: Point;
  startScreen: Point;
  element: ElementRecord | null;
  dragged: boolean;
}

export interface BoxToolOptions<P = Record<string, unknown>> {
  readonly id: string;
  readonly type: string;
  readonly cursor?: string;
  readonly defaultSize: { readonly w: number; readonly h: number };
  readonly props?: Partial<P> | ((board: Board) => Partial<P>);
  readonly minSize?: { readonly w: number; readonly h: number };
  readonly lockAspectWithShift?: boolean;
  readonly onCreated?: (el: ElementRecord<P>, ctx: ToolContext<BoxToolState, BoxToolData>) => void;
}

function highestIndex(board: Board): string | null {
  const elements = board.query();
  return elements.length > 0 ? (elements[elements.length - 1]?.index ?? null) : null;
}

function initialData(): BoxToolData {
  return {
    start: { x: 0, y: 0 },
    startScreen: { x: 0, y: 0 },
    element: null,
    dragged: false,
  };
}

/**
 * Creates a tool definition that places or drags a box-shaped element (BOARD-913).
 *
 * Click creates an element at default size, dragging creates an element with the dragged bounds.
 * Remains active until Esc.
 *
 * @internal
 */
export function createBoxTool<P = Record<string, unknown>>(
  options: BoxToolOptions<P>,
): ToolDefinition<BoxToolState, BoxToolData> {
  const minW = options.minSize?.w ?? 10;
  const minH = options.minSize?.h ?? 10;

  return defineTool<BoxToolState, BoxToolData>({
    id: options.id,
    initial: 'idle',
    cursor: options.cursor ?? 'crosshair',
    data: initialData,
    states: {
      idle: {
        onPointerDown(ctx, e) {
          if (e.button !== 0) return;
          const data = ctx.data;
          data.start = e.point;
          data.startScreen = e.screen;
          data.element = null;
          data.dragged = false;
          return 'pointing';
        },
        onWheel: (ctx, e) => handleWheel(ctx.board, e),
        onPinch: (ctx, e) => handlePinch(ctx.board, e),
      },

      pointing: {
        cursor: options.cursor ?? 'crosshair',
        onPointerMove(ctx, e) {
          const { data, board } = ctx;
          const travel = Math.hypot(e.screen.x - data.startScreen.x, e.screen.y - data.startScreen.y);

          if (!data.dragged) {
            if (travel < DRAG_THRESHOLD_PX) return;
            data.dragged = true;

            const def = board.elements.get(options.type);
            const propsObj =
              typeof options.props === 'function' ? options.props(board) : (options.props ?? {});
            const mergedProps = {
              ...(def?.defaults ?? {}),
              ...propsObj,
            } as P;

            const el: ElementRecord<P> = {
              id: board.createId(),
              kind: 'element',
              type: options.type,
              pageId: board.pages.current,
              parentId: null,
              index: indexAbove(highestIndex(board)),
              x: data.start.x,
              y: data.start.y,
              rotation: 0,
              w: minW,
              h: minH,
              locked: false,
              opacity: 1,
              props: mergedProps,
              typeVersion: def?.version ?? 1,
              meta: {},
            };
            data.element = el as unknown as ElementRecord;
          }

          if (data.element) {
            let w = Math.abs(e.point.x - data.start.x);
            let h = Math.abs(e.point.y - data.start.y);

            if (options.lockAspectWithShift && e.modifiers.shift) {
              const max = Math.max(w, h);
              w = max;
              h = max;
            }

            const x = e.point.x < data.start.x ? data.start.x - w : data.start.x;
            const y = e.point.y < data.start.y ? data.start.y - h : data.start.y;

            const updated: ElementRecord = {
              ...data.element,
              x,
              y,
              w: Math.max(minW, w),
              h: Math.max(minH, h),
            };
            data.element = updated;
            ctx.change((tx) => tx.put(updated), { label: options.id });
          }
        },

        onPointerUp(ctx) {
          const { data, board } = ctx;

          if (!data.dragged) {
            // Click to create default size
            const def = board.elements.get(options.type);
            const propsObj =
              typeof options.props === 'function' ? options.props(board) : (options.props ?? {});
            const mergedProps = {
              ...(def?.defaults ?? {}),
              ...propsObj,
            } as P;

            const el: ElementRecord<P> = {
              id: board.createId(),
              kind: 'element',
              type: options.type,
              pageId: board.pages.current,
              parentId: null,
              index: indexAbove(highestIndex(board)),
              x: data.start.x,
              y: data.start.y,
              rotation: 0,
              w: options.defaultSize.w,
              h: options.defaultSize.h,
              locked: false,
              opacity: 1,
              props: mergedProps,
              typeVersion: def?.version ?? 1,
              meta: {},
            };
            ctx.change((tx) => tx.put(el as unknown as ElementRecord), { label: options.id });
            board.select([el.id]);
            options.onCreated?.(el, ctx);
          } else if (data.element) {
            board.select([data.element.id]);
            options.onCreated?.(data.element as unknown as ElementRecord<P>, ctx);
          }

          // Tool stays active in idle until Esc (BOARD-913)
          return 'idle';
        },

        onCancel(ctx) {
          const { data } = ctx;
          if (data.element) {
            ctx.change((tx) => tx.remove(data.element!.id), { label: options.id });
          }
          data.element = null;
          data.dragged = false;
          return 'idle';
        },
      },
    },
  });
}
