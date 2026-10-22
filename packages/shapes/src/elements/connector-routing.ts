/**
 * Connector routing, anchor resolution, snapping, and arrowhead rendering (BOARD-1101, BOARD-1102).
 */

import {
  localToBoard,
  toBoardTolerance,
  type Board,
  type BoxBounds,
  type ElementCanvasContext,
  type ElementTransform,
  type Point,
} from '@kujam/core';

/** Dash style for connectors and shapes. @public */
export type ConnectorDash = 'solid' | 'dashed' | 'dotted';

/**
 * Dash pattern of each {@link ConnectorDash}, in multiples of the stroke width. Shared by
 * connectors and lines (BOARD-1106).
 *
 * @internal
 */
export const CONNECTOR_DASH_PATTERNS: Readonly<Record<ConnectorDash, readonly number[]>> =
  Object.freeze({
    solid: [],
    dashed: [4, 4],
    dotted: [1, 3],
  });

/**
 * Cardinal side of a shape's bounding box for anchor attachment and orthogonal routing.
 *
 * @public
 */
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Supported connector path routing styles (BOARD-1101a).
 *
 * @public
 */
export const CONNECTOR_STYLES = ['straight', 'elbow', 'curved'] as const;

/**
 * Connector path routing style.
 *
 * @public
 */
export type ConnectorStyle = (typeof CONNECTOR_STYLES)[number];

/**
 * Supported arrowhead styles for connector start and end caps (BOARD-1101c).
 *
 * @public
 */
export const ARROWHEAD_STYLES = ['none', 'arrow', 'triangle', 'dot', 'diamond'] as const;

/**
 * Arrowhead style on a connector endpoint.
 *
 * @public
 */
export type ArrowheadStyle = (typeof ARROWHEAD_STYLES)[number];

/**
 * Normalized `(0..1)` coordinates for the four cardinal anchor points of a shape (BOARD-1101b).
 *
 * @public
 */
export const CARDINAL_ANCHORS: Readonly<Record<AnchorSide, Readonly<Point>>> = Object.freeze({
  top: Object.freeze({ x: 0.5, y: 0 }),
  right: Object.freeze({ x: 1, y: 0.5 }),
  bottom: Object.freeze({ x: 0.5, y: 1 }),
  left: Object.freeze({ x: 0, y: 0.5 }),
});

/** Ordered list of the four cardinal anchor sides. @public */
export const CARDINAL_SIDES: readonly AnchorSide[] = Object.freeze([
  'top',
  'right',
  'bottom',
  'left',
]);

/** Default screen-pixel tolerance when snapping a connector endpoint to a shape anchor. @public */
export const SNAP_ANCHOR_TOLERANCE_PX = 16;

/** Default clearance in board units around obstacle boxes for orthogonal elbow routing. @public */
export const DEFAULT_ELBOW_CLEARANCE = 16;

/**
 * Resolved snap target when hovering or dragging a connector endpoint near a shape (BOARD-1101b).
 *
 * @public
 */
export interface ConnectorSnapTarget {
  readonly elementId: string;
  readonly anchor: Point;
  readonly side: AnchorSide;
  readonly worldPoint: Point;
}

/**
 * Transient preview state stored in `toolContext.data.connectorPreview` while dragging a new connector.
 *
 * @public
 */
export interface ConnectorPreview {
  readonly start: Point;
  readonly end: Point;
  readonly points: readonly Point[];
  readonly style: ConnectorStyle;
  readonly startArrow: ArrowheadStyle;
  readonly endArrow: ArrowheadStyle;
  readonly color: string;
  readonly strokeWidth: number;
  readonly dash: ConnectorDash;
}

/**
 * Manual placement of an elbow connector's middle segment, set by dragging it: the segment runs
 * along `axis` (`x`: a vertical segment at that x) at `offset` board units from the midpoint
 * between the connector's ends, so it follows when bound shapes move.
 *
 * @public
 */
export interface ConnectorBend {
  /** `x`: the middle segment is vertical, at an x position; `y`: horizontal, at a y position. */
  readonly axis: 'x' | 'y';
  /** Distance of the segment from the midpoint between the ends, in board units. */
  readonly offset: number;
}

/**
 * Options for {@link computeConnectorRoute}.
 *
 * @public
 */
