import { describe, expect, it } from 'vitest';
import { createBoard, DEFAULT_ZOOM_RANGE, type CameraEvent } from '../index.js';

function setup(options: Parameters<typeof createBoard>[0] = {}) {
  const board = createBoard(options);
  const events: CameraEvent[] = [];
  board.on('camera', (e) => events.push(e));
  return { board, camera: board.camera, events };
}

describe('BOARD-401: board.camera', () => {
  it('get and set mirror getCamera and setCamera and emit camera events', () => {
    const { board, camera, events } = setup();
    expect(camera.get()).toEqual({ x: 0, y: 0, zoom: 1 });

    camera.set({ x: 10, y: -5, zoom: 2 });
    expect(camera.get()).toBe(board.getCamera());
    expect(camera.get()).toEqual({ x: 10, y: -5, zoom: 2 });

    board.setCamera({ x: 20 });
    expect(camera.get()).toEqual({ x: 20, y: -5, zoom: 2 });
    expect(events.map((e) => e.camera.x)).toEqual([10, 20]);
    expect(events[1]!.previous).toEqual({ x: 10, y: -5, zoom: 2 });
  });

  it('emits nothing when the camera does not change', () => {
    const { camera, events } = setup();
    camera.set({ x: 0, y: 0, zoom: 1 });
    camera.set({ zoom: Number.NaN });
    camera.zoomTo(1, { x: 50, y: 50 });
    expect(events).toHaveLength(0);
  });

  it('exposes the default zoom range of 10% to 400%', () => {
    const { camera } = setup();
    expect(camera.zoomRange).toEqual({ min: 0.1, max: 4 });
    expect(camera.zoomRange).toEqual(DEFAULT_ZOOM_RANGE);
    camera.set({ zoom: 10 });
    expect(camera.get().zoom).toBe(4);
    camera.set({ zoom: 0.01 });
    expect(camera.get().zoom).toBe(0.1);
  });

  it('uses a custom zoom range from options', () => {
    const { camera } = setup({ zoomRange: { min: 0.5, max: 8 } });
    expect(camera.zoomRange).toEqual({ min: 0.5, max: 8 });
    camera.set({ zoom: 6 });
    expect(camera.get().zoom).toBe(6);
    camera.zoomBy(10);
    expect(camera.get().zoom).toBe(8);
  });
});

describe('BOARD-401: coordinate conversion', () => {
  it('converts between screen and board coordinates', () => {
    const { camera } = setup();
    camera.set({ x: 100, y: 50, zoom: 2 });
    // The camera's x/y is the board point at the top-left of the viewport.
    expect(camera.screenToBoard({ x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
    expect(camera.screenToBoard({ x: 200, y: 100 })).toEqual({ x: 200, y: 100 });
    expect(camera.boardToScreen({ x: 200, y: 100 })).toEqual({ x: 200, y: 100 });
    expect(camera.boardToScreen({ x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
  });

  it('round-trips points at arbitrary cameras', () => {
    const { camera } = setup();
    camera.set({ x: -37.5, y: 1234.25, zoom: 0.37 });
    for (const p of [
      { x: 0, y: 0 },
      { x: 13.7, y: -99 },
      { x: 1e5, y: -1e5 },
    ]) {
      const back = camera.boardToScreen(camera.screenToBoard(p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it('reports the viewport size and visible board bounds', () => {
    const { camera, events } = setup();
    expect(camera.viewport).toEqual({ width: 0, height: 0 });

    camera.setViewport({ width: 800, height: 600 });
    expect(camera.viewport).toEqual({ width: 800, height: 600 });
    expect(Object.isFrozen(camera.viewport)).toBe(true);
    // Resizing does not move the camera.
    expect(events).toHaveLength(0);

    camera.set({ x: 100, y: 200, zoom: 2 });
    expect(camera.getViewportBounds()).toEqual({ minX: 100, minY: 200, maxX: 500, maxY: 500 });
  });

  it('rejects invalid viewport sizes and points', () => {
    const { camera } = setup();
    expect(() => camera.setViewport({ width: -1, height: 10 })).toThrow(RangeError);
    expect(() => camera.setViewport({ width: Number.NaN, height: 10 })).toThrow(RangeError);
    expect(() => camera.setViewport(null as never)).toThrow(RangeError);
    expect(() => camera.screenToBoard({ x: Number.NaN, y: 0 })).toThrow(TypeError);
    expect(() => camera.boardToScreen(undefined as never)).toThrow(TypeError);
    expect(() => camera.zoomTo(2, { x: 'a' } as never)).toThrow(TypeError);
  });
});

describe('BOARD-401: zoom anchored at a point', () => {
  it('keeps the board point under the cursor fixed', () => {
    const { camera } = setup();
    camera.set({ x: 30, y: -20, zoom: 1.5 });
    const cursor = { x: 320, y: 180 };
    const before = camera.screenToBoard(cursor);

    camera.zoomTo(3, cursor);
    expect(camera.get().zoom).toBe(3);
    const after = camera.screenToBoard(cursor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('keeps the anchor fixed when the zoom is clamped', () => {
    const { camera } = setup();
    const pinch = { x: 100, y: 100 };
    const before = camera.screenToBoard(pinch);
    camera.zoomTo(50, pinch);
    expect(camera.get().zoom).toBe(DEFAULT_ZOOM_RANGE.max);
    const after = camera.screenToBoard(pinch);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('zoomBy multiplies the zoom around the pinch center', () => {
    const { camera } = setup();
    const center = { x: 400, y: 300 };
    const before = camera.screenToBoard(center);
    camera.zoomBy(1.25, center);
    camera.zoomBy(1.25, center);
    expect(camera.get().zoom).toBeCloseTo(1.5625, 12);
    const after = camera.screenToBoard(center);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('defaults the anchor to the viewport center', () => {
    const { camera } = setup();
    camera.setViewport({ width: 800, height: 600 });
    const before = camera.screenToBoard({ x: 400, y: 300 });
    camera.zoomTo(2);
    const after = camera.screenToBoard({ x: 400, y: 300 });
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('emits a single camera event per zoom', () => {
    const { camera, events } = setup();
    camera.zoomTo(2, { x: 10, y: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]!.camera).toBe(camera.get());
  });

  it('ignores non-finite zoom targets and non-positive factors', () => {
    const { camera, events } = setup();
    camera.zoomTo(Number.NaN);
    camera.zoomBy(0);
    camera.zoomBy(-2);
    camera.zoomBy(Number.POSITIVE_INFINITY);
    expect(events).toHaveLength(0);
    expect(camera.get()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('is allowed on readOnly boards and is not part of the document or history', () => {
    const { board, camera } = setup({ readOnly: true });
    const doc = board.getDocument();
    camera.zoomTo(2, { x: 50, y: 50 });
    expect(camera.get().zoom).toBe(2);
    expect(board.getDocument()).toBe(doc);
    expect(board.history.canUndo).toBe(false);
  });
});
