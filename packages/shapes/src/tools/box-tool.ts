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
  type ToolKeyEvent,
} from '@kujam/core';
import { rememberedProps } from '../styles.js';
import { handlePinch, handleWheel } from './navigation.js';

export const DRAG_THRESHOLD_PX = 4;

export type BoxToolState = 'idle' | 'pointing';

export interface BoxToolData {
  start: Point;
  startScreen: Point;
  element: ElementRecord | null;
  dragged: boolean;
}

/** Options for {@link createBoxTool}. @public */
export interface BoxToolOptions<P = Record<string, unknown>> {
  readonly id: string;
  readonly type: string;
  readonly cursor?: string;
  readonly defaultSize: { readonly w: number; readonly h: number };
  /** Fixed props of every new element; they win over the remembered style. */
  readonly props?: Partial<P> | ((board: Board) => Partial<P>);
  /**
   * `board.toolStyles` key whose style new elements get (BOARD-1108). Defaults to `id`; tools that
   * are variants of one another can share one, as the built-in shape tools share `geo`.
   */
  readonly styleId?: string;
  readonly minSize?: { readonly w: number; readonly h: number };
  readonly lockAspectWithShift?: boolean;
  readonly onCreated?: (el: ElementRecord<P>, ctx: ToolContext<BoxToolState, BoxToolData>) => void;
  /**
   * Switches to the `select` tool (when registered) after each new element, with the element
   * selected, instead of staying active until Esc.
   */
  readonly returnToSelect?: boolean;
}

function highestIndex(board: Board): string | null {
  const elements = board.query();
  return elements.length > 0 ? (elements[elements.length - 1]?.index ?? null) : null;
}

/** Props of a new element: type defaults, then the remembered tool style, then fixed props. */
function newProps<P>(board: Board, options: BoxToolOptions<P>): P {
  const def = board.elements.get(options.type);
  const fixed = typeof options.props === 'function' ? options.props(board) : (options.props ?? {});
  return {
    ...(def?.defaults ?? {}),
    ...rememberedProps(board, options.styleId ?? options.id, options.type),
    ...fixed,
  } as P;
}

/** New element record of the tool's type at the given box, with the tool's props. */
function buildElement<P>(
  board: Board,
  options: BoxToolOptions<P>,
  box: { x: number; y: number; w: number; h: number },
): ElementRecord<P> {
  const def = board.elements.get(options.type);
  return {
    id: board.createId(),
    kind: 'element',
    type: options.type,
    pageId: board.pages.current,
    parentId: null,
    index: indexAbove(highestIndex(board)),
    ...box,
    rotation: 0,
    locked: false,
    opacity: 1,
    props: newProps(board, options),
    typeVersion: def?.version ?? 1,
    meta: {},
  };
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
 * Click creates an element at default size, dragging creates an element with the dragged bounds,
 * and Enter creates one at default size in the center of the viewport (BOARD-1902). Other keys
 * are left unhandled. Remains active until Esc, unless `returnToSelect` is set.
 *
 * @internal
 */
export function createBoxTool<P = Record<string, unknown>>(
  options: BoxToolOptions<P>,
): ToolDefinition<BoxToolState, BoxToolData> {
  const minW = options.minSize?.w ?? 10;
  const minH = options.minSize?.h ?? 10;
  type Ctx = ToolContext<BoxToolState, BoxToolData>;

  /** Creates an element of the default size with its top-left corner at `x`, `y`, and selects it. */
  function place(ctx: Ctx, x: number, y: number): void {
    const { board } = ctx;
    const el = buildElement(board, options, { x, y, ...options.defaultSize });
    ctx.change((tx) => tx.put(el as unknown as ElementRecord), { label: options.id });
    board.select([el.id]);
    options.onCreated?.(el, ctx);
    afterCreate(ctx);
  }

  function afterCreate(ctx: Ctx): void {
    if (!options.returnToSelect || !ctx.board.tools.has('select')) return;
    // Switching tools cancels the active gesture, and cancelling removes a dragged element: commit
    // the new element and let go of it first.
    ctx.data.element = null;
    ctx.data.dragged = false;
    ctx.commit();
    ctx.board.setTool('select');
  }

  /** Enter places an element of the default size at the viewport center (BOARD-1902). */
  function placeAtCenter(ctx: Ctx, e: ToolKeyEvent): false | void {
    const m = e.modifiers;
    if (e.key !== 'Enter' || e.repeat || m.shift || m.alt || m.ctrl || m.meta) return false;
    const { board } = ctx;
    const { width, height } = board.camera.viewport;
    if (board.readOnly || width <= 0 || height <= 0) return false;
    const center = board.camera.screenToBoard({ x: width / 2, y: height / 2 });
    place(ctx, center.x - options.defaultSize.w / 2, center.y - options.defaultSize.h / 2);
  }

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
        onKeyDown: placeAtCenter,
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
            const el = buildElement(board, options, { ...data.start, w: minW, h: minH });
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
            place(ctx, data.start.x, data.start.y);
          } else if (data.element) {
            board.select([data.element.id]);
            options.onCreated?.(data.element as unknown as ElementRecord<P>, ctx);
            afterCreate(ctx);
          }

          // Without `returnToSelect`, the tool stays active in idle until Esc (BOARD-913)
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
