/**
 * Snapping while dragging: to the edges and centers of visible elements, and to a grid (BOARD-407).
 *
 * {@link computeSnap} is pure: it compares the snap points of the moving selection with target
 * points and returns the offset to add plus the guide lines for the overlay. {@link snapTranslation}
 * gathers those points from a board (visible elements on the same page, board snap settings, and
 * the camera zoom for the screen-pixel threshold).
 */

import type { Board } from './index.js';
import {
  resolveElementGeometry,
  snapPoints,
  toBoardTolerance,
  type Point,
  type SnapPoint,
} from './geometry.js';
import type { InputModifiers } from './tools.js';
import type { ElementRecord } from './types.js';

/**
 * Board snap settings (`createBoard({ snap })`, `board.setSnapOptions`).
 *
 * @beta
 */
export interface SnapOptions {
  /** Whether snapping is on. Ctrl/Cmd while dragging turns it off temporarily. */
  readonly enabled: boolean;
  /** Grid spacing in board units (8 = 8 screen pixels at zoom 100%), or `null` for no grid snap. */
  readonly grid: number | null;
  /** Snap distance in screen pixels; converted to board units with the camera zoom. */
  readonly threshold: number;
}

/**
 * Default snap settings: enabled, 8-unit grid, 8-pixel threshold.
 *
 * @beta
 */
export const DEFAULT_SNAP_OPTIONS: Readonly<SnapOptions> = Object.freeze({
  enabled: true,
  grid: 8,
  threshold: 8,
});

/**
 * A guide line for the overlay: a vertical line (`axis: 'x'`) at `x = position` from `y = from` to
 * `y = to`, or a horizontal line (`axis: 'y'`) at `y = position` from `x = from` to `x = to`, in
 * board coordinates.
 *
 * @beta
 */
export interface SnapGuide {
  readonly axis: 'x' | 'y';
  readonly position: number;
  readonly from: number;
  readonly to: number;
  /** What the moving points snapped to. */
  readonly source: 'element' | 'grid';
}

/**
 * Result of {@link computeSnap}: the offset to add to the moving points and the guides to draw.
 *
 * @beta
 */
export interface SnapResult {
  readonly dx: number;
  readonly dy: number;
  readonly guides: readonly SnapGuide[];
}

/**
 * Input of {@link computeSnap}, in board units.
 *
 * @beta
 */
export interface ComputeSnapOptions {
  /** Maximum snap distance in board units (see {@link toBoardTolerance}). */
  readonly threshold: number;
  /** Grid spacing in board units, or `null` for no grid. */
  readonly grid?: number | null;
}

/** Points sharing a coordinate after snapping count as aligned within this distance. */
const EPSILON = 1e-6;

/** @internal */
export function resolveSnapOptions(
  input: unknown,
  base: Readonly<SnapOptions> = DEFAULT_SNAP_OPTIONS,
): Readonly<SnapOptions> {
  if (input === undefined) return base;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Opsi snap wajib berupa objek { enabled?, grid?, threshold? }.');
  }
  const patch = input as Partial<Record<keyof SnapOptions, unknown>>;
  const enabled = patch.enabled ?? base.enabled;
  const grid = patch.grid === undefined ? base.grid : patch.grid;
  const threshold = patch.threshold ?? base.threshold;
  if (typeof enabled !== 'boolean') throw new TypeError('snap.enabled wajib berupa boolean.');
  if (grid !== null && (typeof grid !== 'number' || !Number.isFinite(grid) || grid <= 0)) {
    throw new RangeError('snap.grid wajib berupa angka positif berhingga atau null.');
  }
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
    throw new RangeError('snap.threshold wajib berupa angka berhingga dan tidak negatif.');
  }
  return Object.freeze({ enabled, grid, threshold });
}

/**
 * Whether the modifiers turn snapping off temporarily (Ctrl or Cmd held while dragging).
 *
 * @beta
 */
export function isSnapSuppressed(modifiers: InputModifiers | undefined): boolean {
  return modifiers !== undefined && (modifiers.ctrl || modifiers.meta);
}

type Axis = 'x' | 'y';
const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');

interface AxisSnap {
  readonly offset: number;
  readonly source: 'element' | 'grid' | null;
}

function snapAxis(
  axis: Axis,
  moving: readonly Point[],
  targets: readonly Point[],
  threshold: number,
  grid: number | null,
): AxisSnap {
  let best = Infinity;
  let offset = 0;
  let source: AxisSnap['source'] = null;
  for (const m of moving) {
    for (const t of targets) {
      const d = t[axis] - m[axis];
      if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(best)) {
        best = d;
        offset = d;
        source = 'element';
      }
    }
  }
  if (grid !== null) {
    for (const m of moving) {
      const d = Math.round(m[axis] / grid) * grid - m[axis];
      // Strictly closer: on a tie, aligning with an element wins over the grid.
      if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(best)) {
        best = d;
        offset = d;
        source = 'grid';
      }
    }
  }
  return { offset, source };
}

