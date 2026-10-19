/**
 * Connector element definition (`type: 'connector'`) (BOARD-1101, BOARD-1102).
 *
 * - 1101a: `straight`, `elbow`, and `curved` routing styles with stroke color, width, and dash.
 * - 1101b: Endpoint binding (`startBindingId`, `endBindingId`) to shape anchors via `BindingRecord`.
 * - 1101c: Configurable `startArrow` and `endArrow` (`none`, `arrow`, `triangle`, `dot`, `diamond`).
 * - 1101d: Optional centered rich-text `label` pill at the connector midpoint; double-click edits.
 * - 1102: Simple obstacle-avoiding orthogonal elbow routing.
 */

import {
  computeElementAABB,
  defineElement,
  enumOf,
  nullable,
  number,
  object,
  polyline,
  schema,
  string,
  type Board,
  type BoxBounds,
  type ElementCanvasContext,
  type ElementContext,
  type ElementRecord,
  type Geometry,
  type Point,
} from '@kujam/core';
import { drawRichText, layoutRichText, traceRoundedRect } from '../canvas.js';
import { COLOR_KEYS, COLOR_VALUES, type ColorKey } from '../colors.js';
import { a11yLabel, localize } from '../i18n.js';
import {
  EMPTY_RICH_TEXT,
  isRichTextEmpty,
  richTextSchema,
  richTextToPlainText,
  type RichText,
} from '../richtext.js';
import { connectorActions, GEO_STROKE_WIDTHS } from '../styles.js';
import {
  ARROWHEAD_STYLES,
  computeConnectorRoute,
  CONNECTOR_STYLES,
  drawArrowhead,
  resolveAnchorSide,
  type AnchorSide,
  type ArrowheadStyle,
  type ConnectorDash,
  type ConnectorRouteOptions,
  type ConnectorRouteResult,
  type ConnectorStyle,
} from './connector-routing.js';

/**
 * Props for a `connector` element (BOARD-1101).
 *
 * @public
 */
export interface ConnectorProps extends Record<string, unknown> {
  startBindingId: string | null;
  endBindingId: string | null;
  /** Start point relative to `element.x` and `element.y`. */
  start: Point;
  /** End point relative to `element.x` and `element.y`. */
  end: Point;
  style: ConnectorStyle;
  startArrow: ArrowheadStyle;
  endArrow: ArrowheadStyle;
  color: ColorKey;
  strokeWidth: number;
  dash: ConnectorDash;
  label: RichText;
}

declare module '@kujam/core' {
  interface BoardElementTypes {
    connector: ConnectorProps;
  }
}

const pointSchema = object({
  x: number(),
  y: number(),
});

/**
 * Validation schema for {@link ConnectorProps}.
 *
 * @public
 */
export const connectorPropsSchema = schema({
  startBindingId: nullable(string({ maxLength: 256 })),
  endBindingId: nullable(string({ maxLength: 256 })),
  start: pointSchema,
  end: pointSchema,
  style: enumOf(CONNECTOR_STYLES),
  startArrow: enumOf(ARROWHEAD_STYLES),
  endArrow: enumOf(ARROWHEAD_STYLES),
  color: enumOf(COLOR_KEYS),
  strokeWidth: number({ min: 1, max: 32 }),
  dash: enumOf(['solid', 'dashed', 'dotted'] as const),
  label: richTextSchema,
});

const activeBoards = new Set<Board>();

/**
 * Registers a {@link Board} instance so connector geometry and rendering can resolve bound target
 * anchor sides and nearby obstacle boxes on the same page.
 *
 * @internal
 */
export function registerConnectorBoard(board: Board): () => void {
  activeBoards.add(board);
  return () => {
    activeBoards.delete(board);
  };
}

function findBoardForElement(element: ElementRecord): Board | undefined {
  for (const board of activeBoards) {
    if (board.disposed) continue;
    const records = board.getDocument().records;
    if (Object.hasOwn(records, element.id)) return board;
  }
  for (const board of activeBoards) {
    if (board.disposed) continue;
    const records = board.getDocument().records;
    if (Object.hasOwn(records, element.pageId)) return board;
  }
  return undefined;
}

/**
 * Resolves routing options (bound start/end anchor sides, target bounds, and intermediate obstacles)
 * for `element` using its owning board when available.
 *
 * @public
 */
