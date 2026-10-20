/**
 * Pure element transforms: move, resize with the 8 handles, and rotate (BOARD-406).
 *
 * Every function takes element records (usually a snapshot taken when the drag started) and
 * returns new placements without touching the board, so tools can recompute from the start
 * snapshot on every pointer move and apply the result inside `ctx.change`.
 *
 * - One element is resized in its own (rotated) frame: the handle opposite the dragged one stays
 *   fixed on the board.
 * - Several elements are resized through the axis-aligned bounds of the selection: each element
 *   center is scaled from the fixed handle, and each size follows the element's resize mode.
 * - Resizing past zero flips the box: the result reports `flipX`/`flipY` so the caller can mirror
 *   type-specific content (for example stroke points).
 */

import type { ElementResize, ElementSize } from '../elements/elements.js';
import {
  localToBoard,
  resolveElementGeometry,
  rotatePoint,
  type ElementTransform,
  type Geometry,
  type Point,
} from './geometry.js';
import { computeElementAABB, type BoxBounds } from './spatial.js';
import type { ElementRecord } from '../types.js';

/**
 * One of the 8 resize handles, by compass direction in the element's frame (`n` is the top edge).
 *
 * @beta
 */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * All resize handles, clockwise from the top-left corner.
 *
 * @beta
 */
export const RESIZE_HANDLES: readonly ResizeHandle[] = Object.freeze([
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]);

/**
 * Rotation step used when Shift is held while rotating.
 *
 * @beta
 */
export const ROTATION_SNAP_DEGREES = 15;

/**
 * Minimum element size used when an element type declares no `minSize`.
 *
 * @beta
 */
export const DEFAULT_MIN_SIZE: Readonly<ElementSize> = Object.freeze({ w: 1, h: 1 });

/** Direction of each handle along x and y: -1 left/top, 0 middle, 1 right/bottom. */
const HANDLE_DIRECTION: Readonly<Record<ResizeHandle, readonly [number, number]>> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

/**
 * Per-type transform behavior, usually read from the element definition. Pass a registry
 * (`board.elements`) as {@link TransformOptions.registry}; unregistered types resize freely.
 *
 * @beta
 */
export interface TransformBehavior {
  /** Element definition fields used by transforms. */
  get(type: string):
    | {
        readonly resize?: ElementResize<never>;
        readonly minSize?: ElementSize;
        geometry?(el: never): Geometry;
      }
    | undefined;
}

/**
 * Options shared by the transform functions.
 *
 * @beta
 */
export interface TransformOptions {
  /** Source of resize modes, minimum sizes, and geometry; usually `board.elements`. */
  readonly registry?: TransformBehavior;
}

/**
 * Options for {@link resizeElements}.
 *
 * @beta
 */
export interface ResizeOptions extends TransformOptions {
  /** Keep the aspect ratio (Shift). Edge handles then scale the other axis around its center. */
  readonly keepRatio?: boolean;
}

/**
 * Options for {@link rotateElements}.
 *
 * @beta
 */
export interface RotateOptions extends TransformOptions {
  /**
   * Snap step in degrees (Shift: {@link ROTATION_SNAP_DEGREES}). One element snaps its absolute
   * rotation; several elements snap the rotation delta. `0` or omitted disables snapping.
   */
  readonly snap?: number;
  /** Rotation center; defaults to the center of the selection frame. */
  readonly center?: Point;
}

/**
 * New placement of one element produced by a transform.
 *
 * @beta
 */
export interface TransformResult {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Rotation in degrees, normalized to `[0, 360)`. */
  readonly rotation: number;
  /** The element was mirrored along its own x axis (resized past zero horizontally). */
  readonly flipX: boolean;
  /** The element was mirrored along its own y axis (resized past zero vertically). */
  readonly flipY: boolean;
}

/**
 * A handle position for hit-testing and drawing the selection overlay.
 *
 * @beta
 */
export interface TransformHandlePoint extends Point {
  readonly handle: ResizeHandle | 'rotate';
}

/**
 * Side of an element a quick-connect handle sits on, in the element's own (unrotated) frame.
 *
 * @beta
 */
export type QuickConnectSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * A quick-connect handle: a dot outside the middle of one side of the selected element, from which
 * a connector can be dragged.
 *
 * @beta
 */
export interface QuickConnectHandle extends Point {
  readonly side: QuickConnectSide;
}

