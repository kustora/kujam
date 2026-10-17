/**
 * Freehand stroke utilities (BOARD-1002): Ramer-Douglas-Peucker simplification,
 * point chunking for strokes exceeding MAX_DRAW_POINTS, and outline drawing.
 */

import type { BrushDefinition, ElementCanvasContext } from '@kujam/core';
import { MAX_DRAW_POINTS } from './draw.js';

/**
 * Calculates perpendicular distance from a point to a line segment.
 */
function distanceToSegment(
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
 * Renders a closed polygon outline onto a Canvas 2D context using quadratic curves between midpoints.
 *
 * @internal
 */
export function renderStrokeOutline(
  g: ElementCanvasContext,
  outline: readonly (readonly [number, number])[] | readonly number[][],
): void {
  if (outline.length === 0) return;

  const first = outline[0];
  if (!first) return;

  g.beginPath();
  if (outline.length < 3) {
    g.moveTo(first[0] ?? 0, first[1] ?? 0);
    for (let i = 1; i < outline.length; i++) {
      const pt = outline[i];
      if (pt) g.lineTo(pt[0] ?? 0, pt[1] ?? 0);
    }
  } else {
    g.moveTo(first[0] ?? 0, first[1] ?? 0);
    for (let i = 0; i < outline.length; i++) {
      const p0 = outline[i]!;
      const p1 = outline[(i + 1) % outline.length]!;
      const midX = (p0[0]! + p1[0]!) / 2;
      const midY = (p0[1]! + p1[1]!) / 2;
      g.quadraticCurveTo(p0[0]!, p0[1]!, midX, midY);
    }
  }
  g.closePath();
  g.fill();
}
