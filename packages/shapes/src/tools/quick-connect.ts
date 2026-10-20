/**
 * Quick connect from the select tool: the dots outside each side of a lone selected connectable
 * element (drawn by the renderer from `quickConnectHandles`).
 *
 * - Dragging from a dot draws a connector bound to that side; releasing on another shape binds
 *   its end there too.
 * - Clicking a dot places a copy of the element on that side, connected to it.
 *
 * Both create everything in the select tool's interaction, so they are one undo step.
 */

import {
  computeElementAABB,
  indexAbove,
  QUICK_CONNECT_OFFSET_PX,
  quickConnectHandles,
  selectionFrame,
  type BindingRecord,
  type Board,
  type ElementRecord,
  type Point,
  type QuickConnectSide,
  type Transaction,
} from '@kujam/core';
import {
  CARDINAL_ANCHORS,
  CARDINAL_SIDES,
  computeConnectorRoute,
  findSnapAnchor,
  normalizeConnectorBounds,
  resolveAnchorSide,
  resolveAnchorWorldPoint,
  type ConnectorPreview,
  type ConnectorSnapTarget,
} from '../elements/connector-routing.js';
import { EMPTY_RICH_TEXT } from '../richtext.js';
import { buildConnectorElement, resolvePreviewStyle } from './connector.js';

/** Screen distance within which a quick-connect dot is grabbed. */
const QUICK_CONNECT_TOLERANCE_PX = 10;
/** Gap between an element and the copy a click places next to it, in board units. */
export const QUICK_CONNECT_GAP = 80;

const OPPOSITE: Readonly<Record<QuickConnectSide, QuickConnectSide>> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
};

/** A quick-connect dot pressed on an element. */
export interface QuickConnectTarget {
  readonly elementId: string;
  readonly side: QuickConnectSide;
}

/** Snap feedback in the shape the overlay draws: the snapped point and the target's anchors. */
export interface QuickConnectSnapOverlay extends ConnectorSnapTarget {
  readonly point: Point;
  readonly candidates: readonly Point[];
}

/** The lone selected element that shows quick-connect dots, if any. */
function connectableSelection(board: Board): Readonly<ElementRecord> | null {
  if (board.readOnly || board.selection.length !== 1) return null;
  const el = board.getElement(board.selection[0]!);
  if (!el || el.locked || !board.can('update', el)) return null;
  return board.elements.get(el.type)?.connectable ? el : null;
}

/** The quick-connect dot under `screen`, if any. */
export function quickConnectAt(board: Board, screen: Point): QuickConnectTarget | null {
  const el = connectableSelection(board);
  if (!el) return null;
  const frame = selectionFrame([el], { registry: board.elements });
  if (!frame) return null;
  const zoom = board.camera.get().zoom;
  let best: QuickConnectTarget | null = null;
  let bestDistance = QUICK_CONNECT_TOLERANCE_PX;
  for (const handle of quickConnectHandles(frame, QUICK_CONNECT_OFFSET_PX / zoom)) {
    const s = board.camera.boardToScreen(handle);
    const d = Math.hypot(s.x - screen.x, s.y - screen.y);
    if (d <= bestDistance) {
      bestDistance = d;
      best = { elementId: el.id, side: handle.side };
    }
  }
  return best;
}

/** The anchor of `side` of `el`, as a connector snap target. */
function sideAnchor(el: Readonly<ElementRecord>, side: QuickConnectSide): ConnectorSnapTarget {
  const anchor = CARDINAL_ANCHORS[side];
  return {
    elementId: el.id,
    anchor,
    side: resolveAnchorSide(anchor, el.rotation),
    worldPoint: resolveAnchorWorldPoint(el, anchor),
  };
}

function snapOverlay(board: Board, snap: ConnectorSnapTarget): QuickConnectSnapOverlay {
  const target = board.getElement(snap.elementId);
  return {
    ...snap,
    point: snap.worldPoint,
    candidates: target
      ? CARDINAL_SIDES.map((side) => resolveAnchorWorldPoint(target, CARDINAL_ANCHORS[side]))
      : [],
  };
}