export interface ConnectorRouteOptions {
  /** Manual middle segment of an elbow route; obstacle avoidance is then skipped. */
  readonly bend?: ConnectorBend | null;
  readonly startSide?: AnchorSide | null;
  readonly endSide?: AnchorSide | null;
  readonly startBounds?: BoxBounds | null;
  readonly endBounds?: BoxBounds | null;
  readonly obstacles?: readonly BoxBounds[];
  readonly clearance?: number;
}

/**
 * Computed route geometry for a connector in world or local coordinates.
 *
 * @public
 */
export interface ConnectorRouteResult {
  /** Polyline vertices from `start` to `end`. */
  readonly points: readonly Point[];
  /** Cubic Bezier control points `[c1, c2]` when `style === 'curved'`. */
  readonly controlPoints?: readonly [Point, Point];
  /** Midpoint along the connector path (for placing the centered label pill). */
  readonly midpoint: Point;
  /** Tangent angle in radians pointing into `start` (for orienting `startArrow`). */
  readonly startAngle: number;
  /** Tangent angle in radians pointing into `end` (for orienting `endArrow`). */
  readonly endAngle: number;
}

/**
 * Converts a normalized `(0..1, 0..1)` anchor on `element` into board (world) coordinates,
 * accounting for element position, size, and rotation (BOARD-1101b).
 *
 * @public
 */
export function resolveAnchorWorldPoint(element: ElementTransform, anchor: Point): Point {
  return localToBoard(element, {
    x: anchor.x * element.w,
    y: anchor.y * element.h,
  });
}

/**
 * Determines which cardinal world-space side an anchor faces after accounting for element rotation.
 *
 * @public
 */
export function resolveAnchorSide(anchor: Point, rotation = 0): AnchorSide {
  const dx = anchor.x - 0.5;
  const dy = anchor.y - 0.5;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 'right';
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  if (Math.abs(rx) >= Math.abs(ry)) {
    return rx >= 0 ? 'right' : 'left';
  }
  return ry >= 0 ? 'bottom' : 'top';
}

function isBindableElement(type: string): boolean {
  return type !== 'connector' && type !== 'draw';
}

/**
 * Finds the nearest shape cardinal anchor within `tolerancePx` of `point` (or the nearest
 * cardinal anchor of a shape directly under `point`), skipping excluded element IDs and
 * non-bindable elements (`connector`, `draw`).
 *
 * @public
 */
export function findSnapAnchor(
  board: Board,
  point: Point,
  excludeIds?: ReadonlySet<string>,
  tolerancePx = SNAP_ANCHOR_TOLERANCE_PX,
): ConnectorSnapTarget | null {
  const tol = toBoardTolerance(tolerancePx, board.getCamera().zoom);
  const candidates = board.query();

  let best: ConnectorSnapTarget | null = null;
  let bestDist = tol;

  // Check cardinal anchors of all bindable elements on the current page (topmost wins on tie).
  for (let i = candidates.length - 1; i >= 0; i--) {
    const el = candidates[i]!;
    if (!isBindableElement(el.type)) continue;
    if (excludeIds?.has(el.id)) continue;

    for (const side of CARDINAL_SIDES) {
      const anchor = CARDINAL_ANCHORS[side];
      const worldPoint = resolveAnchorWorldPoint(el, anchor);
      const dist = Math.hypot(worldPoint.x - point.x, worldPoint.y - point.y);
      if (dist <= bestDist) {
        bestDist = dist;
        best = {
          elementId: el.id,
          anchor,
          side: resolveAnchorSide(anchor, el.rotation),
          worldPoint,
        };
      }
    }
  }

  if (best) return best;

  // If no cardinal anchor is within `tol`, check if the pointer is directly over a bindable shape.
  const hit = board.hitTest(point, { includeLocked: true });
  if (hit && isBindableElement(hit.type) && !excludeIds?.has(hit.id)) {
    let nearest: ConnectorSnapTarget | null = null;
    let nearestDist = Infinity;
    for (const side of CARDINAL_SIDES) {
      const anchor = CARDINAL_ANCHORS[side];
      const worldPoint = resolveAnchorWorldPoint(hit, anchor);
      const dist = Math.hypot(worldPoint.x - point.x, worldPoint.y - point.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = {
          elementId: hit.id,
          anchor,
          side: resolveAnchorSide(anchor, hit.rotation),
          worldPoint,
        };
      }
    }
    return nearest;
  }

  return null;
}

function sideUnitVector(side: AnchorSide): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'right':
      return { x: 1, y: 0 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
  }
}