/**
 * Distance of the quick-connect handles from the element's sides, in screen pixels. Larger than
 * the rotate handle offset (24 px), so the top handle stays clear of it.
 *
 * @beta
 */
export const QUICK_CONNECT_OFFSET_PX = 40;

/**
 * Board positions of the four quick-connect handles of a frame, `offset` board units outside the
 * middle of each side (in the frame's rotated directions).
 *
 * @beta
 */
export function quickConnectHandles(frame: ElementTransform, offset: number): QuickConnectHandle[] {
  const { w, h } = frame;
  const local: Record<QuickConnectSide, Point> = {
    top: { x: w / 2, y: -offset },
    right: { x: w + offset, y: h / 2 },
    bottom: { x: w / 2, y: h + offset },
    left: { x: -offset, y: h / 2 },
  };
  return (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    side,
    ...localToBoard(frame, local[side]),
  }));
}

/**
 * A draggable segment of an orthogonal (elbow) path: its index (`points[index]` to
 * `points[index + 1]`), the axis it moves along, and its midpoint.
 *
 * @beta
 */
export interface SegmentHandle extends Point {
  /** Index of the segment's first point in the path. */
  readonly index: number;
  /** `x` for a vertical segment (dragged sideways), `y` for a horizontal one. */
  readonly axis: 'x' | 'y';
}

/**
 * Handles of the segments of an orthogonal path that can be dragged: the inner segments when the
 * path has stubs at both ends (4 or more points), otherwise every segment. Diagonal and very short
 * segments get none.
 *
 * @beta
 */