export function resolveConnectorRouteOptions(
  element: ElementRecord<ConnectorProps>,
  board?: Board,
): ConnectorRouteOptions {
  const host = board ?? findBoardForElement(element);
  if (!host) return {};

  const records = host.getDocument().records;
  let startSide: AnchorSide | null = null;
  let endSide: AnchorSide | null = null;
  let startBounds: BoxBounds | null = null;
  let endBounds: BoxBounds | null = null;
  let startTargetId: string | null = null;
  let endTargetId: string | null = null;

  const startBId = element.props.startBindingId;
  if (typeof startBId === 'string') {
    const b = records[startBId];
    if (b && b.kind === 'binding') {
      const target = records[b.toId];
      if (target && target.kind === 'element') {
        startTargetId = target.id;
        startSide = resolveAnchorSide(b.anchor, target.rotation);
        startBounds = computeElementAABB(target);
      }
    }
  }

  const endBId = element.props.endBindingId;
  if (typeof endBId === 'string') {
    const b = records[endBId];
    if (b && b.kind === 'binding') {
      const target = records[b.toId];
      if (target && target.kind === 'element') {
        endTargetId = target.id;
        endSide = resolveAnchorSide(b.anchor, target.rotation);
        endBounds = computeElementAABB(target);
      }
    }
  }

  const obstacles: BoxBounds[] = [];
  if (element.props.style === 'elbow') {
    const startWorld: Point = {
      x: element.x + element.props.start.x,
      y: element.y + element.props.start.y,
    };
    const endWorld: Point = {
      x: element.x + element.props.end.x,
      y: element.y + element.props.end.y,
    };
    const pad = 96;
    const searchMinX = Math.min(startWorld.x, endWorld.x) - pad;
    const searchMinY = Math.min(startWorld.y, endWorld.y) - pad;
    const searchMaxX = Math.max(startWorld.x, endWorld.x) + pad;
    const searchMaxY = Math.max(startWorld.y, endWorld.y) + pad;

    for (const rec of Object.values(records)) {
      if (
        rec.kind !== 'element' ||
        rec.pageId !== element.pageId ||
        rec.id === element.id ||
        rec.id === startTargetId ||
        rec.id === endTargetId ||
        rec.type === 'connector' ||
        rec.type === 'draw'
      ) {
        continue;
      }
      const box = computeElementAABB(rec);
      if (
        box.maxX >= searchMinX &&
        box.minX <= searchMaxX &&
        box.maxY >= searchMinY &&
        box.minY <= searchMaxY
      ) {
        obstacles.push(box);
      }
    }
  }

  return {
    startSide,
    endSide,
    startBounds,
    endBounds,
    obstacles,
  };
}

/**
 * Computes the connector route in element-local coordinates (relative to `element.x, element.y`).
 *
 * @public
 */
export function computeElementConnectorRoute(
  element: ElementRecord<ConnectorProps>,
  board?: Board,
): ConnectorRouteResult {
  const startWorld: Point = {
    x: element.x + element.props.start.x,
    y: element.y + element.props.start.y,
  };
  const endWorld: Point = {
    x: element.x + element.props.end.x,
    y: element.y + element.props.end.y,
  };
  const options = resolveConnectorRouteOptions(element, board);
  const worldRoute = computeConnectorRoute(startWorld, endWorld, element.props.style, options);

  const toLocal = (p: Point): Point => ({
    x: p.x - element.x,
    y: p.y - element.y,
  });

  return {
    points: worldRoute.points.map(toLocal),
    ...(worldRoute.controlPoints
      ? {
          controlPoints: [
            toLocal(worldRoute.controlPoints[0]),
            toLocal(worldRoute.controlPoints[1]),
          ] as const,
        }
      : {}),
    midpoint: toLocal(worldRoute.midpoint),
    startAngle: worldRoute.startAngle,
    endAngle: worldRoute.endAngle,
  };
}

/**
 * Computes the geometry of a `connector` element in local coordinates for hit-testing and AABB.
 *
 * @public
 */
export function computeConnectorGeometry(element: ElementRecord<ConnectorProps>): Geometry {
  const route = computeElementConnectorRoute(element);
  return polyline(route.points, Math.max(8, element.props.strokeWidth));
}

