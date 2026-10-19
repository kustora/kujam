/**
 * Connector creation tool (`id: 'connector'`) (BOARD-1101b).
 *
 * - Hovering near a shape populates `ctx.data.connectorSnap` with the nearest cardinal anchor.
 * - Dragging from an anchor (or empty space) to another anchor (or empty space) updates
 *   `ctx.data.connectorPreview` and `ctx.data.connectorSnap`, then creates the connector
 *   and any `BindingRecord`s in a single transaction on pointer release.
 */

import {
  computeElementAABB,
  defineTool,
  indexAbove,
  type BindingRecord,
  type Board,
  type ElementRecord,
  type Point,
  type ToolContext,
  type ToolKeyEvent,
} from '@kujam/core';
import type { ColorKey } from '../colors.js';
import {
  computeConnectorRoute,
  findSnapAnchor,
  normalizeConnectorBounds,
  type ArrowheadStyle,
  type ConnectorDash,
  type ConnectorPreview,
  type ConnectorSnapTarget,
  type ConnectorStyle,
} from '../elements/connector-routing.js';
import { connectorElement, type ConnectorProps } from '../elements/connector.js';
import { GEO_STROKE_WIDTHS, rememberedProps } from '../styles.js';
import { handlePinch, handleWheel } from './navigation.js';

/** Default length when creating a connector by clicking or pressing Enter. @public */
export const DEFAULT_CONNECTOR_LENGTH = 160;

/** State names for {@link connectorTool}. @public */
export type ConnectorToolState = 'idle' | 'dragging';

/**
 * Overlay and interaction state for {@link connectorTool}, exposed via `board.toolData`.
 *
 * @public
 */
export interface ConnectorToolData {
  startPoint: Point;
  startSnap: ConnectorSnapTarget | null;
  connectorSnap?: ConnectorSnapTarget;
  connectorPreview?: ConnectorPreview;
}

type Ctx = ToolContext<ConnectorToolState, ConnectorToolData>;

function initialData(): ConnectorToolData {
  return {
    startPoint: { x: 0, y: 0 },
    startSnap: null,
  };
}

function highestIndex(board: Board): string | null {
  const elements = board.query();
  return elements.length > 0 ? (elements[elements.length - 1]?.index ?? null) : null;
}

function resolvePreviewStyle(ctx: Ctx): {
  style: ConnectorStyle;
  startArrow: ArrowheadStyle;
  endArrow: ArrowheadStyle;
  color: ColorKey;
  strokeWidth: number;
  dash: ConnectorDash;
} {
  const rem = rememberedProps(ctx.board, 'connector', 'connector');
  return {
    style: (rem.style as ConnectorStyle | undefined) ?? 'straight',
    startArrow: (rem.startArrow as ArrowheadStyle | undefined) ?? 'none',
    endArrow: (rem.endArrow as ArrowheadStyle | undefined) ?? 'arrow',
    color: (rem.color as ColorKey | undefined) ?? 'black',
    strokeWidth: (rem.strokeWidth as number | undefined) ?? GEO_STROKE_WIDTHS.m,
    dash: (rem.dash as ConnectorDash | undefined) ?? 'solid',
  };
}

function clearConnectorOverlay(ctx: Ctx): void {
  delete ctx.data.connectorPreview;
  delete ctx.data.connectorSnap;
  ctx.data.startSnap = null;
}

function buildConnectorElement(
  board: Board,
  id: string,
  bounds: { x: number; y: number; w: number; h: number; start: Point; end: Point },
  startBindingId: string | null,
  endBindingId: string | null,
): ElementRecord<ConnectorProps> {
  const def = board.elements.get('connector');
  const props = {
    ...connectorElement.defaults,
    ...(def?.defaults ?? {}),
    ...rememberedProps(board, 'connector', 'connector'),
    start: bounds.start,
    end: bounds.end,
    startBindingId,
    endBindingId,
  } as ConnectorProps;
  return {
    id,
    kind: 'element',
    type: 'connector',
    pageId: board.pages.current,
    parentId: null,
    index: indexAbove(highestIndex(board)),
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    rotation: 0,
    locked: false,
    opacity: 1,
    props,
    typeVersion: def?.version ?? 1,
    meta: {},
  };
}

function placeAtCenter(ctx: Ctx, e: ToolKeyEvent): false | void {
  const m = e.modifiers;
  if (e.key !== 'Enter' || e.repeat || m.shift || m.alt || m.ctrl || m.meta) return false;
  const { board } = ctx;
  const { width, height } = board.camera.viewport;
  if (board.readOnly || width <= 0 || height <= 0) return false;
  const center = board.camera.screenToBoard({ x: width / 2, y: height / 2 });
  const startWorld: Point = { x: center.x - DEFAULT_CONNECTOR_LENGTH / 2, y: center.y };
  const endWorld: Point = { x: center.x + DEFAULT_CONNECTOR_LENGTH / 2, y: center.y };
  const bounds = normalizeConnectorBounds(startWorld, endWorld);
  const el = buildConnectorElement(board, board.createId(), bounds, null, null);
  ctx.change((tx) => tx.put(el), { label: 'connector' });
  board.select([el.id]);
}