export function segmentHandles(points: readonly Point[], minLength = 8): SegmentHandle[] {
  const n = points.length;
  if (n < 2) return [];
  const first = n >= 4 ? 1 : 0;
  const last = n >= 4 ? n - 3 : n - 2;
  const out: SegmentHandle[] = [];
  for (let i = first; i <= last; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const vertical = Math.abs(a.x - b.x) < 1e-6;
    const horizontal = Math.abs(a.y - b.y) < 1e-6;
    if (vertical === horizontal) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) < minLength) continue;
    out.push({ index: i, axis: vertical ? 'x' : 'y', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

/** Normalizes degrees to `[0, 360)` without returning `-0`. */
function normalizeRotation(degrees: number): number {
  const r = ((degrees % 360) + 360) % 360;
  return r === 0 || Object.is(r, -0) ? 0 : r;
}

function unchanged(el: Readonly<ElementRecord>): TransformResult {
  return {
    id: el.id,
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    rotation: normalizeRotation(el.rotation ?? 0),
    flipX: false,
    flipY: false,
  };
}

function behaviorOf(el: Readonly<ElementRecord>, options: TransformOptions) {
  const def = options.registry?.get(el.type);
  const resize = (def?.resize ?? 'free') as ElementResize<unknown>;
  const min = def?.minSize ?? DEFAULT_MIN_SIZE;
  return { resize, min, def };
}

/** Applies a custom resize function and the minimum size to an absolute proposed size. */
function finalizeSize(
  el: Readonly<ElementRecord>,
  proposed: ElementSize,
  options: TransformOptions,
): ElementSize {
  const { resize, min } = behaviorOf(el, options);
  let size = proposed;
  if (typeof resize === 'function') {
    const custom = resize(el as ElementRecord<unknown>, proposed);
    if (Number.isFinite(custom?.w) && Number.isFinite(custom?.h)) {
      size = { w: Math.abs(custom.w), h: Math.abs(custom.h) };
    }
  }
  return { w: Math.max(size.w, min.w), h: Math.max(size.h, min.h) };
}

/**
 * Frame the selection is transformed through: the element itself (with its rotation) for a single
 * element, otherwise the axis-aligned bounds of all elements (including their geometry and
 * rotation). Handles are placed on this frame.
 *
 * @beta
 */
export function selectionFrame(
  elements: readonly Readonly<ElementRecord>[],
  options: TransformOptions = {},
): ElementTransform | null {
  if (elements.length === 0) return null;
  if (elements.length === 1) {
    const el = elements[0]!;
    return { x: el.x, y: el.y, w: el.w, h: el.h, rotation: normalizeRotation(el.rotation ?? 0) };
  }
  const b = boundsOf(elements, options);
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY, rotation: 0 };
}

function boundsOf(
  elements: readonly Readonly<ElementRecord>[],
  options: TransformOptions,
): BoxBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const def = options.registry?.get(el.type);
    const b = computeElementAABB(el as ElementRecord, (e) =>
      resolveElementGeometry(e, def?.geometry && (() => def.geometry!(e as never))),
    );
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Board positions of the 8 resize handles and the rotate handle of a frame. The rotate handle sits
 * `rotateOffset` board units above the top edge (in the frame's rotated "up" direction).
 *
 * @beta
 */
export function transformHandles(
  frame: ElementTransform,
  rotateOffset = 0,
): TransformHandlePoint[] {
  const points: TransformHandlePoint[] = RESIZE_HANDLES.map((handle) => {
    const [dx, dy] = HANDLE_DIRECTION[handle];
    const local = { x: ((dx + 1) / 2) * frame.w, y: ((dy + 1) / 2) * frame.h };
    return { handle, ...localToBoard(frame, local) };
  });
  points.push({ handle: 'rotate', ...localToBoard(frame, { x: frame.w / 2, y: -rotateOffset }) });
  return points;
}

/**
 * Moves elements by `dx, dy` board units.
 *
 * @beta
 */
export function moveElements(
  elements: readonly Readonly<ElementRecord>[],
  dx: number,
  dy: number,
): TransformResult[] {
  return elements.map((el) => ({ ...unchanged(el), x: el.x + dx, y: el.y + dy }));
}

/** Signed resize of a `w × h` box in its local frame; negative sizes mean flipped. */
function resizeBox(
  w: number,
  h: number,
  handle: ResizeHandle,
  delta: Point,
  keepRatio: boolean,
): { sw: number; sh: number } {
  const [hx, hy] = HANDLE_DIRECTION[handle];
  let sw = hx === 0 ? w : w + hx * delta.x;
  let sh = hy === 0 ? h : h + hy * delta.y;
  if (keepRatio && w > 0 && h > 0) {
    const rx = sw / w;
    const ry = sh / h;
    if (hx !== 0 && hy !== 0) {
      const s = Math.max(Math.abs(rx), Math.abs(ry));
      sw = Math.sign(rx || 1) * s * w;
      sh = Math.sign(ry || 1) * s * h;
    } else if (hx !== 0) {
      sh = Math.abs(rx) * h;
    } else {
      sw = Math.abs(ry) * w;
    }
  }
  return { sw, sh };
}

/**
 * Places an absolute size along one axis of a `length`-long frame, keeping the edge opposite the
 * handle fixed (or the middle for an axis the handle does not move). Returns the new start.
 */
function placeAxis(length: number, dir: number, size: number, flipped: boolean): number {
  if (dir === 1) return flipped ? -size : 0;
  if (dir === -1) return flipped ? length : length - size;
  return (length - size) / 2;
}

/**
 * Resizes elements by dragging `handle` from `start` to `current` (board coordinates).
 *
 * One element is resized in its own rotated frame; several are scaled through their common
 * axis-aligned frame. Each element follows its type's `resize` mode (`free`, `fixed-ratio`,
 * `none`, or a custom function) and `minSize` (default {@link DEFAULT_MIN_SIZE}). Dragging past
 * the opposite edge flips the box, reported as `flipX`/`flipY`.
 *
 * In a multi-element resize, elements rotated by a multiple of 90 degrees scale along the matching
 * axes; other rotations scale uniformly by the geometric mean of both factors, since a rotated box
 * cannot be stretched along the board axes and stay a box.
 *
 * @beta
 */
export function resizeElements(
  elements: readonly Readonly<ElementRecord>[],
  handle: ResizeHandle,
  start: Point,
  current: Point,
  options: ResizeOptions = {},
): TransformResult[] {
  if (!(handle in HANDLE_DIRECTION)) {
    throw new TypeError(`Handle resize "${String(handle)}" tidak dikenal.`);
  }
  const frame = selectionFrame(elements, options);
  if (!frame) return [];
  const [hx, hy] = HANDLE_DIRECTION[handle];
  const rotation = frame.rotation ?? 0;
  // Pointer movement expressed in the frame's own axes.
  const delta = rotatePoint(
    { x: current.x - start.x, y: current.y - start.y },
    { x: 0, y: 0 },
    -rotation,
  );

  if (elements.length === 1) {
    const el = elements[0]!;
    const { resize } = behaviorOf(el, options);
    if (resize === 'none') return [unchanged(el)];
    const keepRatio = options.keepRatio === true || resize === 'fixed-ratio';
    const { sw, sh } = resizeBox(el.w, el.h, handle, delta, keepRatio);
    const size = finalizeSize(el, { w: Math.abs(sw), h: Math.abs(sh) }, options);
    const flipX = sw < 0;
    const flipY = sh < 0;
    const lx = placeAxis(el.w, hx, size.w, flipX);
    const ly = placeAxis(el.h, hy, size.h, flipY);
    const center = localToBoard(el, { x: lx + size.w / 2, y: ly + size.h / 2 });
    return [
      {
        id: el.id,
        x: center.x - size.w / 2,
        y: center.y - size.h / 2,
        w: size.w,
        h: size.h,
        rotation: normalizeRotation(rotation),
        flipX,
        flipY,
      },
    ];
  }

  const { sw, sh } = resizeBox(frame.w, frame.h, handle, delta, options.keepRatio === true);
  const flipX = sw < 0;
  const flipY = sh < 0;
  const scaleX = frame.w > 0 ? Math.abs(sw) / frame.w : 1;
  const scaleY = frame.h > 0 ? Math.abs(sh) / frame.h : 1;
  const left = frame.x + placeAxis(frame.w, hx, Math.abs(sw), flipX);
  const top = frame.y + placeAxis(frame.h, hy, Math.abs(sh), flipY);
  const newW = Math.abs(sw);
  const newH = Math.abs(sh);
  const mapX = (x: number): number => {
    const t = (x - frame.x) * scaleX;
    return flipX ? left + newW - t : left + t;
  };
  const mapY = (y: number): number => {
    const t = (y - frame.y) * scaleY;
    return flipY ? top + newH - t : top + t;
  };

  return elements.map((el) => {
    const { resize } = behaviorOf(el, options);
    const r = normalizeRotation(el.rotation ?? 0);
    const center = { x: mapX(el.x + el.w / 2), y: mapY(el.y + el.h / 2) };
    let proposed: ElementSize;
    if (resize === 'none') {
      proposed = { w: el.w, h: el.h };
    } else if (resize === 'fixed-ratio') {
      const s = hx !== 0 && hy !== 0 ? Math.max(scaleX, scaleY) : hx !== 0 ? scaleX : scaleY;
      proposed = { w: el.w * s, h: el.h * s };
    } else if (r % 180 === 0) {
      proposed = { w: el.w * scaleX, h: el.h * scaleY };
    } else if (r % 90 === 0) {
      proposed = { w: el.w * scaleY, h: el.h * scaleX };
    } else {
      const s = Math.sqrt(scaleX * scaleY);
      proposed = { w: el.w * s, h: el.h * s };
    }
    const size = resize === 'none' ? proposed : finalizeSize(el, proposed, options);
    // A board-axis mirror of a rotated element is a local mirror with the rotation negated.
    const oneFlip = flipX !== flipY;
    return {
      id: el.id,
      x: center.x - size.w / 2,
      y: center.y - size.h / 2,
      w: size.w,
      h: size.h,
      rotation: normalizeRotation(oneFlip ? -r : r),
      flipX: resize === 'none' ? false : flipX,
      flipY: resize === 'none' ? false : flipY,
    };
  });
}

/**
 * Rotates elements around `options.center` (default: the selection frame center) by the angle the
 * pointer swept from `start` to `current` (board coordinates). Element centers orbit the rotation
 * center and each element's rotation grows by the same angle.
 *
 * @beta
 */
export function rotateElements(
  elements: readonly Readonly<ElementRecord>[],
  start: Point,
  current: Point,
  options: RotateOptions = {},
): TransformResult[] {
  const frame = selectionFrame(elements, options);
  if (!frame) return [];
  const center = options.center ?? localToBoard(frame, { x: frame.w / 2, y: frame.h / 2 });
  const angle = (p: Point): number => (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
  let delta = angle(current) - angle(start);
  const step = options.snap ?? 0;
  if (step > 0) {
    if (elements.length === 1) {
      const r0 = elements[0]!.rotation ?? 0;
      delta = Math.round((r0 + delta) / step) * step - r0;
    } else {
      delta = Math.round(delta / step) * step;
    }
  }
  return elements.map((el) => {
    const c = rotatePoint({ x: el.x + el.w / 2, y: el.y + el.h / 2 }, center, delta);
    return {
      id: el.id,
      x: c.x - el.w / 2,
      y: c.y - el.h / 2,
      w: el.w,
      h: el.h,
      rotation: normalizeRotation((el.rotation ?? 0) + delta),
      flipX: false,
      flipY: false,
    };
  });
}
