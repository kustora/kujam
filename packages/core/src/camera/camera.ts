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
 *
 * Fitting and animation (BOARD-402): `zoomToBounds`, `zoomToFit`, and `zoomToSelection` move the
 * camera instantly or animate it with easing. Animation frames come from a {@link FrameScheduler}
 * (`requestAnimationFrame` by default, `setTimeout` where it is missing), so core stays DOM-free
 * and tests can drive time. Any other camera change, a new fit, or `board.dispose()` cancels a
 * running animation. With `reducedMotion` on, animations jump straight to the target.
 */

import type { CameraEvent } from '../events/events.js';
import type { Point } from '../geometry/geometry.js';
import { normalizeBounds, type Bounds, type BoxBounds } from '../geometry/spatial.js';
import type { CameraState } from '../types.js';

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
 * Source of animation frames and time for camera animations (BOARD-402). The default uses
 * `requestAnimationFrame` (or `setTimeout` at about 60 fps where it is missing) and
 * `performance.now()` (or `Date.now()`). Inject one for tests or non-browser hosts.
 *
 * @beta
 */
export interface FrameScheduler {
  /** Current time in milliseconds; only differences are used. */
  now(): number;
  /** Calls `callback` on the next frame and returns a handle for {@link FrameScheduler.cancel}. */
  request(callback: () => void): unknown;
  /** Cancels a pending frame request. */
  cancel(handle: unknown): void;
}

/**
 * Animation settings for camera moves (BOARD-402).
 *
 * @beta
 */
export interface CameraAnimation {
  /** Duration in milliseconds. Defaults to {@link DEFAULT_CAMERA_ANIMATION_MS}. */
  readonly duration?: number;
  /** Easing from progress `0..1` to `0..1`. Defaults to an ease-in-out cubic curve. */
  readonly easing?: (t: number) => number;
}

/**
 * Options for {@link BoardCamera.zoomToBounds}, {@link BoardCamera.zoomToFit}, and
 * {@link BoardCamera.zoomToSelection}.
 *
 * @beta
 */
export interface ZoomToOptions {
  /**
   * Space kept free around the bounds, in CSS pixels on each side. Defaults to
   * {@link DEFAULT_ZOOM_PADDING}. Dropped when the viewport is too small for it.
   */
  readonly padding?: number;
  /**
   * Highest zoom the fit may use, so small content is not blown up. Defaults to `1` (100%) for
   * `zoomToFit` and `zoomToSelection`, and to `zoomRange.max` for `zoomToBounds`. Always clamped
   * to {@link BoardCamera.zoomRange}.
   */
  readonly maxZoom?: number;
  /**
   * `true` animates with the default duration and easing; an object customizes them. Defaults to
   * `false` (instant). Ignored while {@link BoardCamera.reducedMotion} is on.
   */
  readonly animate?: boolean | CameraAnimation;
}

/**
 * Default camera animation duration in milliseconds.
 *
 * @beta
 */
export const DEFAULT_CAMERA_ANIMATION_MS = 300;

/**
 * Default padding around fitted bounds, in CSS pixels.
 *
 * @beta
 */
export const DEFAULT_ZOOM_PADDING = 32;

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
  /**
   * Moves the camera so `bounds` (board coordinates) fill the viewport, centered, keeping
   * `padding` free on each side (BOARD-402). A zero-size side (a point or a line) is limited only
   * by `maxZoom`.
   *
   * @returns `false` when nothing happens because the viewport size is not reported yet.
   * @throws `TypeError` when `bounds` is not a valid box, `RangeError` for invalid options.
   */
  zoomToBounds(bounds: Bounds, options?: ZoomToOptions): boolean;
  /**
   * Fits every element of the current page (BOARD-208, BOARD-402).
   *
   * @returns `false` when the page has no elements or the viewport size is not reported yet.
   */
  zoomToFit(options?: ZoomToOptions): boolean;
  /**
   * Fits the selected elements (`board.selectionBounds`, BOARD-405, BOARD-402).
   *
   * @returns `false` when nothing is selected or the viewport size is not reported yet.
   */
  zoomToSelection(options?: ZoomToOptions): boolean;
  /** Whether a camera animation is running. */
  readonly animating: boolean;
  /** Stops a running animation where it is. No effect when nothing is animating. */
  stopAnimation(): void;
  /**
   * Whether animations are off; camera moves then jump straight to the target. The renderer sets it
   * from `prefers-reduced-motion` (BOARD-1905). Defaults to `createBoard({ reducedMotion })`.
   */
  readonly reducedMotion: boolean;
  /**
   * Turns reduced motion on or off. Turning it on finishes a running animation immediately.
   *
   * @throws `TypeError` when `value` is not a boolean.
   */
  setReducedMotion(value: boolean): void;
}

