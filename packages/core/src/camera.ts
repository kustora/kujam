/**
 * Camera: position, zoom, viewport, and coordinate conversion (BOARD-401).
 *
 * Coordinate model: `x` and `y` are the board point shown at the top-left corner of the viewport,
 * and `zoom` is the number of CSS pixels per board unit. Screen points are CSS pixels relative to
 * the board container (the same space as `BoardPointerEvent.screen`):
 *
 * - `screen = (board - camera) * zoom`
 * - `board = screen / zoom + camera`
 *
 * The camera is local UI state like the selection: it is not part of the document, is not saved,
 * and is not recorded in undo history. Core never measures the DOM; the renderer reports the
 * viewport size with {@link BoardCamera.setViewport}.
 */

import type { CameraEvent } from './events.js';
import type { Point } from './geometry.js';
import type { BoxBounds } from './spatial.js';
import type { CameraState } from './types.js';

/**
 * Camera zoom bounds.
 *
 * @public
 */
export interface ZoomRange {
  min: number;
  max: number;
}

/**
 * Default zoom bounds: 10% to 400%.
 *
 * @public
 */
export const DEFAULT_ZOOM_RANGE: Readonly<ZoomRange> = Object.freeze({ min: 0.1, max: 4 });

/**
 * Size of the visible board area in CSS pixels, reported by the renderer.
 *
 * @beta
 */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Camera API of a board (`board.camera`, BOARD-401).
 *
 * @beta
 */
export interface BoardCamera {
  /** Frozen camera snapshot; the same object until the camera changes. */
  get(): Readonly<CameraState>;
  /**
   * Changes the camera. Non-finite values are ignored, and zoom is clamped to {@link BoardCamera.zoomRange}.
   * Emits a `camera` event only when the camera actually changes.
   */
  set(patch: Partial<CameraState>): void;
  /** Zoom bounds in use (from `createBoard({ zoomRange })`, defaults to {@link DEFAULT_ZOOM_RANGE}). */
  readonly zoomRange: Readonly<ZoomRange>;
  /** Current viewport size; `{ width: 0, height: 0 }` until the renderer reports it. */
  readonly viewport: Readonly<ViewportSize>;
  /**
   * Reports the viewport size in CSS pixels. Called by the renderer on mount and on resize.
   * Does not move the camera and does not emit a `camera` event.
   *
   * @throws `RangeError` when `width` or `height` is not a finite number `>= 0`.
   */
  setViewport(size: ViewportSize): void;
  /** Converts a screen point (CSS pixels relative to the board container) to board coordinates. */
  screenToBoard(point: Point): Point;
  /** Converts a board point to a screen point (CSS pixels relative to the board container). */
  boardToScreen(point: Point): Point;
  /** Board area currently visible in the viewport. Empty (zero size) until the viewport is reported. */
  getViewportBounds(): BoxBounds;
  /**
   * Sets the zoom while keeping the board point under `anchor` fixed on screen, for example the
   * cursor for wheel zoom or the pinch center. `anchor` is a screen point and defaults to the
   * viewport center. The zoom is clamped to {@link BoardCamera.zoomRange}.
   */
  zoomTo(zoom: number, anchor?: Point): void;
  /**
   * Multiplies the zoom by `factor` around `anchor` (see {@link BoardCamera.zoomTo}). Suited to
   * pinch gestures, whose `scale` is relative to the previous event.
   */
  zoomBy(factor: number, anchor?: Point): void;
}

/** @internal */
export interface CameraOptions {
  zoomRange: Readonly<ZoomRange>;
  onChange(event: CameraEvent): void;
}

/** @internal */
export function resolveZoomRange(range: ZoomRange | undefined): Readonly<ZoomRange> {
  if (!range) return DEFAULT_ZOOM_RANGE;
  const { min, max } = range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
    throw new RangeError('zoomRange wajib berisi angka berhingga dengan 0 < min <= max.');
  }
  return Object.freeze({ min, max });
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isFinite((value as Point).x) &&
    Number.isFinite((value as Point).y)
  );
}

function assertPoint(value: unknown, method: string): asserts value is Point {
  if (!isPoint(value)) {
    throw new TypeError(`Argumen ${method} wajib berupa titik { x, y } dengan angka berhingga.`);
  }
}

/** @internal */
export function createCamera(options: CameraOptions): BoardCamera {
  const { zoomRange } = options;
  let state: Readonly<CameraState> = Object.freeze({ x: 0, y: 0, zoom: 1 });
  let viewport: Readonly<ViewportSize> = Object.freeze({ width: 0, height: 0 });

  const clampZoom = (zoom: number): number =>
    Math.min(zoomRange.max, Math.max(zoomRange.min, zoom));

  function set(patch: Partial<CameraState>): void {
    const pick = (next: number | undefined, prev: number): number =>
      next !== undefined && Number.isFinite(next) ? next : prev;
    const previous = state;
    const x = pick(patch.x, previous.x);
    const y = pick(patch.y, previous.y);
    const zoom = clampZoom(pick(patch.zoom, previous.zoom));
    if (x === previous.x && y === previous.y && zoom === previous.zoom) return;
    state = Object.freeze({ x, y, zoom });
    options.onChange(Object.freeze({ camera: state, previous }));
  }

  function zoomTo(zoom: number, anchor?: Point): void {
    if (!Number.isFinite(zoom)) return;
    if (anchor !== undefined) assertPoint(anchor, 'anchor');
    const screen = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
    const next = clampZoom(zoom);
    // The board point under the anchor stays under it: board = screen / zoom + camera.
    set({
      x: state.x + screen.x / state.zoom - screen.x / next,
      y: state.y + screen.y / state.zoom - screen.y / next,
      zoom: next,
    });
  }

  return {
    get: () => state,
    set,
    zoomRange,
    get viewport() {
      return viewport;
    },
    setViewport(size) {
      const width = (size as ViewportSize | null)?.width;
      const height = (size as ViewportSize | null)?.height;
      if (
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < 0 ||
        height < 0
      ) {
        throw new RangeError('Ukuran viewport wajib berisi width dan height berhingga >= 0.');
      }
      if (width === viewport.width && height === viewport.height) return;
      viewport = Object.freeze({ width, height });
    },
    screenToBoard(point) {
      assertPoint(point, 'screenToBoard');
      return Object.freeze({
        x: point.x / state.zoom + state.x,
        y: point.y / state.zoom + state.y,
      });
    },
    boardToScreen(point) {
      assertPoint(point, 'boardToScreen');
      return Object.freeze({
        x: (point.x - state.x) * state.zoom,
        y: (point.y - state.y) * state.zoom,
      });
    },
    getViewportBounds() {
      return Object.freeze({
        minX: state.x,
        minY: state.y,
        maxX: state.x + viewport.width / state.zoom,
        maxY: state.y + viewport.height / state.zoom,
      });
    },
    zoomTo,
    zoomBy(factor, anchor) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      zoomTo(state.zoom * factor, anchor);
    },
  };
}
