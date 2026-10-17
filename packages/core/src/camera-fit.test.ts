import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  DEFAULT_CAMERA_ANIMATION_MS,
  DEFAULT_ZOOM_PADDING,
  defineElement,
  definePlugin,
  object,
  string,
  type CameraEvent,
  type CreateBoardOptions,
  type FrameScheduler,
} from './index.js';

const box = defineElement({
  type: 'box',
  version: 1,
  props: object({ label: string() }),
  defaults: { label: '' },
});
const boxes = definePlugin({ id: 'boxes', elements: [box] });

/** Scheduler driven by hand: `advance(ms)` moves time and runs the pending frames. */
function manualScheduler() {
  let time = 0;
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const scheduler: FrameScheduler = {
    now: () => time,
    request(callback) {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => pending.delete(handle as number),
  };
  return {
    scheduler,
    advance(ms: number) {
      time += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    get pending() {
      return pending.size;
    },
  };
}

function setup(options: CreateBoardOptions = {}) {
  const board = createBoard({ plugins: [boxes], ...options });
  board.camera.setViewport({ width: 1000, height: 800 });
  const events: CameraEvent[] = [];
  board.on('camera', (e) => events.push(e));
  return { board, camera: board.camera, events };
}

const linear = (t: number): number => t;

describe('BOARD-402: zoomToBounds', () => {
  it('fills the viewport with the bounds, centered, limited by the tighter axis', () => {
    const { camera } = setup();
    expect(camera.zoomToBounds({ minX: 0, minY: 0, maxX: 500, maxY: 200 }, { padding: 0 })).toBe(
      true,
    );
    // min(1000 / 500, 800 / 200) = 2; center (250, 100) at the viewport center (500, 400).
    expect(camera.get()).toEqual({ x: 0, y: -100, zoom: 2 });
  });

  it('keeps the default padding free on each side', () => {
    const { camera } = setup();
    camera.zoomToBounds({ minX: 0, minY: 0, maxX: 500, maxY: 200 });
    const { zoom } = camera.get();
    expect(zoom).toBeCloseTo((1000 - 2 * DEFAULT_ZOOM_PADDING) / 500);
    const left = camera.boardToScreen({ x: 0, y: 0 });
    const right = camera.boardToScreen({ x: 500, y: 200 });
    expect(left.x).toBeCloseTo(DEFAULT_ZOOM_PADDING);
    expect(1000 - right.x).toBeCloseTo(DEFAULT_ZOOM_PADDING);
  });

  it('accepts { x, y, w, h } bounds and respects maxZoom and the zoom range', () => {
    const { camera } = setup();
    camera.zoomToBounds({ x: 0, y: 0, w: 10, h: 10 }, { maxZoom: 1.5 });
    expect(camera.get().zoom).toBe(1.5);
    // Without maxZoom the zoom range (400%) is the only limit.
    camera.zoomToBounds({ x: 0, y: 0, w: 10, h: 10 });
    expect(camera.get().zoom).toBe(4);
    camera.zoomToBounds({ x: 0, y: 0, w: 1e6, h: 1e6 });
    expect(camera.get().zoom).toBe(0.1);
  });

  it('centers a point or a line using maxZoom for the zero-size axis', () => {
    const { camera } = setup();
    camera.zoomToBounds({ minX: 100, minY: 100, maxX: 100, maxY: 100 }, { maxZoom: 2 });
    expect(camera.get()).toEqual({ x: 100 - 250, y: 100 - 200, zoom: 2 });
    expect(camera.boardToScreen({ x: 100, y: 100 })).toEqual({ x: 500, y: 400 });
  });

  it('drops the padding when the viewport is too small for it', () => {
    const { camera } = setup();
    camera.setViewport({ width: 40, height: 40 });
    camera.zoomToBounds({ x: 0, y: 0, w: 40, h: 40 }, { padding: 32 });
    expect(camera.get().zoom).toBe(1);
  });

  it('does nothing before the viewport size is known', () => {
    const board = createBoard();
    expect(board.camera.zoomToBounds({ x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    expect(board.camera.get()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('rejects invalid bounds and options', () => {
    const { camera } = setup();
    const ok = { x: 0, y: 0, w: 10, h: 10 };
    expect(() => camera.zoomToBounds({} as never)).toThrow(TypeError);
    expect(() => camera.zoomToBounds(ok, { padding: -1 })).toThrow(RangeError);
    expect(() => camera.zoomToBounds(ok, { maxZoom: 0 })).toThrow(RangeError);
    expect(() => camera.zoomToBounds(ok, { animate: 'yes' as never })).toThrow(TypeError);
    expect(() => camera.zoomToBounds(ok, { animate: { duration: -5 } })).toThrow(RangeError);
    expect(() => camera.zoomToBounds(ok, 5 as never)).toThrow(TypeError);
  });
});

describe('BOARD-402: zoomToFit and zoomToSelection', () => {
  it('zoomToFit covers every element of the current page only', () => {
    const { board, camera } = setup();
    board.pages.create({ id: 'page:2' });
    board.create({ type: 'box', x: 0, y: 0, w: 1000, h: 400 });
    board.create({ type: 'box', x: 2000, y: 0, w: 100, h: 100, rotation: 90 });
    board.create({ type: 'box', pageId: 'page:2', x: 50_000, y: 50_000, w: 10, h: 10 });

    expect(camera.zoomToFit({ padding: 0 })).toBe(true);
    const visible = camera.getViewportBounds();
    expect(visible.minX).toBeLessThanOrEqual(0);
    expect(visible.maxX).toBeGreaterThanOrEqual(2100);
    expect(visible.maxX).toBeLessThan(50_000);
    expect(camera.get().zoom).toBeCloseTo(1000 / 2100);
  });

  it('zoomToFit does not zoom in past 100% by default', () => {
    const { board, camera } = setup();
    board.create({ type: 'box', x: 0, y: 0, w: 10, h: 10 });
    camera.zoomToFit();
    expect(camera.get()).toEqual({ x: 5 - 500, y: 5 - 400, zoom: 1 });
    camera.zoomToFit({ maxZoom: 4 });
    expect(camera.get().zoom).toBe(4);
  });

  it('zoomToFit returns false on an empty page', () => {
    const { board, camera, events } = setup();
    board.create({ type: 'box', w: 10, h: 10 });
    board.pages.create({ id: 'page:empty' });
    board.pages.setCurrent('page:empty');
    expect(camera.zoomToFit()).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('zoomToSelection fits the selected elements', () => {
    const { board, camera } = setup();
    board.create({ id: 'a', type: 'box', x: 0, y: 0, w: 100, h: 100 });
    board.create({ id: 'b', type: 'box', x: 400, y: 300, w: 100, h: 100 });
    board.create({ id: 'far', type: 'box', x: 10_000, y: 0, w: 100, h: 100 });

    expect(camera.zoomToSelection()).toBe(false);
    board.select(['a', 'b']);
    expect(camera.zoomToSelection({ padding: 0, maxZoom: 4 })).toBe(true);
    // Selection bounds 500 × 400 → min(1000 / 500, 800 / 400) = 2.
    expect(camera.get()).toEqual({ x: 0, y: 0, zoom: 2 });
  });
});

describe('BOARD-402: animation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('animates with easing over several frames and ends exactly on the target', () => {
    const frames = manualScheduler();
    const { camera, events } = setup({ frameScheduler: frames.scheduler });
    const target = { minX: 0, minY: 0, maxX: 250, maxY: 200 };

    camera.zoomToBounds(target, { padding: 0, animate: { duration: 100, easing: linear } });
    expect(camera.animating).toBe(true);
    expect(events).toHaveLength(0);

    frames.advance(50);
    // Halfway with linear easing: zoom is the geometric mean of 1 and 4.
    expect(camera.get().zoom).toBeCloseTo(2);
    frames.advance(50);
    expect(camera.get()).toEqual({ x: 0, y: 0, zoom: 4 });
    expect(camera.animating).toBe(false);
    expect(frames.pending).toBe(0);
    expect(events).toHaveLength(2);
  });

  it('uses the default duration and easing with animate: true', () => {
    const frames = manualScheduler();
    const { camera } = setup({ frameScheduler: frames.scheduler });
    camera.zoomToBounds({ x: 0, y: 0, w: 250, h: 200 }, { padding: 0, animate: true });
    frames.advance(DEFAULT_CAMERA_ANIMATION_MS / 2);
    // Ease-in-out is symmetric, so the midpoint is also halfway (geometrically) in zoom.
    expect(camera.get().zoom).toBeCloseTo(2);
    frames.advance(DEFAULT_CAMERA_ANIMATION_MS / 2);
    expect(camera.get().zoom).toBe(4);
  });

  it('is cancelled by another camera change, a new fit, or stopAnimation', () => {
    const frames = manualScheduler();
    const { camera } = setup({ frameScheduler: frames.scheduler });
    const animate = { duration: 100, easing: linear };
    const far = { x: 10_000, y: 0, w: 10, h: 10 };

    camera.zoomToBounds(far, { animate });
    frames.advance(10);
    camera.set({ x: 1, y: 2, zoom: 1 });
    expect(camera.animating).toBe(false);
    frames.advance(200);
    expect(camera.get()).toEqual({ x: 1, y: 2, zoom: 1 });

    camera.zoomToBounds(far, { animate });
    camera.zoomBy(2);
    expect(camera.animating).toBe(false);

    camera.zoomToBounds(far, { animate });
    frames.advance(50);
    const midway = camera.get();
    camera.stopAnimation();
    frames.advance(200);
    expect(camera.get()).toBe(midway);

    // A new fit replaces the running one.
    camera.zoomToBounds(far, { animate });
    camera.zoomToBounds({ x: 0, y: 0, w: 250, h: 200 }, { padding: 0, animate });
    frames.advance(200);
    expect(camera.get()).toEqual({ x: 0, y: 0, zoom: 4 });
  });

  it('is cancelled by board.dispose', () => {
    const frames = manualScheduler();
    const { board, camera } = setup({ frameScheduler: frames.scheduler });
    camera.zoomToBounds({ x: 5000, y: 0, w: 10, h: 10 }, { animate: true });
    board.dispose();
    expect(frames.pending).toBe(0);
    expect(camera.animating).toBe(false);
  });

  it('ignores a stale frame from a scheduler that cannot cancel', () => {
    const frames = manualScheduler();
    const leaky: FrameScheduler = { ...frames.scheduler, cancel: () => {} };
    const { camera } = setup({ frameScheduler: leaky });
    camera.zoomToBounds({ x: 5000, y: 0, w: 10, h: 10 }, { animate: { duration: 100 } });
    camera.set({ x: 7, y: 7 });
    frames.advance(500);
    expect(camera.get()).toEqual({ x: 7, y: 7, zoom: 1 });
  });

  it('jumps straight to the target with reducedMotion', () => {
    const frames = manualScheduler();
    const { camera, events } = setup({ frameScheduler: frames.scheduler, reducedMotion: true });
    expect(camera.reducedMotion).toBe(true);
    camera.zoomToBounds({ x: 0, y: 0, w: 250, h: 200 }, { padding: 0, animate: true });
    expect(camera.get()).toEqual({ x: 0, y: 0, zoom: 4 });
    expect(camera.animating).toBe(false);
    expect(frames.pending).toBe(0);
    expect(events).toHaveLength(1);
  });

  it('turning reducedMotion on finishes a running animation immediately', () => {
    const frames = manualScheduler();
    const { camera } = setup({ frameScheduler: frames.scheduler });
    camera.zoomToBounds({ x: 0, y: 0, w: 250, h: 200 }, { padding: 0, animate: true });
    frames.advance(10);
    camera.setReducedMotion(true);
    expect(camera.get()).toEqual({ x: 0, y: 0, zoom: 4 });
    expect(camera.animating).toBe(false);
    expect(frames.pending).toBe(0);

    camera.setReducedMotion(false);
    expect(camera.reducedMotion).toBe(false);
    expect(() => camera.setReducedMotion('yes' as never)).toThrow(TypeError);
  });

  it('a zero duration applies the target at once', () => {
    const frames = manualScheduler();
    const { camera } = setup({ frameScheduler: frames.scheduler });
    camera.zoomToBounds({ x: 0, y: 0, w: 250, h: 200 }, { padding: 0, animate: { duration: 0 } });
    expect(camera.get().zoom).toBe(4);
    expect(frames.pending).toBe(0);
  });

  it('defaults to setTimeout frames where requestAnimationFrame is missing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const { camera } = setup();
    camera.zoomToBounds({ x: 0, y: 0, w: 250, h: 200 }, { padding: 0, animate: true });
    expect(camera.animating).toBe(true);
    vi.advanceTimersByTime(DEFAULT_CAMERA_ANIMATION_MS + 50);
    expect(camera.get()).toEqual({ x: 0, y: 0, zoom: 4 });
    expect(camera.animating).toBe(false);
  });

  it('rejects invalid createBoard options', () => {
    expect(() => createBoard({ frameScheduler: {} as never })).toThrow(TypeError);
    expect(() => createBoard({ reducedMotion: 'yes' as never })).toThrow(TypeError);
  });
});
