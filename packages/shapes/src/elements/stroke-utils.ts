/**
 * Freehand stroke utilities (BOARD-1002): Ramer-Douglas-Peucker simplification,
 * point chunking for strokes exceeding MAX_DRAW_POINTS, and outline drawing.
 */

import type { BrushDefinition, ElementCanvasContext } from '@kujam/core';
import { MAX_DRAW_POINTS } from './draw.js';

/**
 * Calculates perpendicular distance from a point to a line segment.
 *
 * @internal
 */
export function distanceToSegment(
  p: readonly number[],
  a: readonly number[],
  b: readonly number[],
): number {
  const px = p[0] ?? 0;
  const py = p[1] ?? 0;
  const ax = a[0] ?? 0;
  const ay = a[1] ?? 0;
  const bx = b[0] ?? 0;
  const by = b[1] ?? 0;

  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;

  if (len2 === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const projX = ax + t * dx;
  const projY = ay + t * dy;

  return Math.hypot(px - projX, py - projY);
}

function cross(
  ox: number,
  oy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

function onSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  return (
    Math.min(ax, bx) <= px &&
    px <= Math.max(ax, bx) &&
    Math.min(ay, by) <= py &&
    py <= Math.max(ay, by)
  );
}

function segmentsIntersect(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  d: readonly number[],
): boolean {
  const ax = a[0] ?? 0;
  const ay = a[1] ?? 0;
  const bx = b[0] ?? 0;
  const by = b[1] ?? 0;
  const cx = c[0] ?? 0;
  const cy = c[1] ?? 0;
  const dx = d[0] ?? 0;
  const dy = d[1] ?? 0;

  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    (d1 === 0 && onSegment(ax, ay, cx, cy, dx, dy)) ||
    (d2 === 0 && onSegment(bx, by, cx, cy, dx, dy)) ||
    (d3 === 0 && onSegment(cx, cy, ax, ay, bx, by)) ||
    (d4 === 0 && onSegment(dx, dy, ax, ay, bx, by))
  );
}

/**
 * Calculates minimum Euclidean distance between two line segments `a -> b` and `c -> d`.
 *
 * @internal
 */
export function segmentDistance(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  d: readonly number[],
): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

/**
 * Simplifies a polyline using the Ramer-Douglas-Peucker (RDP) algorithm (BOARD-1002).
 *
 * Points are retained when their perpendicular distance to the segment between their neighbors
 * exceeds `epsilon` (default 0.5 px). The algorithm runs iteratively to prevent call stack limits.
 *
 * @param points Stroke points `[x, y, pressure?]`.
 * @param epsilon Error tolerance in board units (defaults to 0.5).
 * @returns Simplified array of points.
 * @beta
 */
