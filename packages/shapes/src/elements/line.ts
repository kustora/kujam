/**
 * Polyline element definition (`type: 'line'`) with per-point editing (BOARD-1106).
 *
 * - Points are stored in element-local coordinates; the element box is their bounding box.
 * - Stroke color, width, dash, and arrowheads are the connector's (same props, same drawing).
 * - Point edits (drag, insert, delete) go through {@link moveLinePoint}, {@link insertLinePoint},
 *   and {@link removeLinePoint}, which re-normalize the box and bake any rotation into the points.
 */

import {
  array,
  defineElement,
  enumOf,
  localToBoard,
  number,
  object,
  polyline,
  schema,
  type ElementCanvasContext,
  type ElementContext,
  type ElementRecord,
  type Geometry,
  type Point,
} from '@kujam/core';
import { COLOR_KEYS, COLOR_VALUES, type ColorKey } from '../colors.js';
import { localize } from '../i18n.js';
import { GEO_STROKE_WIDTHS, lineActions } from '../styles.js';
import {
  ARROWHEAD_STYLES,
  CONNECTOR_DASH_PATTERNS,
  drawArrowhead,
  type ArrowheadStyle,
  type ConnectorDash,
} from './connector-routing.js';

/**
 * Most points one line may hold (BOARD-1106).
 *
 * @beta
 */
export const MAX_LINE_POINTS = 1000;

/**
 * Props for a `line` element (BOARD-1106).
 *
 * @beta
 */
export interface LineProps extends Record<string, unknown> {
  /** Points relative to `element.x` and `element.y`, in drawing order. At least 2 to be drawn. */
  points: Point[];
  color: ColorKey;
  strokeWidth: number;
  dash: ConnectorDash;
  startArrow: ArrowheadStyle;
  endArrow: ArrowheadStyle;
}

declare module '@kujam/core' {
  interface BoardElementTypes {
    line: LineProps;
  }
}

/**
 * Validation schema for {@link LineProps}.
 *
 * @beta
 */
export const linePropsSchema = schema({
  points: array(object({ x: number(), y: number() }), { maxLength: MAX_LINE_POINTS }),
  color: enumOf(COLOR_KEYS),
  strokeWidth: number({ min: 1, max: 32 }),
  dash: enumOf(['solid', 'dashed', 'dotted'] as const),
  startArrow: enumOf(ARROWHEAD_STYLES),
  endArrow: enumOf(ARROWHEAD_STYLES),
});

/** Box and local points of a line through `world` points (board coordinates). @internal */
export function normalizeLinePoints(world: readonly Point[]): {
  x: number;
  y: number;
  w: number;
  h: number;
  points: Point[];
} {
  if (world.length === 0) return { x: 0, y: 0, w: 0, h: 0, points: [] };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of world) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    points: world.map((p) => ({ x: p.x - minX, y: p.y - minY })),
  };
}

/** Points of a line in board coordinates, with its rotation applied. @internal */
export function lineWorldPoints(el: Readonly<ElementRecord<LineProps>>): Point[] {
  return el.props.points.map((p) => localToBoard(el, p));
}

/** `el` redrawn through `world` points: new box, local points, and no rotation. */
function withWorldPoints(
  el: Readonly<ElementRecord<LineProps>>,
  world: readonly Point[],
): ElementRecord<LineProps> {
  const box = normalizeLinePoints(world);
  return {
    ...el,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rotation: 0,
    props: { ...el.props, points: box.points },
  };
}

/** `el` with point `index` moved to `world` (board coordinates). @internal */
export function moveLinePoint(
  el: Readonly<ElementRecord<LineProps>>,
  index: number,
  world: Point,
): ElementRecord<LineProps> {
  const points = lineWorldPoints(el);
  if (index < 0 || index >= points.length) return { ...el };
  points[index] = { x: world.x, y: world.y };
  return withWorldPoints(el, points);
}

