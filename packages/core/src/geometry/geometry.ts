/**
 * Geometry primitives and the geometry library (BOARD-601, BOARD-403).
 *
 * Geometry shapes are local to the element: point `(0, 0)` is the element's top-left corner
 * before rotation, in board units. Every operation works in local coordinates by default; pass an
 * {@link ElementTransform} (usually the element record itself) to work in board coordinates
 * instead, with the element's translation and rotation applied.
 *
 * Ellipse outlines are approximated by a {@link ELLIPSE_SEGMENTS}-sided inscribed polygon for edge
 * distance, intersection, and snapping (radial error below 0.13%); point containment and bounds
 * are exact.
 */

import type { BoxBounds } from './spatial.js';

// ---------- Primitives ----------

/**
 * Two-dimensional point in board units.
 *
 * @beta
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Axis-aligned box, in element-local coordinates.
 *
 * @beta
 */
export interface RectGeometry {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Ellipse filling the `x, y, w, h` box, in element-local coordinates.
 *
 * @beta
 */
export interface EllipseGeometry {
  readonly kind: 'ellipse';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Closed polygon (the last point connects to the first), in element-local coordinates.
 *
 * @beta
 */
export interface PolygonGeometry {
  readonly kind: 'polygon';
  readonly points: readonly Point[];
}

/**
 * Open polyline, for example a stroke or a line. `width` is the line thickness for hit-testing.
 *
 * @beta
 */
export interface PolylineGeometry {
  readonly kind: 'polyline';
  readonly points: readonly Point[];
  readonly width: number;
}

/**
 * Freehand path built from stroke points (BOARD-403), in element-local coordinates. `width` is
 * the stroke thickness; a `closed` path also counts its enclosed area as part of the shape.
 * Unlike {@link PolylineGeometry}, snapping only uses the path's endpoints and center, since a
 * stroke has many points.
 *
 * @beta
 */
export interface PathGeometry {
  readonly kind: 'path';
  readonly points: readonly Point[];
  readonly width: number;
  readonly closed: boolean;
}

/**
 * Element geometry for hit-testing, snapping, and selection. Returned by `geometry` in
 * `defineElement`.
 *
 * @beta
 */
export type Geometry =
  RectGeometry | EllipseGeometry | PolygonGeometry | PolylineGeometry | PathGeometry;

/**
 * A box from the element's top-left corner, or from point `(x, y)` when given.
 *
 * @example
 * ```ts
 * geometry: (el) => rect(el.w, el.h),
 * ```
 *
 * @beta
 */
export function rect(w: number, h: number, x = 0, y = 0): RectGeometry {
  return { kind: 'rect', x, y, w, h };
}

/**
 * Ellipse filling a `w × h` box from the element's top-left corner, or from point `(x, y)`.
 *
 * @beta
 */
export function ellipse(w: number, h: number, x = 0, y = 0): EllipseGeometry {
  return { kind: 'ellipse', x, y, w, h };
}

/**
 * Closed polygon from a list of points.
 *
 * @beta
 */
export function polygon(points: readonly Point[]): PolygonGeometry {
  return { kind: 'polygon', points };
}

/**
 * Open polyline from a list of points, with a line thickness for hit-testing (defaults to 0).
 *
 * @beta
 */
export function polyline(points: readonly Point[], width = 0): PolylineGeometry {
  return { kind: 'polyline', points, width };
}

/**
 * Stroke point accepted by {@link path}: a point object, or a stroke tuple `[x, y, pressure?]`
 * as stored by freehand elements. Missing coordinates count as `0`; pressure is ignored.
 *
 * @beta
 */
export type StrokePoint = Point | readonly number[];

/**
 * Freehand path from stroke points, with a stroke thickness (defaults to 0).
 *
 * @example
 * ```ts
 * geometry: (el) => path(el.props.points, el.props.thickness),
 * ```
 *
 * @beta
 */
export function path(points: readonly StrokePoint[], width = 0, closed = false): PathGeometry {
  return {
    kind: 'path',
    points: points.map((p) => ('x' in p ? { x: p.x, y: p.y } : { x: p[0] ?? 0, y: p[1] ?? 0 })),
    width,
    closed,
  };
}

/** Whether a value is a known shape with an extent of its own (a non-empty point list). */
function isUsableGeometry(value: unknown): value is Geometry {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Geometry;
  switch (g.kind) {
    case 'rect':
    case 'ellipse':
      return true;
    case 'polygon':
    case 'polyline':
    case 'path':
      return Array.isArray(g.points) && g.points.length > 0;
    default:
      return false;
  }
}

/**
 * Geometry an element is tested and indexed with: the result of `compute` (usually the element
 * definition's `geometry`), or the element's `w × h` box when `compute` is missing, throws, or
 * returns something that is not a usable geometry (unknown `kind`, empty point list).
 *
 * @internal
 */
export function resolveElementGeometry(
  element: ElementTransform,
  compute?: () => unknown,
): Geometry {
  try {
    const geometry = compute?.();
    if (isUsableGeometry(geometry)) return geometry;
  } catch {
    // A throwing geometry function falls back to the element box.
  }
  return rect(element.w, element.h);
}

// ---------- Transforms ----------

/**
 * Placement of an element in board coordinates: its translation, size (the rotation center is
 * the middle of the `w × h` box), and rotation in degrees clockwise. Element records satisfy this
 * interface directly.
 *
 * @beta
 */
export interface ElementTransform {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rotation?: number;
}

/**
 * Rotates `point` around `center` by `degrees` (clockwise in screen coordinates, where y points
 * down).
 *
 * @beta
 */
export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  // Whole turns are exact no-ops (trigonometry would add floating-point noise).
  if (degrees % 360 === 0) return { x: point.x, y: point.y };
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

function centerOf(t: ElementTransform): Point {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
}

/**
 * Converts an element-local point to board coordinates.
 *
 * @beta
 */
export function localToBoard(element: ElementTransform, point: Point): Point {
  return rotatePoint(
    { x: element.x + point.x, y: element.y + point.y },
    centerOf(element),
    element.rotation ?? 0,
  );
}

/**
 * Converts a board point to element-local coordinates (the inverse of {@link localToBoard}).
 *
 * @beta
 */
export function boardToLocal(element: ElementTransform, point: Point): Point {
  const p = rotatePoint(point, centerOf(element), -(element.rotation ?? 0));
  return { x: p.x - element.x, y: p.y - element.y };
}

/**
 * Converts a hit-test tolerance in screen pixels to board units at the given camera zoom.
 *
 * @throws `RangeError` when `zoom` is not a positive finite number.
 * @beta
 */
export function toBoardTolerance(pixels: number, zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) {
    throw new RangeError('zoom wajib berupa angka positif berhingga.');
  }
  return Math.max(0, pixels) / zoom;
}

// ---------- Outlines (internal) ----------

/**
 * Number of segments of the polygon that approximates an ellipse outline.
 *
 * @beta
 */
export const ELLIPSE_SEGMENTS = 64;

/** Shape outline in local coordinates: a filled ring, or an open line with a half thickness. */
interface Outline {
  readonly points: readonly Point[];
  readonly closed: boolean;
  readonly halfWidth: number;
}

function boxCorners(x: number, y: number, w: number, h: number): Point[] {
  const x1 = Math.min(x, x + w);
  const x2 = Math.max(x, x + w);
  const y1 = Math.min(y, y + h);
  const y2 = Math.max(y, y + h);
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

function outlineOf(g: Geometry): Outline {
  switch (g.kind) {
    case 'rect':
      return { points: boxCorners(g.x, g.y, g.w, g.h), closed: true, halfWidth: 0 };
    case 'ellipse': {
      const cx = g.x + g.w / 2;
      const cy = g.y + g.h / 2;
      const points: Point[] = [];
      for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
        const a = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
        points.push({ x: cx + (Math.cos(a) * g.w) / 2, y: cy + (Math.sin(a) * g.h) / 2 });
      }
      return { points, closed: true, halfWidth: 0 };
    }
    case 'polygon':
      return { points: g.points, closed: true, halfWidth: 0 };
    case 'polyline':
      return { points: g.points, closed: false, halfWidth: Math.abs(g.width) / 2 };
    case 'path':
      return { points: g.points, closed: g.closed, halfWidth: Math.abs(g.width) / 2 };
  }
}

/** Segments of an outline; a single point counts as one zero-length segment. */
function segmentsOf(points: readonly Point[], closed: boolean): [Point, Point][] {
  if (points.length === 1) return [[points[0]!, points[0]!]];
  const out: [Point, Point][] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  if (closed && points.length > 2) out.push([points[points.length - 1]!, points[0]!]);
  return out;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    (d1 === 0 && onSegment(a, c, d)) ||
    (d2 === 0 && onSegment(b, c, d)) ||
    (d3 === 0 && onSegment(c, a, b)) ||
    (d4 === 0 && onSegment(d, a, b))
  );
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

/** Even-odd point-in-polygon test; points on the boundary may land on either side. */
function insideRing(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function edgeDistance(outline: Outline, p: Point): number {
  let min = Infinity;
  for (const [a, b] of segmentsOf(outline.points, outline.closed)) {
    min = Math.min(min, distanceToSegment(p, a, b));
  }
  return min;
}

/** Whether a local point is inside the filled area of a geometry (exact for ellipses). */
function insideArea(g: Geometry, outline: Outline, p: Point): boolean {
  if (g.kind === 'ellipse') {
    const rx = Math.abs(g.w) / 2;
    const ry = Math.abs(g.h) / 2;
    if (rx === 0 || ry === 0) return false;
    const nx = (p.x - (g.x + g.w / 2)) / rx;
    const ny = (p.y - (g.y + g.h / 2)) / ry;
    return nx * nx + ny * ny <= 1;
  }
  return outline.closed && outline.points.length > 2 && insideRing(p, outline.points);
}

function toLocalPoints(points: readonly Point[], element: ElementTransform | undefined): Point[] {
  return element ? points.map((p) => boardToLocal(element, p)) : [...points];
}

function boxBounds(minX: number, minY: number, maxX: number, maxY: number): BoxBounds {
  return { minX, minY, maxX, maxY };
}

function normalizeBox(box: BoxBounds): BoxBounds {
  return boxBounds(
    Math.min(box.minX, box.maxX),
    Math.min(box.minY, box.maxY),
    Math.max(box.minX, box.maxX),
    Math.max(box.minY, box.maxY),
  );
}

// ---------- Operations ----------

/**
 * Axis-aligned bounds of a geometry, including half the stroke thickness of lines and paths.
 * In local coordinates, or in board coordinates (accounting for rotation) when `element` is
 * given. Exact for ellipses. A geometry without points has zero-size bounds at the local origin.
 *
 * @beta
 */
export function geometryBounds(geometry: Geometry, element?: ElementTransform): BoxBounds {
  const rotation = element?.rotation ?? 0;
  if (geometry.kind === 'ellipse' && element && rotation % 360 !== 0) {
    const rx = Math.abs(geometry.w) / 2;
    const ry = Math.abs(geometry.h) / 2;
    const c = localToBoard(element, {
      x: geometry.x + geometry.w / 2,
      y: geometry.y + geometry.h / 2,
    });
    const rad = (rotation * Math.PI) / 180;
    const ex = Math.hypot(rx * Math.cos(rad), ry * Math.sin(rad));
    const ey = Math.hypot(rx * Math.sin(rad), ry * Math.cos(rad));
    return boxBounds(c.x - ex, c.y - ey, c.x + ex, c.y + ey);
  }

  const outline =
    geometry.kind === 'ellipse'
      ? { points: boxCorners(geometry.x, geometry.y, geometry.w, geometry.h), halfWidth: 0 }
      : outlineOf(geometry);
  const points = outline.points.length > 0 ? outline.points : [{ x: 0, y: 0 }];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const local of points) {
    const p = element ? localToBoard(element, local) : local;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = outline.points.length > 0 ? outline.halfWidth : 0;
  return boxBounds(minX - pad, minY - pad, maxX + pad, maxY + pad);
}

/**
 * Shortest distance from `point` to the outline of a geometry: the edge of closed shapes, or the
 * center line of lines and paths (stroke thickness not subtracted). `point` is in board
 * coordinates when `element` is given, otherwise local. `Infinity` for a geometry without points.
 *
 * @beta
 */
export function distanceToEdge(
  geometry: Geometry,
  point: Point,
  element?: ElementTransform,
): number {
  const local = element ? boardToLocal(element, point) : point;
  return edgeDistance(outlineOf(geometry), local);
}

/**
 * Options for {@link containsPoint}.
 *
 * @beta
 */
export interface ContainsPointOptions {
  /** Interpret `point` in board coordinates for this element. */
  readonly element?: ElementTransform;
  /** Extra distance around the shape that still counts as a hit, in board units. Defaults to 0. */
  readonly tolerance?: number;
}

/**
 * Whether `point` hits a geometry: inside a closed shape, or within half the stroke thickness of a
 * line or path, plus `tolerance`. Use {@link toBoardTolerance} to convert screen pixels.
 *
 * @beta
 */
export function containsPoint(
  geometry: Geometry,
  point: Point,
  options: ContainsPointOptions = {},
): boolean {
  const local = options.element ? boardToLocal(options.element, point) : point;
  const outline = outlineOf(geometry);
  if (insideArea(geometry, outline, local)) return true;
  const tolerance = Math.max(0, options.tolerance ?? 0);
  return edgeDistance(outline, local) <= outline.halfWidth + tolerance;
}

/**
 * Whether a geometry overlaps the polygon `area` (for example a lasso), touching included. `area`
 * is in board coordinates when `element` is given, otherwise local. An area with fewer than three
 * points behaves like a line.
 *
 * @beta
 */
export function intersectsPolygon(
  geometry: Geometry,
  area: readonly Point[],
  element?: ElementTransform,
): boolean {
  const outline = outlineOf(geometry);
  const ring = toLocalPoints(area, element);
  if (outline.points.length === 0 || ring.length === 0) return false;

  // The shape lies (partly) inside the area.
  if (ring.length > 2 && insideRing(outline.points[0]!, ring)) return true;
  // The area lies (partly) inside the shape.
  if (insideArea(geometry, outline, ring[0]!)) return true;
  // The boundaries cross or come within the stroke's half thickness.
  for (const [a, b] of segmentsOf(outline.points, outline.closed)) {
    for (const [c, d] of segmentsOf(ring, true)) {
      if (segmentDistance(a, b, c, d) <= outline.halfWidth) return true;
    }
  }
  return false;
}

/**
 * Whether a geometry overlaps `box`, touching included. `box` is axis-aligned in board
 * coordinates when `element` is given, otherwise in local coordinates.
 *
 * @beta
 */
export function intersectsBox(
  geometry: Geometry,
  box: BoxBounds,
  element?: ElementTransform,
): boolean {
  const b = normalizeBox(box);
  return intersectsPolygon(
    geometry,
    boxCorners(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY),
    element,
  );
}

/**
 * Whether a geometry, including its stroke thickness, lies entirely inside `box` (for example
 * marquee selection). `box` is axis-aligned in board coordinates when `element` is given,
 * otherwise in local coordinates. A geometry without points is never contained.
 *
 * @beta
 */
export function containedInBox(
  geometry: Geometry,
  box: BoxBounds,
  element?: ElementTransform,
): boolean {
  if (geometry.kind !== 'rect' && geometry.kind !== 'ellipse' && geometry.points.length === 0) {
    return false;
  }
  const b = normalizeBox(box);
  const g = geometryBounds(geometry, element);
  return g.minX >= b.minX && g.minY >= b.minY && g.maxX <= b.maxX && g.maxY <= b.maxY;
}

/**
 * Whether a geometry, including its stroke thickness, lies entirely inside the polygon `area`
 * (for example a lasso, BOARD-910). `area` may be concave or self-intersecting (even-odd rule) and
 * is in board coordinates when `element` is given, otherwise local. Ellipses are tested with their
 * {@link ELLIPSE_SEGMENTS}-sided outline. An area with fewer than three points, or a geometry
 * without points, never contains anything.
 *
 * @beta
 */
export function containedInPolygon(
  geometry: Geometry,
  area: readonly Point[],
  element?: ElementTransform,
): boolean {
  const outline = outlineOf(geometry);
  const ring = toLocalPoints(area, element);
  if (outline.points.length === 0 || ring.length < 3) return false;

  // Cheap rejection: the shape's bounds must fit in the area's bounds.
  const g = geometryBounds(geometry);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (g.minX < minX || g.minY < minY || g.maxX > maxX || g.maxY > maxY) return false;

  // Every vertex of the shape is inside the area...
  for (const p of outline.points) if (!insideRing(p, ring)) return false;
  // ...no part of the area's boundary reaches into the shape (a hole or a dent)...
  if (insideArea(geometry, outline, ring[0]!)) return false;
  // ...and the boundaries never cross or come within the stroke's half thickness.
  for (const [a, b] of segmentsOf(outline.points, outline.closed)) {
    for (const [c, d] of segmentsOf(ring, true)) {
      if (segmentDistance(a, b, c, d) <= outline.halfWidth) return false;
    }
  }
  return true;
}

/**
 * Kind of a snap point: a corner or vertex, the middle of an edge, or the center of the shape.
 *
 * @beta
 */
export type SnapPointKind = 'corner' | 'edge' | 'center';

/**
 * A point other elements can snap to.
 *
 * @beta
 */
export interface SnapPoint extends Point {
  readonly kind: SnapPointKind;
}

/**
 * Snap points of a geometry, in board coordinates when `element` is given, otherwise local:
 * - rect and polygon: vertices (`corner`), edge midpoints (`edge`), and the bounds center.
 * - ellipse: the four extreme points (`edge`) and the center.
 * - polyline: vertices (`corner`), segment midpoints (`edge`), and the bounds center.
 * - path: only its endpoints (`corner`) and the bounds center, since strokes have many points.
 *
 * A geometry without points has no snap points.
 *
 * @beta
 */
export function snapPoints(geometry: Geometry, element?: ElementTransform): SnapPoint[] {
  const local: SnapPoint[] = [];
  const add = (kind: SnapPointKind, p: Point): void => {
    local.push({ kind, x: p.x, y: p.y });
  };
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  switch (geometry.kind) {
    case 'ellipse': {
      const { x, y, w, h } = geometry;
      add('edge', { x: x + w / 2, y });
      add('edge', { x: x + w, y: y + h / 2 });
      add('edge', { x: x + w / 2, y: y + h });
      add('edge', { x, y: y + h / 2 });
      break;
    }
    case 'path': {
      const pts = geometry.points;
      if (pts.length === 0) return [];
      add('corner', pts[0]!);
      if (pts.length > 1) add('corner', pts[pts.length - 1]!);
      break;
    }
    default: {
      const outline = outlineOf(geometry);
      if (outline.points.length === 0) return [];
      for (const p of outline.points) add('corner', p);
      if (outline.points.length > 1) {
        for (const [a, b] of segmentsOf(outline.points, outline.closed)) add('edge', mid(a, b));
      }
    }
  }
  const b = geometryBounds(geometry);
  add('center', { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

  return element ? local.map((s) => ({ kind: s.kind, ...localToBoard(element, s) })) : local;
}