function dominantSide(from: Point, to: Point): AnchorSide {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function expandBox(box: BoxBounds, pad: number): BoxBounds {
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
}

/**
 * Checks whether an axis-aligned segment `[a, b]` passes through the strict interior of `box`.
 */
function segmentIntersectsBoxInterior(a: Point, b: Point, box: BoxBounds): boolean {
  const eps = 1e-4;
  const minX = box.minX + eps;
  const maxX = box.maxX - eps;
  const minY = box.minY + eps;
  const maxY = box.maxY - eps;
  if (minX >= maxX || minY >= maxY) return false;

  if (Math.abs(a.y - b.y) < 1e-6) {
    // Horizontal segment at y = a.y
    const y = a.y;
    if (y <= minY || y >= maxY) return false;
    const segMinX = Math.min(a.x, b.x);
    const segMaxX = Math.max(a.x, b.x);
    return segMaxX > minX && segMinX < maxX;
  }
  if (Math.abs(a.x - b.x) < 1e-6) {
    // Vertical segment at x = a.x
    const x = a.x;
    if (x <= minX || x >= maxX) return false;
    const segMinY = Math.min(a.y, b.y);
    const segMaxY = Math.max(a.y, b.y);
    return segMaxY > minY && segMinY < maxY;
  }
  return false;
}

function polylineIntersectsAnyBox(points: readonly Point[], boxes: readonly BoxBounds[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (const box of boxes) {
      if (segmentIntersectsBoxInterior(a, b, box)) return true;
    }
  }
  return false;
}

/**
 * Removes zero-length segments and merges collinear consecutive segments in an orthogonal polyline.
 *
 * @public
 */
export function simplifyOrthogonalPoints(raw: readonly Point[]): Point[] {
  if (raw.length <= 2) return raw.map((p) => ({ x: p.x, y: p.y }));
  const deduped: Point[] = [raw[0]!];
  for (let i = 1; i < raw.length; i++) {
    const prev = deduped[deduped.length - 1]!;
    const curr = raw[i]!;
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > 1e-5) {
      deduped.push(curr);
    }
  }
  if (deduped.length <= 2) {
    return deduped.length === 1 ? [deduped[0]!, raw[raw.length - 1]!] : deduped;
  }

  const out: Point[] = [deduped[0]!];
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const curr = deduped[i]!;
    const next = deduped[i + 1]!;
    const sameX = Math.abs(prev.x - curr.x) < 1e-5 && Math.abs(curr.x - next.x) < 1e-5;
    const sameY = Math.abs(prev.y - curr.y) < 1e-5 && Math.abs(curr.y - next.y) < 1e-5;
    if (sameX || sameY) continue;
    out.push(curr);
  }
  out.push(deduped[deduped.length - 1]!);
  return out;
}

function computeStubPoint(
  anchor: Point,
  side: AnchorSide | null | undefined,
  bounds: BoxBounds | null | undefined,
  clearance: number,
): Point {
  if (!side) return anchor;
  const dir = sideUnitVector(side);
  if (bounds) {
    switch (side) {
      case 'top':
        return { x: anchor.x, y: Math.min(anchor.y, bounds.minY) - clearance };
      case 'bottom':
        return { x: anchor.x, y: Math.max(anchor.y, bounds.maxY) + clearance };
      case 'left':
        return { x: Math.min(anchor.x, bounds.minX) - clearance, y: anchor.y };
      case 'right':
        return { x: Math.max(anchor.x, bounds.maxX) + clearance, y: anchor.y };
    }
  }
  return {
    x: anchor.x + dir.x * clearance,
    y: anchor.y + dir.y * clearance,
  };
}

function polylineLengthAndBends(points: readonly Point[]): { length: number; bends: number } {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length +=
      Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y);
  }
  return { length, bends: Math.max(0, points.length - 2) };
}

function reversesStub(
  fullPoints: readonly Point[],
  startSide: AnchorSide | null | undefined,
  endSide: AnchorSide | null | undefined,
): boolean {
  if (fullPoints.length < 2) return false;
  if (startSide) {
    const dir = sideUnitVector(startSide);
    const dx = fullPoints[1]!.x - fullPoints[0]!.x;
    const dy = fullPoints[1]!.y - fullPoints[0]!.y;
    if (dx * dir.x + dy * dir.y < -1e-4) return true;
  }
  if (endSide) {
    const dir = sideUnitVector(endSide);
    const n = fullPoints.length;
    // Entering `end` from `endSide` means the final segment goes in the opposite direction of `dir`.
    const dx = fullPoints[n - 1]!.x - fullPoints[n - 2]!.x;
    const dy = fullPoints[n - 1]!.y - fullPoints[n - 2]!.y;
    if (dx * dir.x + dy * dir.y > 1e-4) return true;
  }
  return false;
}