/** Preview of the connector dragged from `from` to `point`, and the shape it would bind to. */
export function quickConnectPreview(
  board: Board,
  from: QuickConnectTarget,
  point: Point,
): { preview: ConnectorPreview; snap: QuickConnectSnapOverlay | null } | null {
  const source = board.getElement(from.elementId);
  if (!source) return null;
  const start = sideAnchor(source, from.side);
  const endSnap = findSnapAnchor(board, point, new Set([source.id]));
  const end = endSnap ? endSnap.worldPoint : point;
  const target = endSnap ? board.getElement(endSnap.elementId) : undefined;
  const styles = resolvePreviewStyle({ board });
  const route = computeConnectorRoute(start.worldPoint, end, styles.style, {
    startSide: start.side,
    endSide: endSnap?.side ?? null,
    startBounds: computeElementAABB(source),
    endBounds: target ? computeElementAABB(target) : null,
  });
  return {
    preview: { start: start.worldPoint, end, points: route.points, ...styles },
    snap: endSnap ? snapOverlay(board, endSnap) : null,
  };
}

/** Writes a connector from `start` to `end` (bound where a snap target is given) into `tx`. */
function putConnector(
  board: Board,
  tx: Transaction,
  start: ConnectorSnapTarget,
  end: ConnectorSnapTarget | Point,
): string {
  const endSnap = 'elementId' in end ? end : null;
  const endPoint = endSnap ? endSnap.worldPoint : (end as Point);
  const id = board.createId();
  const startBindingId = board.createId();
  const endBindingId = endSnap ? board.createId() : null;
  const bounds = normalizeConnectorBounds(start.worldPoint, endPoint);
  tx.put(buildConnectorElement(board, id, bounds, startBindingId, endBindingId));
  const binding = (bindingId: string, snap: ConnectorSnapTarget): BindingRecord => ({
    id: bindingId,
    kind: 'binding',
    fromId: id,
    toId: snap.elementId,
    anchor: snap.anchor,
  });
  tx.put(binding(startBindingId, start));
  if (endSnap && endBindingId) tx.put(binding(endBindingId, endSnap));
  return id;
}

/** Text props a copy starts without: a copied sticky or shape starts empty, ready to type in. */
function clearedText(props: Record<string, unknown>, type: string): Record<string, unknown> {
  if (type === 'sticky' && 'text' in props) return { ...props, text: EMPTY_RICH_TEXT };
  if (type === 'geo' && 'label' in props) return { ...props, label: EMPTY_RICH_TEXT };
  return props;
}

/** A copy of `source` placed `QUICK_CONNECT_GAP` away on `side`, in the element's rotated frame. */
function placedCopy(
  board: Board,
  source: Readonly<ElementRecord>,
  side: QuickConnectSide,
): ElementRecord {
  const step =
    side === 'left' || side === 'right'
      ? source.w + QUICK_CONNECT_GAP
      : source.h + QUICK_CONNECT_GAP;
  const local = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side];
  const rad = ((source.rotation ?? 0) * Math.PI) / 180;
  const dx = (local[0]! * Math.cos(rad) - local[1]! * Math.sin(rad)) * step;
  const dy = (local[0]! * Math.sin(rad) + local[1]! * Math.cos(rad)) * step;
  const siblings = board.query({ pageId: source.pageId, parentId: source.parentId });
  const top = siblings.length > 0 ? siblings[siblings.length - 1]!.index : null;
  return {
    ...source,
    id: board.createId(),
    index: indexAbove(top),
    x: source.x + dx,
    y: source.y + dy,
    locked: false,
    props: clearedText(source.props as Record<string, unknown>, source.type),
    meta: {},
  };
}

/**
 * Finishes a quick connect. A drag (`point` given) creates a connector to the shape under `point`
 * or to `point` itself and selects it; a click places a connected copy and selects the copy.
 */
export function finishQuickConnect(
  board: Board,
  change: (fn: (tx: Transaction) => void) => void,
  from: QuickConnectTarget,
  point: Point | null,
): void {
  const source = board.getElement(from.elementId);
  if (!source) return;
  const start = sideAnchor(source, from.side);

  if (point) {
    const endSnap = findSnapAnchor(board, point, new Set([source.id]));
    let connectorId = '';
    change((tx) => {
      connectorId = putConnector(board, tx, start, endSnap ?? point);
    });
    if (board.getElement(connectorId)) board.select([connectorId]);
    return;
  }

  const copy = placedCopy(board, source, from.side);
  if (!board.can('create', copy)) return;
  change((tx) => {
    tx.put(copy);
    const end = sideAnchor(copy, OPPOSITE[from.side]);
    putConnector(board, tx, start, end);
  });
  if (board.getElement(copy.id)) board.select([copy.id]);
}