export function simplifyPoints(
  points: readonly (readonly number[])[],
  epsilon = 0.5,
): number[][] {
  const n = points.length;
  if (n <= 2) {
    return points.map((p) => [...p]);
  }

  const kept = new Uint8Array(n);
  kept[0] = 1;
  kept[n - 1] = 1;

  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;

    let maxDist = 0;
    let maxIdx = start;
    const a = points[start]!;
    const b = points[end]!;

    for (let i = start + 1; i < end; i++) {
      const dist = distanceToSegment(points[i]!, a, b);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      kept[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (kept[i]) {
      result.push([...points[i]!]);
    }
  }

  return result;
}

/**
 * Splits a list of points into consecutive chunks of at most `maxPoints` (BOARD-1002).
 *
 * To avoid visual gaps at segment boundaries, adjacent chunks overlap by 1 point.
 *
 * @param points List of stroke points.
 * @param maxPoints Maximum points per chunk (defaults to MAX_DRAW_POINTS = 5000).
 * @returns Array of point chunks.
 * @beta
 */
export function chunkPoints(
  points: readonly (readonly number[])[],
  maxPoints = MAX_DRAW_POINTS,
): number[][][] {
  if (points.length <= maxPoints) {
    return [points.map((p) => [...p])];
  }

  const chunks: number[][][] = [];
  let start = 0;
  const step = Math.max(1, maxPoints - 1);

  while (start < points.length) {
    const end = Math.min(points.length, start + maxPoints);
    chunks.push(points.slice(start, end).map((p) => [...p]));
    if (end >= points.length) break;
    start += step;
  }

  return chunks;
}

/**
 * Maps stroke thickness and brush definition into perfect-freehand stroke options (BOARD-1002).
 *
 * @internal
 */
export function getStrokeOptions(
  thickness: number,
  brush: BrushDefinition,
  isComplete = true,
) {
  const taper = brush.strokeOptions.taper;
  const startTaper = typeof taper === 'object' && taper !== null ? taper.start : taper;
  const endTaper = typeof taper === 'object' && taper !== null ? taper.end : taper;

  return {
    size: thickness,
    thinning: brush.strokeOptions.thinning,
    smoothing: brush.strokeOptions.smoothing,
    streamline: brush.strokeOptions.streamline,
    simulatePressure: brush.strokeOptions.simulatePressure,
    start: {
      taper: startTaper,
      cap: true,
    },
    end: {
      taper: endTaper,
      cap: true,
    },
    last: isComplete,
  };
}

/**
 * Path tracing commands shared by `CanvasRenderingContext2D` and `Path2D`.
 *
 * @internal
 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  closePath(): void;
}

/**
 * Stroke outline polygon as returned by perfect-freehand.
 *
 * @internal
 */
export type StrokeOutline = readonly (readonly number[])[];

/**
 * Traces a closed stroke outline with quadratic curves between midpoints (BOARD-1002).
 *
 * @internal
 */
export function traceStrokeOutline(sink: PathSink, outline: StrokeOutline): void {
  const first = outline[0];
  if (!first) return;

  sink.moveTo(first[0] ?? 0, first[1] ?? 0);
  if (outline.length < 3) {
    for (let i = 1; i < outline.length; i++) {
      const pt = outline[i]!;
      sink.lineTo(pt[0] ?? 0, pt[1] ?? 0);
    }
  } else {
    for (let i = 0; i < outline.length; i++) {
      const p0 = outline[i]!;
      const p1 = outline[(i + 1) % outline.length]!;
      sink.quadraticCurveTo(p0[0]!, p0[1]!, (p0[0]! + p1[0]!) / 2, (p0[1]! + p1[1]!) / 2);
    }
  }
  sink.closePath();
}

/**
 * Renders a closed polygon outline onto a Canvas 2D context using quadratic curves between midpoints.
 *
 * @internal
 */
export function renderStrokeOutline(g: ElementCanvasContext, outline: StrokeOutline): void {
  if (outline.length === 0) return;
  g.beginPath();
  traceStrokeOutline(g, outline);
  g.fill();
}

function toXY(p: { x: number; y: number } | readonly number[]): [number, number] {
  if (Array.isArray(p)) {
    return [p[0] ?? 0, p[1] ?? 0];
  }
  const pt = p as { x: number; y: number };
  return [pt.x ?? 0, pt.y ?? 0];
}

/**
 * Cuts a polyline stroke against an eraser segment with a given radius (BOARD-1005).
 *
 * Slices the stroke into zero, one, or more continuous pieces where points are outside
 * the eraser capsule. The boundary intersection points are precisely interpolated.
 *
 * @param points Array of stroke points `[x, y, pressure?]`.
 * @param e0 Start point of the eraser segment.
 * @param e1 End point of the eraser segment.
 * @param radius Radius of the eraser capsule.
 * @returns Array of surviving stroke point chunks.
 * @beta
 */
export function cutStrokePoints(
  points: readonly (readonly number[])[],
  e0: { x: number; y: number } | readonly number[],
  e1: { x: number; y: number } | readonly number[],
  radius: number,
): number[][][] {
  if (points.length === 0) return [];
  if (radius <= 0) return [points.map((p) => [...p])];

  const [e0x, e0y] = toXY(e0);
  const [e1x, e1y] = toXY(e1);
  const pE0 = [e0x, e0y] as const;
  const pE1 = [e1x, e1y] as const;

  // Bounding box of points
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    const x = pt[0] ?? 0;
    const y = pt[1] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const emx = Math.min(e0x, e1x) - radius;
  const emy = Math.min(e0y, e1y) - radius;
  const eMx = Math.max(e0x, e1x) + radius;
  const eMy = Math.max(e0y, e1y) + radius;

  if (maxX < emx || minX > eMx || maxY < emy || minY > eMy) {
    return [points.map((p) => [...p])];
  }

  // Single point case
  if (points.length === 1) {
    const d = distanceToSegment(points[0]!, pE0, pE1);
    if (d <= radius) return [];
    return [points.map((p) => [...p])];
  }

  // Check if any segment is within radius
  let anyHit = false;
  for (let i = 0; i + 1 < points.length; i++) {
    if (segmentDistance(points[i]!, points[i + 1]!, pE0, pE1) <= radius) {
      anyHit = true;
      break;
    }
  }
  if (!anyHit) {
    return [points.map((p) => [...p])];
  }

  // Subdivide any segments longer than step
  const step = Math.max(1, radius / 4);
  const dense: number[][] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const pA = points[i]!;
    const pB = points[i + 1]!;
    const len = Math.hypot((pB[0] ?? 0) - (pA[0] ?? 0), (pB[1] ?? 0) - (pA[1] ?? 0));
    if (len <= step) {
      dense.push([...pA]);
    } else {
      const nSteps = Math.ceil(len / step);
      for (let s = 0; s < nSteps; s++) {
        const t = s / nSteps;
        dense.push([
          (1 - t) * (pA[0] ?? 0) + t * (pB[0] ?? 0),
          (1 - t) * (pA[1] ?? 0) + t * (pB[1] ?? 0),
          (1 - t) * (pA[2] ?? 0.5) + t * (pB[2] ?? 0.5),
        ]);
      }
    }
  }
  dense.push([...points[points.length - 1]!]);

  function isInside(p: readonly number[]): boolean {
    return distanceToSegment(p, pE0, pE1) <= radius;
  }

  function findBoundary(outside: readonly number[], inside: readonly number[]): number[] {
    let outT = 0;
    let inT = 1;
    for (let iter = 0; iter < 8; iter++) {
      const midT = (outT + inT) / 2;
      const testPt = [
        (1 - midT) * (outside[0] ?? 0) + midT * (inside[0] ?? 0),
        (1 - midT) * (outside[1] ?? 0) + midT * (inside[1] ?? 0),
      ];
      if (isInside(testPt)) {
        inT = midT;
      } else {
        outT = midT;
      }
    }
    return [
      (1 - outT) * (outside[0] ?? 0) + outT * (inside[0] ?? 0),
      (1 - outT) * (outside[1] ?? 0) + outT * (inside[1] ?? 0),
      (1 - outT) * (outside[2] ?? 0.5) + outT * (inside[2] ?? 0.5),
    ];
  }

  const runs: number[][][] = [];
  let currentRun: number[][] = [];

  for (let i = 0; i < dense.length; i++) {
    const curr = dense[i]!;
    const currIn = isInside(curr);

    if (!currIn) {
      if (i > 0 && isInside(dense[i - 1]!)) {
        currentRun.push(findBoundary(curr, dense[i - 1]!));
      }
      currentRun.push(curr);
    } else {
      if (i > 0 && !isInside(dense[i - 1]!)) {
        currentRun.push(findBoundary(dense[i - 1]!, curr));
      }
      if (currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
    }
  }
  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  const result: number[][][] = [];
  for (const run of runs) {
    if (run.length === 0) continue;
    const deduped: number[][] = [];
    for (const pt of run) {
      const last = deduped[deduped.length - 1];
      if (!last || Math.hypot((pt[0] ?? 0) - (last[0] ?? 0), (pt[1] ?? 0) - (last[1] ?? 0)) > 0.05) {
        deduped.push(pt);
      }
    }
    if (deduped.length === 0) continue;
    let length = 0;
    for (let j = 0; j + 1 < deduped.length; j++) {
      length += Math.hypot(
        (deduped[j + 1]![0] ?? 0) - (deduped[j]![0] ?? 0),
        (deduped[j + 1]![1] ?? 0) - (deduped[j]![1] ?? 0),
      );
    }
    if (length < 0.5 && points.length > 2) {
      continue;
    }
    const simplified = simplifyPoints(deduped, 0.5);
    result.push(simplified);
  }
  return result;
}