/**
 * Clamps a bent segment coordinate to `[max(mins), min(maxes)]`. When the limits conflict (the
 * stubs face each other's far sides), the value is kept as dragged.
 */
function clampBend(value: number, mins: readonly number[], maxes: readonly number[]): number {
  const lo = Math.max(...mins);
  const hi = Math.min(...maxes);
  if (lo > hi) return value;
  return Math.min(hi, Math.max(lo, value));
}

function computeElbowPoints(
  start: Point,
  end: Point,
  options: ConnectorRouteOptions,
): readonly Point[] {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-4) {
    return [start, end];
  }

  const clearance = options.clearance ?? DEFAULT_ELBOW_CLEARANCE;
  const startSide = options.startSide ?? null;
  const endSide = options.endSide ?? null;

  const startStub = computeStubPoint(start, startSide, options.startBounds, clearance);
  const endStub = computeStubPoint(end, endSide, options.endBounds, clearance);

  // A dragged middle segment wins over automatic routing. It stays on the outer side of both
  // stubs, so the path still leaves and enters bound shapes from their bound sides.
  const bend = options.bend;
  if (bend) {
    if (bend.axis === 'x') {
      const x = clampBend(
        (start.x + end.x) / 2 + bend.offset,
        [
          startSide === 'right' ? startStub.x : -Infinity,
          endSide === 'right' ? endStub.x : -Infinity,
        ],
        [startSide === 'left' ? startStub.x : Infinity, endSide === 'left' ? endStub.x : Infinity],
      );
      return simplifyOrthogonalPoints([
        start,
        startStub,
        { x, y: startStub.y },
        { x, y: endStub.y },
        endStub,
        end,
      ]);
    }
    const y = clampBend(
      (start.y + end.y) / 2 + bend.offset,
      [
        startSide === 'bottom' ? startStub.y : -Infinity,
        endSide === 'bottom' ? endStub.y : -Infinity,
      ],
      [startSide === 'top' ? startStub.y : Infinity, endSide === 'top' ? endStub.y : Infinity],
    );
    return simplifyOrthogonalPoints([
      start,
      startStub,
      { x: startStub.x, y },
      { x: endStub.x, y },
      endStub,
      end,
    ]);
  }

  // Build padded obstacle boxes for intermediate routing between startStub and endStub.
  const paddedObstacles: BoxBounds[] = [];
  if (options.startBounds) {
    paddedObstacles.push(expandBox(options.startBounds, Math.max(2, clearance - 2)));
  }
  if (options.endBounds) {
    paddedObstacles.push(expandBox(options.endBounds, Math.max(2, clearance - 2)));
  }
  if (options.obstacles) {
    const limit = Math.min(options.obstacles.length, 24);
    for (let i = 0; i < limit; i++) {
      paddedObstacles.push(expandBox(options.obstacles[i]!, clearance));
    }
  }

  // Try direct 1-, 2-, or 3-segment candidates between startStub and endStub first.
  const midX = (startStub.x + endStub.x) / 2;
  const midY = (startStub.y + endStub.y) / 2;
  const directCandidates: Point[][] = [];

  if (Math.abs(startStub.x - endStub.x) < 1e-5 || Math.abs(startStub.y - endStub.y) < 1e-5) {
    directCandidates.push([start, startStub, endStub, end]);
  }
  directCandidates.push(
    [start, startStub, { x: endStub.x, y: startStub.y }, endStub, end],
    [start, startStub, { x: startStub.x, y: endStub.y }, endStub, end],
    [start, startStub, { x: midX, y: startStub.y }, { x: midX, y: endStub.y }, endStub, end],
    [start, startStub, { x: startStub.x, y: midY }, { x: endStub.x, y: midY }, endStub, end],
  );

  let bestCandidate: Point[] | null = null;
  let bestScore = Infinity;

  const evaluateCandidates = (candidates: readonly Point[][]): void => {
    for (const raw of candidates) {
      const inner = simplifyOrthogonalPoints(raw.slice(1, -1));
      if (polylineIntersectsAnyBox(inner, paddedObstacles)) continue;
      const simplified = simplifyOrthogonalPoints(raw);
      if (reversesStub(simplified, startSide, endSide)) continue;
      const { length, bends } = polylineLengthAndBends(simplified);
      const score = length + bends * 24;
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = simplified;
      }
    }
  };

  evaluateCandidates(directCandidates);
  if (bestCandidate) return bestCandidate;

  // Try single-corridor detours around unique obstacle top/bottom/left/right edges before grid search.
  const detourYs = new Set<number>();
  const detourXs = new Set<number>();
  for (const box of paddedObstacles) {
    detourYs.add(box.minY);
    detourYs.add(box.maxY);
    detourXs.add(box.minX);
    detourXs.add(box.maxX);
  }
  const detourCandidates: Point[][] = [];
  for (const by of detourYs) {
    detourCandidates.push([
      start,
      startStub,
      { x: startStub.x, y: by },
      { x: endStub.x, y: by },
      endStub,
      end,
    ]);
  }
  for (const bx of detourXs) {
    detourCandidates.push([
      start,
      startStub,
      { x: bx, y: startStub.y },
      { x: bx, y: endStub.y },
      endStub,
      end,
    ]);
  }
  evaluateCandidates(detourCandidates);
  if (bestCandidate) return bestCandidate;

  // Orthogonal visibility-grid A* search around relevant corridor obstacle boundaries.
  const corridorMinX = Math.min(start.x, startStub.x, end.x, endStub.x) - clearance * 4;
  const corridorMaxX = Math.max(start.x, startStub.x, end.x, endStub.x) + clearance * 4;
  const corridorMinY = Math.min(start.y, startStub.y, end.y, endStub.y) - clearance * 4;
  const corridorMaxY = Math.max(start.y, startStub.y, end.y, endStub.y) + clearance * 4;

  const xsSet = new Set<number>([startStub.x, endStub.x, midX]);
  const ysSet = new Set<number>([startStub.y, endStub.y, midY]);
  const corridorObstacles: BoxBounds[] = [];
  for (const box of paddedObstacles) {
    if (
      box.maxX < corridorMinX ||
      box.minX > corridorMaxX ||
      box.maxY < corridorMinY ||
      box.minY > corridorMaxY
    ) {
      continue;
    }
    corridorObstacles.push(box);
    xsSet.add(box.minX);
    xsSet.add(box.maxX);
    ysSet.add(box.minY);
    ysSet.add(box.maxY);
  }

  const xs = Array.from(xsSet).sort((a, b) => a - b);
  const ys = Array.from(ysSet).sort((a, b) => a - b);
  const nx = xs.length;
  const ny = ys.length;
  const startXi = xs.indexOf(startStub.x);
  const startYi = ys.indexOf(startStub.y);
  const endXi = xs.indexOf(endStub.x);
  const endYi = ys.indexOf(endStub.y);

  // State: (xi * ny + yi) * 3 + dir, where dir: 0 = initial, 1 = horizontal, 2 = vertical
  const totalStates = nx * ny * 3;
  const dist = new Float64Array(totalStates).fill(Infinity);
  const fScore = new Float64Array(totalStates).fill(Infinity);
  const prev = new Int32Array(totalStates).fill(-1);
  const visited = new Uint8Array(totalStates);

  const stateIdx = (xi: number, yi: number, dir: number): number => (xi * ny + yi) * 3 + dir;
  const startState = stateIdx(startXi, startYi, 0);
  dist[startState] = 0;
  fScore[startState] = Math.abs(startStub.x - endStub.x) + Math.abs(startStub.y - endStub.y);

  const bendPenalty = 24;
  const obstaclePenalty = 1_000_000;
  const sDir = startSide ? sideUnitVector(startSide) : null;

  const queue: number[] = [startState];

  while (queue.length > 0) {
    let bestQIdx = 0;
    let bestF = fScore[queue[0]!]!;
    for (let i = 1; i < queue.length; i++) {
      const f = fScore[queue[i]!]!;
      if (f < bestF) {
        bestF = f;
        bestQIdx = i;
      }
    }
    const curr = queue[bestQIdx]!;
    queue[bestQIdx] = queue[queue.length - 1]!;
    queue.pop();

    if (visited[curr]) continue;
    visited[curr] = 1;

    const node = (curr / 3) | 0;
    const xi = (node / ny) | 0;
    const yi = node % ny;
    const dir = curr % 3;

    if (xi === endXi && yi === endYi) {
      const gridPath: Point[] = [];
      let trace = curr;
      while (trace !== -1) {
        const tNode = (trace / 3) | 0;
        const tXi = (tNode / ny) | 0;
        const tYi = tNode % ny;
        gridPath.push({ x: xs[tXi]!, y: ys[tYi]! });
        trace = prev[trace]!;
      }
      gridPath.reverse();
      return simplifyOrthogonalPoints([start, ...gridPath, end]);
    }

    const currPt: Point = { x: xs[xi]!, y: ys[yi]! };
    const currDist = dist[curr]!;

    for (let step = 0; step < 4; step++) {
      let nxi = xi;
      let nyi = yi;
      let ndir = 1;
      if (step === 0) {
        if (xi === 0) continue;
        nxi = xi - 1;
      } else if (step === 1) {
        if (xi + 1 >= nx) continue;
        nxi = xi + 1;
      } else if (step === 2) {
        if (yi === 0) continue;
        nyi = yi - 1;
        ndir = 2;
      } else {
        if (yi + 1 >= ny) continue;
        nyi = yi + 1;
        ndir = 2;
      }

      const nextState = (nxi * ny + nyi) * 3 + ndir;
      if (visited[nextState]) continue;

      const nextPt: Point = { x: xs[nxi]!, y: ys[nyi]! };
      let stepCost = Math.abs(nextPt.x - currPt.x) + Math.abs(nextPt.y - currPt.y);
      if (dir !== 0 && dir !== ndir) stepCost += bendPenalty;

      if (dir === 0 && sDir) {
        const dx = nextPt.x - currPt.x;
        const dy = nextPt.y - currPt.y;
        if (dx * sDir.x + dy * sDir.y < -1e-4) stepCost += obstaclePenalty;
      }

      for (let bi = 0; bi < corridorObstacles.length; bi++) {
        if (segmentIntersectsBoxInterior(currPt, nextPt, corridorObstacles[bi]!)) {
          stepCost += obstaclePenalty;
          break;
        }
      }

      const nextG = currDist + stepCost;
      if (nextG < dist[nextState]!) {
        dist[nextState] = nextG;
        fScore[nextState] =
          nextG + Math.abs(nextPt.x - endStub.x) + Math.abs(nextPt.y - endStub.y);
        prev[nextState] = curr;
        queue.push(nextState);
      }
    }
  }

  return simplifyOrthogonalPoints([
    start,
    startStub,
    { x: midX, y: startStub.y },
    { x: midX, y: endStub.y },
    endStub,
    end,
  ]);
}

function polylineMidpoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  let total = 0;
  const segLengths: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    segLengths.push(len);
    total += len;
  }
  if (total < 1e-6) return points[0]!;
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const len = segLengths[i]!;
    if (acc + len >= half) {
      const t = len > 1e-6 ? (half - acc) / len : 0;
      const a = points[i]!;
      const b = points[i + 1]!;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }
    acc += len;
  }
  return points[points.length - 1]!;
}

/**
 * Computes the routed path, midpoint, and endpoint tangent angles for a connector
 * in `'straight'`, `'elbow'`, or `'curved'` mode (BOARD-1101a, BOARD-1102).
 *
 * @public
 */
export function computeConnectorRoute(
  start: Point,
  end: Point,
  style: ConnectorStyle,
  options: ConnectorRouteOptions = {},
): ConnectorRouteResult {
  if (style === 'straight') {
    const points: readonly Point[] = [start, end];
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const startAngle = Math.atan2(start.y - end.y, start.x - end.x);
    const endAngle = Math.atan2(end.y - start.y, end.x - start.x);
    return { points, midpoint, startAngle, endAngle };
  }

  if (style === 'curved') {
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const offset = Math.max(24, Math.min(160, dist * 0.45));
    const sSide = options.startSide ?? dominantSide(start, end);
    const eSide = options.endSide ?? dominantSide(end, start);
    const sVec = sideUnitVector(sSide);
    const eVec = sideUnitVector(eSide);

    const c1: Point = { x: start.x + sVec.x * offset, y: start.y + sVec.y * offset };
    const c2: Point = { x: end.x + eVec.x * offset, y: end.y + eVec.y * offset };

    const samples = 24;
    const points: Point[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const mt = 1 - t;
      const x =
        mt * mt * mt * start.x +
        3 * mt * mt * t * c1.x +
        3 * mt * t * t * c2.x +
        t * t * t * end.x;
      const y =
        mt * mt * mt * start.y +
        3 * mt * mt * t * c1.y +
        3 * mt * t * t * c2.y +
        t * t * t * end.y;
      points.push({ x, y });
    }

    const midpoint: Point = {
      x: 0.125 * start.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * end.x,
      y: 0.125 * start.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * end.y,
    };

    const startAngle =
      Math.hypot(start.x - c1.x, start.y - c1.y) > 1e-5
        ? Math.atan2(start.y - c1.y, start.x - c1.x)
        : Math.atan2(start.y - end.y, start.x - end.x);
    const endAngle =
      Math.hypot(end.x - c2.x, end.y - c2.y) > 1e-5
        ? Math.atan2(end.y - c2.y, end.x - c2.x)
        : Math.atan2(end.y - start.y, end.x - start.x);

    return {
      points,
      controlPoints: [c1, c2],
      midpoint,
      startAngle,
      endAngle,
    };
  }

  // 'elbow'
  const points = computeElbowPoints(start, end, options);
  const midpoint = polylineMidpoint(points);
  const p0 = points[0]!;
  const p1 = points[1] ?? end;
  const pn = points[points.length - 1]!;
  const pn1 = points[points.length - 2] ?? start;
  const startAngle = Math.atan2(p0.y - p1.y, p0.x - p1.x);
  const endAngle = Math.atan2(pn.y - pn1.y, pn.x - pn1.x);
  return { points, midpoint, startAngle, endAngle };
}