const DASHES: Readonly<Record<ConnectorDash, readonly number[]>> = {
  solid: [],
  dashed: [4, 4],
  dotted: [1, 3],
};

/**
 * Renders a `connector` element onto a 2D canvas context in local coordinates.
 *
 * @public
 */
export function renderConnectorCanvas(
  g: ElementCanvasContext,
  element: ElementRecord<ConnectorProps>,
  _data: undefined,
  _lod: unknown,
  ctx?: ElementContext,
): void {
  const { props } = element;
  const route = computeElementConnectorRoute(element);
  const pts = route.points;
  if (pts.length < 2) return;

  const strokeColor =
    ctx?.theme?.colors[props.color] ?? COLOR_VALUES[props.color] ?? COLOR_VALUES.black;

  g.save();
  g.strokeStyle = strokeColor;
  g.lineWidth = props.strokeWidth;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.setLineDash(DASHES[props.dash].map((d) => d * props.strokeWidth));

  g.beginPath();
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  g.moveTo(first.x, first.y);

  if (props.style === 'curved' && route.controlPoints) {
    const [c1, c2] = route.controlPoints;
    g.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, last.x, last.y);
  } else {
    for (let i = 1; i < pts.length; i++) {
      g.lineTo(pts[i]!.x, pts[i]!.y);
    }
  }
  g.stroke();
  g.setLineDash([]);

  // Draw arrowheads at start and end
  drawArrowhead(g, props.startArrow, first, route.startAngle, props.strokeWidth, strokeColor);
  drawArrowhead(g, props.endArrow, last, route.endAngle, props.strokeWidth, strokeColor);

  // Draw centered label pill at midpoint when label is non-empty (BOARD-1101d)
  if (!isRichTextEmpty(props.label)) {
    const fontFamily = ctx?.theme?.typography.fontFamily;
    const fontSize = 14;
    const maxPillWidth = 180;
    const padX = 8;
    const padY = 4;

    const layout = layoutRichText(props.label, {
      maxWidth: maxPillWidth,
      align: 'center',
      fontSize,
      fontFamily,
    });
    const textW = Math.max(20, Math.min(maxPillWidth, layout.width || 40));
    const textH = Math.max(fontSize * 1.3, layout.height);
    const pillW = textW + padX * 2;
    const pillH = textH + padY * 2;
    const pillX = route.midpoint.x - pillW / 2;
    const pillY = route.midpoint.y - pillH / 2;

    g.save();
    g.translate(pillX, pillY);
    traceRoundedRect(g, pillW, pillH, 6);
    g.fillStyle = ctx?.theme?.canvas.background ?? '#FFFFFF';
    g.fill();
    g.strokeStyle = strokeColor;
    g.lineWidth = 1;
    g.stroke();
    g.restore();

    drawRichText(g, layout, {
      x: pillX + padX,
      y: pillY + padY,
      color: strokeColor,
      fontFamily,
    });
  }

  g.restore();
}

/**
 * Built-in `connector` element definition (BOARD-1101, BOARD-1102).
 *
 * @public
 */
export const connectorElement = defineElement({
  type: 'connector',
  version: 1,
  props: connectorPropsSchema,
  defaults: {
    startBindingId: null,
    endBindingId: null,
    start: { x: 0, y: 0 },
    end: { x: 120, y: 0 },
    style: 'straight',
    startArrow: 'none',
    endArrow: 'arrow',
    color: 'black',
    strokeWidth: GEO_STROKE_WIDTHS.m,
    dash: 'solid',
    label: EMPTY_RICH_TEXT,
  },
  geometry: computeConnectorGeometry,
  onDoubleClick(el, ctx) {
    ctx.emit('edit', { id: el.id });
  },
  render: {
    canvas: renderConnectorCanvas,
  },
  a11y(el, _data, ctx) {
    const kind = localize({ id: 'Garis penghubung', en: 'Connector' }, ctx.locale);
    return {
      role: 'graphics-symbol',
      label: a11yLabel(kind, richTextToPlainText(el.props.label)),
    };
  },
  actions: (el, _data, ctx) => connectorActions(el, ctx),
  export: {
    text: (el) => richTextToPlainText(el.props.label),
  },
});