/**
 * Connector creation tool definition (`id: 'connector'`) (BOARD-1101b).
 *
 * @public
 */
export const connectorTool = defineTool<ConnectorToolState, ConnectorToolData>({
  id: 'connector',
  cursor: 'crosshair',
  initial: 'idle',
  data: initialData,
  states: {
    idle: {
      onPointerMove(ctx, e) {
        if (ctx.board.readOnly) return;
        const snap = findSnapAnchor(ctx.board, e.point);
        if (snap) {
          ctx.data.connectorSnap = snap;
        } else {
          delete ctx.data.connectorSnap;
        }
      },
      onPointerDown(ctx, e) {
        if (e.button !== 0 || ctx.board.readOnly) return;
        const startSnap = findSnapAnchor(ctx.board, e.point);
        const startPoint = startSnap ? startSnap.worldPoint : e.point;
        ctx.data.startPoint = startPoint;
        ctx.data.startSnap = startSnap;
        if (startSnap) {
          ctx.data.connectorSnap = startSnap;
        } else {
          delete ctx.data.connectorSnap;
        }
        return 'dragging';
      },
      onKeyDown: placeAtCenter,
      onWheel: (ctx, e) => handleWheel(ctx.board, e),
      onPinch: (ctx, e) => handlePinch(ctx.board, e),
    },
    dragging: {
      cursor: 'crosshair',
      onPointerMove(ctx, e) {
        const { data, board } = ctx;
        const endSnap = findSnapAnchor(board, e.point);
        if (endSnap) {
          data.connectorSnap = endSnap;
        } else {
          delete data.connectorSnap;
        }

        const endPoint = endSnap ? endSnap.worldPoint : e.point;
        const styles = resolvePreviewStyle(ctx);
        const startEl = data.startSnap ? board.getElement(data.startSnap.elementId) : undefined;
        const endEl = endSnap ? board.getElement(endSnap.elementId) : undefined;
        const route = computeConnectorRoute(data.startPoint, endPoint, styles.style, {
          startSide: data.startSnap?.side ?? null,
          endSide: endSnap?.side ?? null,
          startBounds: startEl ? computeElementAABB(startEl) : null,
          endBounds: endEl ? computeElementAABB(endEl) : null,
        });

        data.connectorPreview = {
          start: data.startPoint,
          end: endPoint,
          points: route.points,
          style: styles.style,
          startArrow: styles.startArrow,
          endArrow: styles.endArrow,
          color: styles.color,
          strokeWidth: styles.strokeWidth,
          dash: styles.dash,
        };
      },
      onPointerUp(ctx, e) {
        const { data, board } = ctx;
        const { startPoint, startSnap } = data;
        let endSnap = findSnapAnchor(board, e.point);
        let endPoint = endSnap ? endSnap.worldPoint : e.point;
        clearConnectorOverlay(ctx);

        const dist = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
        const sameAnchor =
          startSnap !== null &&
          endSnap !== null &&
          startSnap.elementId === endSnap.elementId &&
          startSnap.side === endSnap.side;

        if (dist < 4 && ((startSnap === null && endSnap === null) || sameAnchor)) {
          endSnap = null;
          endPoint = { x: startPoint.x + DEFAULT_CONNECTOR_LENGTH, y: startPoint.y };
        }

        const connId = board.createId();
        const startBindingId = startSnap ? board.createId() : null;
        const endBindingId = endSnap ? board.createId() : null;
        const bounds = normalizeConnectorBounds(startPoint, endPoint);
        const connEl = buildConnectorElement(board, connId, bounds, startBindingId, endBindingId);

        ctx.change(
          (tx) => {
            tx.put(connEl);
            if (startSnap && startBindingId) {
              const b: BindingRecord = {
                id: startBindingId,
                kind: 'binding',
                fromId: connId,
                toId: startSnap.elementId,
                anchor: startSnap.anchor,
              };
              tx.put(b);
            }
            if (endSnap && endBindingId) {
              const b: BindingRecord = {
                id: endBindingId,
                kind: 'binding',
                fromId: connId,
                toId: endSnap.elementId,
                anchor: endSnap.anchor,
              };
              tx.put(b);
            }
          },
          { label: 'connector' },
        );

        if (board.getElement(connId)) {
          board.select([connId]);
        }
        return 'idle';
      },
      onCancel(ctx) {
        clearConnectorOverlay(ctx);
        return 'idle';
      },
    },
  },
});