/**
 * `el` with a new point at `world` inserted before `index` (so it becomes point `index`), or
 * unchanged when the line is full. @internal
 */
export function insertLinePoint(
  el: Readonly<ElementRecord<LineProps>>,
  index: number,
  world: Point,
): ElementRecord<LineProps> {
  const points = lineWorldPoints(el);
  if (points.length >= MAX_LINE_POINTS || index < 0 || index > points.length) return { ...el };
  points.splice(index, 0, { x: world.x, y: world.y });
  return withWorldPoints(el, points);
}

/** `el` without point `index`, or `null` when a line would be left with fewer than 2 points. @internal */
export function removeLinePoint(
  el: Readonly<ElementRecord<LineProps>>,
  index: number,
): ElementRecord<LineProps> | null {
  const points = lineWorldPoints(el);
  if (points.length <= 2 || index < 0 || index >= points.length) return null;
  points.splice(index, 1);
  return withWorldPoints(el, points);
}

/**
 * Direction (radians) pointing into the end of `points` from the nearest distinct earlier point,
 * the angle convention of {@link drawArrowhead}.
 */
function endAngle(points: readonly Point[], fromEnd: boolean): number {
  const n = points.length;
  const tip = fromEnd ? points[n - 1]! : points[0]!;
  for (let k = 1; k < n; k++) {
    const other = fromEnd ? points[n - 1 - k]! : points[k]!;
    if (Math.hypot(tip.x - other.x, tip.y - other.y) > 1e-6) {
      return Math.atan2(tip.y - other.y, tip.x - other.x);
    }
  }
  return fromEnd ? 0 : Math.PI;
}

/** Hit-testing geometry of a `line`: the polyline with at least 8 board units of thickness. */
function lineGeometry(el: ElementRecord<LineProps>): Geometry {
  return polyline(el.props.points, Math.max(8, el.props.strokeWidth));
}

/**
 * Draws a `line` element in local coordinates: straight segments with the connector's dash and
 * arrowheads.
 */
function renderLineCanvas(
  g: ElementCanvasContext,
  el: ElementRecord<LineProps>,
  _data: undefined,
  _lod: unknown,
  ctx?: ElementContext,
): void {
  const { props } = el;
  const pts = props.points;
  if (pts.length < 2) return;
  const color = ctx?.theme?.colors[props.color] ?? COLOR_VALUES[props.color] ?? COLOR_VALUES.black;

  g.save();
  g.strokeStyle = color;
  g.lineWidth = props.strokeWidth;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.setLineDash(CONNECTOR_DASH_PATTERNS[props.dash].map((d) => d * props.strokeWidth));
  g.beginPath();
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
  g.stroke();
  g.setLineDash([]);

  drawArrowhead(g, props.startArrow, pts[0]!, endAngle(pts, false), props.strokeWidth, color);
  drawArrowhead(
    g,
    props.endArrow,
    pts[pts.length - 1]!,
    endAngle(pts, true),
    props.strokeWidth,
    color,
  );
  g.restore();
}

/**
 * Built-in `line` element: a polyline whose points can be edited one by one (BOARD-1106).
 *
 * @beta
 */
export const lineElement = defineElement({
  type: 'line',
  version: 1,
  props: linePropsSchema,
  defaults: {
    points: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ],
    color: 'black',
    strokeWidth: GEO_STROKE_WIDTHS.m,
    dash: 'solid',
    startArrow: 'none',
    endArrow: 'none',
  },
  geometry: lineGeometry,
  // Points are edited one by one; box resizing would not move them.
  resize: 'none',
  render: {
    canvas: renderLineCanvas,
  },
  a11y: (_el, _data, ctx) => ({
    role: 'graphics-symbol',
    label: localize({ id: 'Garis', en: 'Line' }, ctx.locale),
  }),
  actions: (el, _data, ctx) => lineActions(el, ctx),
  export: { text: () => '' },
});
