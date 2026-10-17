/**
 * Minimal geometry primitives for the `defineElement` contract (BOARD-601).
 *
 * Only data shapes and their constructors. Operations (bounds, hit-testing, distance, intersection, snap points) and
 * rotation transforms belong to the BOARD-403 geometry library, which will extend this module.
 *
 * All coordinates are local to the element: point `(0, 0)` is the element's top-left corner
 * before rotation, in board units.
 */

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
 * Element geometry for hit-testing, snapping, and selection. Returned by `geometry` in
 * `defineElement`. The list of shapes will be extended by BOARD-403 (for example `path`).
 *
 * @beta
 */
export type Geometry = RectGeometry | EllipseGeometry | PolygonGeometry | PolylineGeometry;

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