function guidesFor(
  axis: Axis,
  snap: AxisSnap,
  moved: readonly Point[],
  targets: readonly Point[],
  grid: number | null,
): SnapGuide[] {
  if (snap.source === null) return [];
  const across = other(axis);
  const lines = new Map<number, { from: number; to: number }>();
  const extend = (position: number, value: number): void => {
    const line = lines.get(position);
    if (line) {
      line.from = Math.min(line.from, value);
      line.to = Math.max(line.to, value);
    } else lines.set(position, { from: value, to: value });
  };

  if (snap.source === 'element') {
    for (const t of targets) {
      const aligned = moved.filter((m) => Math.abs(m[axis] - t[axis]) <= EPSILON);
      if (aligned.length === 0) continue;
      extend(t[axis], t[across]);
      for (const m of aligned) extend(t[axis], m[across]);
    }
  } else if (grid !== null) {
    // Only the moved points that now sit on a grid line get a grid guide.
    for (const m of moved) {
      const line = Math.round(m[axis] / grid) * grid;
      if (Math.abs(line - m[axis]) <= EPSILON) extend(line, m[across]);
    }
  }
  return [...lines].map(([position, { from, to }]) => ({
    axis,
    position,
    from,
    to,
    source: snap.source!,
  }));
}

/**
 * Snaps moving points to target points and to a grid, independently along x and y. On each axis
 * the closest candidate within `threshold` wins; on a tie an element beats the grid. The guides
 * describe every alignment after the offset is applied, for the overlay to draw.
 *
 * @beta
 */
export function computeSnap(
  moving: readonly Point[],
  targets: readonly Point[],
  options: ComputeSnapOptions,
): SnapResult {
  const threshold = Math.max(0, options.threshold);
  const grid = options.grid ?? null;
  const sx = snapAxis('x', moving, targets, threshold, grid);
  const sy = snapAxis('y', moving, targets, threshold, grid);
  const moved = moving.map((p) => ({ x: p.x + sx.offset, y: p.y + sy.offset }));
  const guides = [
    ...guidesFor('x', sx, moved, targets, grid),
    ...guidesFor('y', sy, moved, targets, grid),
  ];
  return { dx: sx.offset, dy: sy.offset, guides };
}

function elementSnapPoints(board: Board, el: Readonly<ElementRecord>, dx = 0, dy = 0): SnapPoint[] {
  const def = board.elements.get(el.type);
  const placed = dx === 0 && dy === 0 ? el : { ...el, x: el.x + dx, y: el.y + dy };
  const geometry = resolveElementGeometry(
    placed,
    def?.geometry && (() => def.geometry!(placed as never)),
  );
  return snapPoints(geometry, placed);
}

/**
 * Options for {@link snapTranslation}.
 *
 * @beta
 */
export interface SnapTranslationOptions {
  /** Modifiers of the current pointer event; Ctrl/Cmd turns snapping off. */
  readonly modifiers?: InputModifiers;
  /** Overrides the board snap settings for this call. */
  readonly snap?: Partial<SnapOptions>;
}

/**
 * Snaps a drag of `elements` by `delta` (board units) on `board`: to the snap points of the other
 * visible elements on the same page and to the grid, within the board threshold in screen pixels.
 * Returns the final delta (the input delta plus the snap offset) and the guides.
 *
 * Without a reported viewport, every element on the page counts as visible.
 *
 * @beta
 */
export function snapTranslation(
  board: Board,
  elements: readonly Readonly<ElementRecord>[],
  delta: Point,
  options: SnapTranslationOptions = {},
): { readonly delta: Point; readonly guides: readonly SnapGuide[] } {
  const settings = resolveSnapOptions(options.snap, board.snapOptions);
  if (!settings.enabled || elements.length === 0 || isSnapSuppressed(options.modifiers)) {
    return { delta: { x: delta.x, y: delta.y }, guides: [] };
  }
  const moving = elements.flatMap((el) => elementSnapPoints(board, el, delta.x, delta.y));
  const exclude = new Set(elements.map((el) => el.id));
  const viewport = board.camera.getViewportBounds();
  const visible =
    viewport.maxX > viewport.minX && viewport.maxY > viewport.minY
      ? board.query({ pageId: elements[0]!.pageId, inBounds: viewport })
      : board.query({ pageId: elements[0]!.pageId });
  const targets = visible
    .filter((el) => !exclude.has(el.id))
    .flatMap((el) => elementSnapPoints(board, el));
  const result = computeSnap(moving, targets, {
    threshold: toBoardTolerance(settings.threshold, board.camera.get().zoom),
    grid: settings.grid,
  });
  return { delta: { x: delta.x + result.dx, y: delta.y + result.dy }, guides: result.guides };
}