/** @internal */
export interface CameraOptions {
  zoomRange: Readonly<ZoomRange>;
  onChange(event: CameraEvent): void;
  /** Bounds of every element on the current page, or `null` when there are none. */
  getContentBounds(): BoxBounds | null;
  /** Bounds of the selection, or `null` when nothing is selected. */
  getSelectionBounds(): BoxBounds | null;
  scheduler?: FrameScheduler;
  reducedMotion?: boolean;
}

/** @internal Camera plus the board-only teardown. */
export interface CameraRuntime extends BoardCamera {
  /** Cancels a running animation; called by `board.dispose()`. */
  dispose(): void;
}

/** Ease-in-out cubic. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Default frame scheduler, read defensively from `globalThis` (Node, Worker, browser). */
function defaultScheduler(): FrameScheduler {
  const g = globalThis as {
    requestAnimationFrame?: (cb: () => void) => unknown;
    cancelAnimationFrame?: (handle: unknown) => void;
    performance?: { now(): number };
    setTimeout?: (cb: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };
  const now = (): number =>
    typeof g.performance?.now === 'function' ? g.performance.now() : Date.now();
  if (typeof g.requestAnimationFrame === 'function') {
    const raf = g.requestAnimationFrame;
    return {
      now,
      request: (cb) => raf.call(globalThis, cb),
      cancel: (handle) => g.cancelAnimationFrame?.call(globalThis, handle),
    };
  }
  return {
    now,
    request: (cb) => g.setTimeout?.call(globalThis, cb, 16),
    cancel: (handle) => g.clearTimeout?.call(globalThis, handle),
  };
}

/** @internal */
export function resolveFrameScheduler(value: unknown): FrameScheduler | undefined {
  if (value === undefined) return undefined;
  const s = value as Partial<FrameScheduler> | null;
  if (
    typeof s !== 'object' ||
    s === null ||
    typeof s.now !== 'function' ||
    typeof s.request !== 'function' ||
    typeof s.cancel !== 'function'
  ) {
    throw new TypeError(
      'Opsi frameScheduler wajib berupa objek dengan method now, request, dan cancel.',
    );
  }
  return s as FrameScheduler;
}

function resolveAnimation(
  value: boolean | CameraAnimation | undefined,
): Required<CameraAnimation> | null {
  if (value === undefined || value === false) return null;
  if (value === true) return { duration: DEFAULT_CAMERA_ANIMATION_MS, easing: easeInOutCubic };
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Opsi animate wajib berupa boolean atau objek { duration, easing }.');
  }
  const duration = value.duration ?? DEFAULT_CAMERA_ANIMATION_MS;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('Opsi animate.duration wajib berupa angka berhingga >= 0.');
  }
  const easing = value.easing ?? easeInOutCubic;
  if (typeof easing !== 'function') {
    throw new TypeError('Opsi animate.easing wajib berupa fungsi.');
  }
  return { duration, easing };
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
export function createCamera(options: CameraOptions): CameraRuntime {
  const { zoomRange } = options;
  let state: Readonly<CameraState> = Object.freeze({ x: 0, y: 0, zoom: 1 });
  let viewport: Readonly<ViewportSize> = Object.freeze({ width: 0, height: 0 });
  let reducedMotion = options.reducedMotion === true;
  let scheduler: FrameScheduler | undefined = options.scheduler;
  /** Running animation: its pending frame handle and a function that jumps to the target. */
  let animation: { handle: unknown; finish(): void } | null = null;

  const clampZoom = (zoom: number): number =>
    Math.min(zoomRange.max, Math.max(zoomRange.min, zoom));

  function stopAnimation(): void {
    if (!animation) return;
    scheduler!.cancel(animation.handle);
    animation = null;
  }

  /** Public `set`: a camera change from outside cancels a running animation. */
  function set(patch: Partial<CameraState>): void {
    stopAnimation();
    apply(patch);
  }

  function apply(patch: Partial<CameraState>): void {
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
    zoomToBounds(bounds, zoomOptions) {
      return fit(normalizeBounds(bounds), zoomOptions, zoomRange.max);
    },
    zoomToFit(zoomOptions) {
      return fit(options.getContentBounds(), zoomOptions, 1);
    },
    zoomToSelection(zoomOptions) {
      return fit(options.getSelectionBounds(), zoomOptions, 1);
    },
    get animating() {
      return animation !== null;
    },
    stopAnimation,
    get reducedMotion() {
      return reducedMotion;
    },
    setReducedMotion(value) {
      if (typeof value !== 'boolean') {
        throw new TypeError('Argumen setReducedMotion wajib berupa boolean.');
      }
      reducedMotion = value;
      if (value && animation) {
        const { finish } = animation;
        stopAnimation();
        finish();
      }
    },
    dispose: stopAnimation,
  };

  /** Camera that shows `bounds` centered with padding, or `null` when the viewport is unknown. */
  function fitTarget(
    bounds: BoxBounds,
    zoomOptions: ZoomToOptions | undefined,
    defaultMaxZoom: number,
  ): CameraState | null {
    const padding = zoomOptions?.padding ?? DEFAULT_ZOOM_PADDING;
    if (typeof padding !== 'number' || !Number.isFinite(padding) || padding < 0) {
      throw new RangeError('Opsi padding wajib berupa angka berhingga >= 0.');
    }
    const maxZoom = zoomOptions?.maxZoom ?? defaultMaxZoom;
    if (typeof maxZoom !== 'number' || !Number.isFinite(maxZoom) || maxZoom <= 0) {
      throw new RangeError('Opsi maxZoom wajib berupa angka berhingga > 0.');
    }
    const { width, height } = viewport;
    if (width <= 0 || height <= 0) return null;
    // Drop the padding when the viewport is too small for it, rather than zooming to nothing.
    const usableW = width - 2 * padding > 0 ? width - 2 * padding : width;
    const usableH = height - 2 * padding > 0 ? height - 2 * padding : height;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    const zoom = clampZoom(
      Math.min(maxZoom, bw > 0 ? usableW / bw : Infinity, bh > 0 ? usableH / bh : Infinity),
    );
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    return { x: cx - width / 2 / zoom, y: cy - height / 2 / zoom, zoom };
  }

  function fit(
    bounds: BoxBounds | null,
    zoomOptions: ZoomToOptions | undefined,
    defaultMaxZoom: number,
  ): boolean {
    if (zoomOptions !== undefined && (typeof zoomOptions !== 'object' || zoomOptions === null)) {
      throw new TypeError('Opsi zoom wajib berupa objek.');
    }
    const anim = resolveAnimation(zoomOptions?.animate);
    if (!bounds) return false;
    const target = fitTarget(bounds, zoomOptions, defaultMaxZoom);
    if (!target) return false;
    if (!anim || reducedMotion || anim.duration === 0) set(target);
    else animateTo(target, anim);
    return true;
  }

  function animateTo(target: CameraState, anim: Required<CameraAnimation>): void {
    stopAnimation();
    const frames = (scheduler ??= defaultScheduler());
    const from = state;
    // Interpolate the viewport center linearly and the zoom geometrically, so zooming feels even.
    const halfW = viewport.width / 2;
    const halfH = viewport.height / 2;
    const fromCenter = { x: from.x + halfW / from.zoom, y: from.y + halfH / from.zoom };
    const toCenter = { x: target.x + halfW / target.zoom, y: target.y + halfH / target.zoom };
    const start = frames.now();
    const finish = (): void => apply(target);
    const step = (): void => {
      // A frame from a cancelled or replaced animation (schedulers may not cancel reliably).
      if (animation?.finish !== finish) return;
      const t = Math.min(1, Math.max(0, (frames.now() - start) / anim.duration));
      if (t >= 1) {
        animation = null;
        finish();
        return;
      }
      const e = anim.easing(t);
      const zoom = from.zoom * (target.zoom / from.zoom) ** e;
      apply({
        x: fromCenter.x + (toCenter.x - fromCenter.x) * e - halfW / zoom,
        y: fromCenter.y + (toCenter.y - fromCenter.y) * e - halfH / zoom,
        zoom,
      });
      animation = { handle: frames.request(step), finish };
    };
    animation = { handle: frames.request(step), finish };
  }
}