/**
 * Computes normalized element bounds `(x, y, w, h)` and relative `start`/`end` points
 * from world `startWorld`, `endWorld`, and optional routed world `routePoints`.
 *
 * @public
 */
export function normalizeConnectorBounds(
  startWorld: Point,
  endWorld: Point,
  routePoints?: readonly Point[],
): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly start: Point;
  readonly end: Point;
} {
  let minX = Math.min(startWorld.x, endWorld.x);
  let minY = Math.min(startWorld.y, endWorld.y);
  let maxX = Math.max(startWorld.x, endWorld.x);
  let maxY = Math.max(startWorld.y, endWorld.y);

  if (routePoints) {
    for (const pt of routePoints) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    start: { x: startWorld.x - minX, y: startWorld.y - minY },
    end: { x: endWorld.x - minX, y: endWorld.y - minY },
  };
}

/**
 * Draws an arrowhead at `tip` oriented along `angle` (radians pointing into `tip`) (BOARD-1101c).
 *
 * @public
 */
export function drawArrowhead(
  ctx: ElementCanvasContext,
  style: ArrowheadStyle,
  tip: Point,
  angle: number,
  strokeWidth: number,
  color: string,
): void {
  if (style === 'none') return;

  const size = Math.max(8, strokeWidth * 3.5);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Local helper: x along the arrow direction (0 at tip, negative behind tip), y perpendicular.
  const toWorld = (lx: number, ly: number): Point => ({
    x: tip.x + lx * cos - ly * sin,
    y: tip.y + lx * sin + ly * cos,
  });

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (typeof ctx.setLineDash === 'function') {
    ctx.setLineDash([]);
  }

  switch (style) {
    case 'arrow': {
      const wing1 = toWorld(-size, -size * 0.55);
      const wing2 = toWorld(-size, size * 0.55);
      ctx.beginPath();
      ctx.moveTo(wing1.x, wing1.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(wing2.x, wing2.y);
      ctx.stroke();
      break;
    }
    case 'triangle': {
      const wing1 = toWorld(-size, -size * 0.55);
      const wing2 = toWorld(-size, size * 0.55);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(wing1.x, wing1.y);
      ctx.lineTo(wing2.x, wing2.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'dot': {
      const radius = size * 0.45;
      const center = toWorld(-radius * 0.6, 0);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'diamond': {
      const midLeft = toWorld(-size * 0.6, -size * 0.45);
      const back = toWorld(-size * 1.2, 0);
      const midRight = toWorld(-size * 0.6, size * 0.45);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(midLeft.x, midLeft.y);
      ctx.lineTo(back.x, back.y);
      ctx.lineTo(midRight.x, midRight.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}
