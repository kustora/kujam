// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  array,
  createBoard,
  defineElement,
  definePlugin,
  nullable,
  number,
  object,
  rect,
  schema,
  string,
  type Board,
  type PresenceApi,
  type PresenceLiveStroke,
  type PresencePeerState,
  type SnapGuide,
} from '@kujam/core';
import {
  CONNECTOR_HANDLE_RADIUS_PX,
  mountRenderer,
  OverlayRenderer,
  ROTATE_HANDLE_RADIUS_PX,
  SELECTION_COLOR,
  SNAP_GUIDE_COLOR,
  type BoardView,
} from '../index.js';
import {
  LINE_INSERT_HANDLE_RADIUS_PX,
  LINE_POINT_HANDLE_RADIUS_PX,
} from './overlay.js';

let boards: Board[] = [];
let views: BoardView[] = [];

/** Controllable ResizeObserver stub */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(): void {}
  disconnect(): void {}

  resize(width: number, height: number): void {
    const entry = { target: this.targets[0], contentRect: { width, height } };
    this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
function flushFrames(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(0);
}

const boxElement = defineElement({
  type: 'box',
  version: 1,
  props: schema({ label: string() }),
  defaults: { label: '' },
  geometry: (el) => rect(el.w, el.h),
  render: {
    canvas: () => {},
  },
});

const connectorElement = defineElement({
  type: 'connector',
  version: 1,
  props: schema({
    start: object({ x: number(), y: number() }),
    end: object({ x: number(), y: number() }),
    startBindingId: nullable(string()),
    endBindingId: nullable(string()),
  }),
  defaults: {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 100 },
    startBindingId: null,
    endBindingId: null,
  },
  geometry: (el) => rect(el.w, el.h),
  render: {
    canvas: () => {},
  },
});

const lineElement = defineElement({
  type: 'line',
  version: 1,
  props: schema({ points: array(object({ x: number(), y: number() })) }),
  defaults: { points: [] },
  geometry: (el) => rect(el.w, el.h),
  render: {
    canvas: () => {},
  },
});

const testPlugin = definePlugin({
  id: 'test-elements',
  elements: [boxElement, connectorElement, lineElement],
});

function createMockContext() {
  const calls: string[] = [];
  const strokes: Array<{ type: string; args: unknown[]; strokeStyle?: unknown; lineWidth?: unknown }> = [];
  const fills: Array<{ type: string; args: unknown[]; fillStyle?: unknown }> = [];

  return {
    calls,
    strokes,
    fills,
    canvas: { width: 1000, height: 1000 },
    setTransform: vi.fn((...args: unknown[]) => calls.push(`setTransform(${args.join(',')})`)),
    clearRect: vi.fn((...args: unknown[]) => calls.push(`clearRect(${args.join(',')})`)),
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    scale: vi.fn((...args: unknown[]) => calls.push(`scale(${args.join(',')})`)),
    translate: vi.fn((...args: unknown[]) => calls.push(`translate(${args.join(',')})`)),
    rotate: vi.fn((...args: unknown[]) => calls.push(`rotate(${args.join(',')})`)),
    beginPath: vi.fn(() => calls.push('beginPath')),
    closePath: vi.fn(() => calls.push('closePath')),
    moveTo: vi.fn((...args: unknown[]) => calls.push(`moveTo(${args.join(',')})`)),
    lineTo: vi.fn((...args: unknown[]) => calls.push(`lineTo(${args.join(',')})`)),
    quadraticCurveTo: vi.fn((...args: unknown[]) => calls.push(`quadraticCurveTo(${args.join(',')})`)),
    bezierCurveTo: vi.fn((...args: unknown[]) => calls.push(`bezierCurveTo(${args.join(',')})`)),
    arc: vi.fn((...args: unknown[]) => calls.push(`arc(${args.join(',')})`)),
    rect: vi.fn((...args: unknown[]) => calls.push(`rect(${args.join(',')})`)),
    clip: vi.fn(() => calls.push('clip')),
    fillRect: vi.fn(function (this: { fillStyle?: unknown }, ...args: unknown[]) {
      calls.push(`fillRect(${args.join(',')})`);
      fills.push({ type: 'fillRect', args, fillStyle: this.fillStyle });
    }),
    strokeRect: vi.fn(function (this: { strokeStyle?: unknown; lineWidth?: unknown }, ...args: unknown[]) {
      calls.push(`strokeRect(${args.join(',')})`);
      strokes.push({ type: 'strokeRect', args, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
    }),
    fill: vi.fn(function (this: { fillStyle?: unknown }, ...args: unknown[]) {
      calls.push(`fill(${args.join(',')})`);
      fills.push({ type: 'fill', args, fillStyle: this.fillStyle });
    }),
    stroke: vi.fn(function (this: { strokeStyle?: unknown; lineWidth?: unknown }, ...args: unknown[]) {
      calls.push(`stroke(${args.join(',')})`);
      strokes.push({ type: 'stroke', args, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
    }),
    fillText: vi.fn((...args: unknown[]) => calls.push(`fillText(${args.join(',')})`)),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    setLineDash: vi.fn((...args: unknown[]) => calls.push(`setLineDash(${args.join(',')})`)),
    strokeStyle: '#000000',
    fillStyle: '#000000',
    lineWidth: 1,
  };
}

describe('BOARD-805: Overlay Renderer', () => {
  beforeEach(() => {
    boards = [];
    views = [];
    FakeResizeObserver.instances = [];
    frames.clear();
    nextFrameId = 1;

    window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    window.cancelAnimationFrame = vi.fn((id: number) => {
      frames.delete(id);
    });

    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, type: string) {
      if (type === '2d') {
        const ctx = createMockContext();
        ctx.canvas = this;
        return ctx as unknown as CanvasRenderingContext2D;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    for (const v of views) v.unmount();
    for (const b of boards) b.dispose();
  });

  describe('Direct OverlayRenderer unit tests', () => {
    it('does not render when canvas has no selection, tool data, or hover', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(false);
      expect(ctx.clearRect).toHaveBeenCalled();
    });

    it('draws selection outline, 8 resize handles, and rotate handle for selected element', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });
      board.create({ id: 'box1', type: 'box', x: 100, y: 100, w: 200, h: 100 });
      board.select(['box1']);

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.selectedCount).toBe(1);

      // Verify selection outline stroke
      expect(ctx.strokeRect).toHaveBeenCalled();
      const outline = ctx.strokes.find(
        (s) => s.type === 'strokeRect' && s.strokeStyle === SELECTION_COLOR,
      );
      expect(outline).toBeDefined();

      // Verify rotate handle (arc) and 8 resize handles (fillRect / strokeRect)
      expect(ctx.arc).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), ROTATE_HANDLE_RADIUS_PX, 0, Math.PI * 2);
      expect(ctx.fillRect).toHaveBeenCalled();
    });

    it('draws area selection box (brush) from toolData', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      // Mock toolData with brush
      Object.defineProperty(board, 'toolData', {
        value: {
          brush: { minX: 50, minY: 50, maxX: 250, maxY: 150 },
          guides: [],
        },
        configurable: true,
      });

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.hasBrush).toBe(true);

      const brushFill = ctx.fills.find((f) => f.type === 'fillRect');
      expect(brushFill).toBeDefined();
    });

    it('draws snap guides along x and y axes', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      const guides: SnapGuide[] = [
        { axis: 'x', position: 100, from: 0, to: 500, source: 'element' },
        { axis: 'y', position: 200, from: 50, to: 400, source: 'grid' },
      ];

      Object.defineProperty(board, 'toolData', {
        value: { brush: null, guides },
        configurable: true,
      });

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.guidesCount).toBe(2);

      expect(ctx.moveTo).toHaveBeenCalledTimes(2);
      expect(ctx.lineTo).toHaveBeenCalledTimes(2);
      const snapStroke = ctx.strokes.find((s) => s.strokeStyle === SNAP_GUIDE_COLOR);
      expect(snapStroke).toBeDefined();
    });

    it('draws hover indicator for unselected element', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });
      board.create({ id: 'box1', type: 'box', x: 50, y: 50, w: 100, h: 100 });

      const overlayRenderer = new OverlayRenderer(board);
      overlayRenderer.setHovered('box1');
      expect(overlayRenderer.getHovered()).toBe('box1');

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.hoveredId).toBe('box1');
      expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);

      // If the element becomes selected, hover outline is suppressed
      board.select(['box1']);
      ctx.setLineDash.mockClear();
      overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(ctx.setLineDash).not.toHaveBeenCalled();
    });

    it('draws presence cursors with name badges', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      const overlayRenderer = new OverlayRenderer(board);
      overlayRenderer.setCursors([
        { id: 'user-1', x: 200, y: 300, color: '#e2445c', name: 'Alice' },
      ]);

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(ctx.fillText).toHaveBeenCalledWith('Alice', expect.any(Number), expect.any(Number));
    });

    it('draws active freehand stroke preview from toolData (BOARD-1002)', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      Object.defineProperty(board, 'toolData', {
        value: {
          brush: null,
          guides: [],
          activeStroke: {
            points: [
              [100, 100, 0.5],
              [120, 130, 0.6],
              [150, 180, 0.7],
            ],
            color: '#1d1d1f',
            thickness: 4,
            brush: 'pen',
          },
        },
        configurable: true,
      });

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.hasActiveStroke).toBe(true);

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
      const strokeFill = ctx.fills.find((f) => f.type === 'fill');
      expect(strokeFill).toBeDefined();
    });

    it('draws circular endpoint handles and bound inner dots for a selected connector (BOARD-1101)', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });
      board.create({
        id: 'conn1',
        type: 'connector',
        x: 100,
        y: 120,
        w: 200,
        h: 80,
        props: {
          start: { x: 0, y: 0 },
          end: { x: 200, y: 80 },
          startBindingId: 'bind-start',
          endBindingId: null,
        },
      });
      board.select(['conn1']);

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.selectedCount).toBe(1);

      // Should NOT draw rectangular 8-handle resize box
      expect(ctx.strokeRect).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();

      // Should draw highlight line from (100, 120) to (300, 200)
      expect(ctx.moveTo).toHaveBeenCalledWith(100, 120);
      expect(ctx.lineTo).toHaveBeenCalledWith(300, 200);

      // Should draw 2 endpoint circles (radius 5px) and 1 bound inner dot (radius 2.5px) at start
      expect(ctx.arc).toHaveBeenCalledWith(100, 120, CONNECTOR_HANDLE_RADIUS_PX, 0, Math.PI * 2);
      expect(ctx.arc).toHaveBeenCalledWith(300, 200, CONNECTOR_HANDLE_RADIUS_PX, 0, Math.PI * 2);
      expect(ctx.arc).toHaveBeenCalledWith(100, 120, 2.5, 0, Math.PI * 2);
      expect(ctx.arc).not.toHaveBeenCalledWith(300, 200, 2.5, 0, Math.PI * 2);
    });

    it('draws a handle on every point and insertion handles on long segments of a selected line (BOARD-1106)', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });
      board.create({
        id: 'line1',
        type: 'line',
        x: 100,
        y: 100,
        w: 210,
        h: 100,
        props: {
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 210, y: 0 },
            { x: 210, y: 100 },
          ],
        },
      });
      board.select(['line1']);

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();
      overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);

      // No resize box: lines are edited point by point.
      expect(ctx.strokeRect).not.toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledWith(100, 100);
      expect(ctx.lineTo).toHaveBeenCalledWith(310, 200);
      for (const [x, y] of [
        [100, 100],
        [300, 100],
        [310, 100],
        [310, 200],
      ] as const) {
        expect(ctx.arc).toHaveBeenCalledWith(x, y, LINE_POINT_HANDLE_RADIUS_PX, 0, Math.PI * 2);
      }
      const inserts = ctx.arc.mock.calls.filter((c) => c[2] === LINE_INSERT_HANDLE_RADIUS_PX);
      // The 10px segment is too short for an insertion handle.
      expect(inserts.map((c) => [c[0], c[1]])).toEqual([
        [200, 100],
        [310, 150],
      ]);
    });

    it('draws connectorSnap candidate anchors and snapped point with halo (BOARD-1101d)', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      Object.defineProperty(board, 'toolData', {
        value: {
          connectorSnap: {
            elementId: 'box1',
            anchor: { x: 1, y: 0.5 },
            point: { x: 250, y: 150 },
            candidates: [
              { x: 150, y: 100 },
              { x: 250, y: 150 },
              { x: 150, y: 200 },
              { x: 50, y: 150 },
            ],
          },
        },
        configurable: true,
      });

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);

      // Candidate circles (radius 4px)
      expect(ctx.arc).toHaveBeenCalledWith(150, 100, 4, 0, Math.PI * 2);
      expect(ctx.arc).toHaveBeenCalledWith(50, 150, 4, 0, Math.PI * 2);

      // Snapped point halo (radius 11px) and inner dot (radius 6px)
      expect(ctx.arc).toHaveBeenCalledWith(250, 150, 11, 0, Math.PI * 2);
      expect(ctx.arc).toHaveBeenCalledWith(250, 150, 6, 0, Math.PI * 2);
    });

    it('draws connectorPreview polyline and bezier curve from toolData (BOARD-1101)', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      Object.defineProperty(board, 'toolData', {
        value: {
          connectorPreview: {
            points: [
              { x: 100, y: 100 },
              { x: 200, y: 100 },
              { x: 200, y: 250 },
            ],
            style: 'elbow',
            dash: 'dashed',
          },
        },
        configurable: true,
      });

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(ctx.moveTo).toHaveBeenCalledWith(100, 100);
      expect(ctx.lineTo).toHaveBeenCalledWith(200, 100);
      expect(ctx.lineTo).toHaveBeenCalledWith(200, 250);
      expect(ctx.setLineDash).toHaveBeenCalledWith([8, 6]);

      // Test curved bezier preview
      const ctxBezier = createMockContext();
      Object.defineProperty(board, 'toolData', {
        value: {
          connectorPreview: {
            points: [
              { x: 100, y: 100 },
              { x: 300, y: 200 },
            ],
            style: 'curved',
            bezier: [
              { x: 100, y: 100 },
              { x: 200, y: 100 },
              { x: 200, y: 200 },
              { x: 300, y: 200 },
            ],
          },
        },
        configurable: true,
      });

      const statsBezier = overlayRenderer.render(
        canvas,
        ctxBezier as unknown as CanvasRenderingContext2D,
        1,
      );
      expect(statsBezier.rendered).toBe(true);
      expect(ctxBezier.moveTo).toHaveBeenCalledWith(100, 100);
      expect(ctxBezier.bezierCurveTo).toHaveBeenCalledWith(200, 100, 200, 200, 300, 200);
    });
  });

  describe('Integration with mountRenderer', () => {
    it('mountRenderer attaches overlay layer and reports overlayStats', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      const container = document.createElement('div');
      document.body.appendChild(container);

      const view = mountRenderer(board, container);
      views.push(view);
      FakeResizeObserver.instances[0]!.resize(800, 600);
      flushFrames();

      expect(view.layers.overlay).toBeDefined();
      expect(view.layers.overlay.dataset.kujamLayer).toBe('overlay');

      // Empty state
      expect(view.overlayStats.rendered).toBe(false);

      // Create and select element -> triggers overlay render on next frame
      board.create({ id: 'el1', type: 'box', x: 50, y: 50, w: 100, h: 100 });
      board.select(['el1']);
      flushFrames();

      expect(view.overlayStats.rendered).toBe(true);
      expect(view.overlayStats.selectedCount).toBe(1);
    });
  });

  describe('BOARD-808: Remote collaborator presence in overlay', () => {
    it('smoothes cursor position updates via interpolation (LERP)', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      const overlayRenderer = new OverlayRenderer(board);
      overlayRenderer.cursorLerpFactor = 0.5;

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      // Initial cursor at (100, 100)
      overlayRenderer.setCursors([{ id: 'u1', x: 100, y: 100, name: 'Alice' }]);
      let stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.hasPendingCursorAnimation).toBe(false);

      let currentCursors = overlayRenderer.getCursors();
      expect(currentCursors[0]?.x).toBe(100);
      expect(currentCursors[0]?.y).toBe(100);

      // Move target to (200, 300)
      overlayRenderer.setCursors([{ id: 'u1', x: 200, y: 300, name: 'Alice' }]);

      // First step: interpolated position with factor 0.5 -> 100 + (200 - 100)*0.5 = 150, 100 + (300 - 100)*0.5 = 200
      stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.hasPendingCursorAnimation).toBe(true);
      currentCursors = overlayRenderer.getCursors();
      expect(currentCursors[0]?.x).toBeCloseTo(150);
      expect(currentCursors[0]?.y).toBeCloseTo(200);

      // Continue stepping until settled
      for (let i = 0; i < 15; i++) {
        stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      }
      expect(stats.hasPendingCursorAnimation).toBe(false);
      currentCursors = overlayRenderer.getCursors();
      expect(currentCursors[0]?.x).toBe(200);
      expect(currentCursors[0]?.y).toBe(300);
    });

    it('snaps cursor immediately without interpolation when reduced motion is enabled', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });
      board.camera.setReducedMotion(true);

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      overlayRenderer.setCursors([{ id: 'u1', x: 100, y: 100, name: 'Alice' }]);
      overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);

      overlayRenderer.setCursors([{ id: 'u1', x: 400, y: 500, name: 'Alice' }]);
      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);

      expect(stats.hasPendingCursorAnimation).toBe(false);
      const currentCursors = overlayRenderer.getCursors();
      expect(currentCursors[0]?.x).toBe(400);
      expect(currentCursors[0]?.y).toBe(500);
    });

    it('hides remote cursors after inactivity timeout', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      const overlayRenderer = new OverlayRenderer(board);
      overlayRenderer.inactivityTimeoutMs = 5000;

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const t0 = 100000;
      overlayRenderer.setCursors([
        { id: 'u1', x: 150, y: 250, name: 'Bob', color: '#16754c', lastActive: t0 },
      ]);

      // Active at t0 + 2000 ms (2s < 5s)
      let stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1, t0 + 2000);
      expect(stats.rendered).toBe(true);
      expect(stats.remoteCursorsCount).toBe(1);
      expect(stats.nextInactivityTimeoutMs).toBe(3000);
      expect(ctx.fillText).toHaveBeenCalledWith('Bob', expect.any(Number), expect.any(Number));

      // Inactive at t0 + 6000 ms (6s > 5s timeout)
      ctx.fillText.mockClear();
      stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1, t0 + 6000);
      expect(stats.rendered).toBe(false);
      expect(stats.remoteCursorsCount).toBe(0);
      expect(ctx.fillText).not.toHaveBeenCalled();

      // Reactivated at t0 + 7000 ms
      overlayRenderer.setCursors([
        { id: 'u1', x: 180, y: 280, name: 'Bob', color: '#16754c', lastActive: t0 + 7000 },
      ]);
      stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1, t0 + 7100);
      expect(stats.rendered).toBe(true);
      expect(stats.remoteCursorsCount).toBe(1);
      expect(ctx.fillText).toHaveBeenCalledWith('Bob', expect.any(Number), expect.any(Number));
    });

    it('renders remote collaborator selection borders with their color and name badge', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });
      board.create({ id: 'box1', type: 'box', x: 100, y: 100, w: 200, h: 100 });
      board.create({ id: 'box2', type: 'box', x: 400, y: 100, w: 150, h: 80 });

      const overlayRenderer = new OverlayRenderer(board);
      overlayRenderer.setRemoteSelections([
        { peerId: 'peer-alice', elementIds: ['box1', 'box2'], color: '#9b3d7f', name: 'Alice' },
      ]);

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.remoteSelectedCount).toBe(2);

      // Verify strokeRect called with peer color
      const peerStrokes = ctx.strokes.filter((s) => s.strokeStyle === '#9b3d7f');
      expect(peerStrokes.length).toBe(2);

      // Verify name badge rendered for the peer's selection
      expect(ctx.fillText).toHaveBeenCalledWith('Alice', expect.any(Number), expect.any(Number));
    });

    it('renders remote collaborator selection on connector elements', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });
      board.create({
        id: 'conn1',
        type: 'connector',
        x: 50,
        y: 50,
        w: 200,
        h: 150,
        props: { start: { x: 0, y: 0 }, end: { x: 200, y: 150 } },
      });

      const overlayRenderer = new OverlayRenderer(board);
      overlayRenderer.setRemoteSelections([
        { peerId: 'peer-dave', elementIds: ['conn1'], color: '#c2410c' },
      ]);

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = createMockContext();

      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.remoteSelectedCount).toBe(1);

      const connStroke = ctx.strokes.find((s) => s.strokeStyle === '#c2410c');
      expect(connStroke).toBeDefined();
    });

    it('renders remote live strokes and deduplicates when element is committed to document', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });

      const overlayRenderer = new OverlayRenderer(board);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;

      const liveStroke: PresenceLiveStroke = {
        id: 'live-stroke-1',
        points: [
          [50, 50, 0.5],
          [80, 90, 0.6],
          [120, 140, 0.7],
        ],
        color: '#2f6fdb',
        thickness: 4,
        brush: 'pen',
      };

      // 1. Live stroke in-progress: not yet in board document -> rendered in overlay
      overlayRenderer.setRemoteLiveStrokes([liveStroke]);
      const ctx1 = createMockContext();
      let stats = overlayRenderer.render(canvas, ctx1 as unknown as CanvasRenderingContext2D, 1);
      expect(stats.rendered).toBe(true);
      expect(stats.remoteLiveStrokesCount).toBe(1);
      expect(ctx1.fill).toHaveBeenCalled();

      // 2. Stroke committed permanently to board document -> deduplicated and suppressed in overlay
      board.create({
        id: 'live-stroke-1',
        type: 'box',
        x: 50,
        y: 50,
        w: 70,
        h: 90,
      });

      const ctx2 = createMockContext();
      stats = overlayRenderer.render(canvas, ctx2 as unknown as CanvasRenderingContext2D, 1);
      expect(stats.remoteLiveStrokesCount).toBe(0);
      expect(stats.rendered).toBe(false);
    });

    it('integrates seamlessly with board presence awareness API', () => {
      const board = createBoard({ plugins: [testPlugin] });
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });
      board.create({ id: 'boxA', type: 'box', x: 20, y: 20, w: 100, h: 60 });

      // Build mock PresenceApi
      const listeners = new Map<string, Set<(peerId: string, state?: PresencePeerState) => void>>();
      const peers = new Map<string, PresencePeerState>();

      const mockPresence: PresenceApi = {
        get peers() {
          return peers;
        },
        setLocalState: vi.fn(),
        getLocalState: () => undefined,
        on(event, listener) {
          let set = listeners.get(event);
          if (!set) {
            set = new Set();
            listeners.set(event, set);
          }
          set.add(listener);
          return () => set?.delete(listener);
        },
      };

      const container = document.createElement('div');
      document.body.appendChild(container);

      const view = mountRenderer(board, container, { presence: mockPresence });
      views.push(view);
      FakeResizeObserver.instances[0]!.resize(800, 600);
      flushFrames();

      expect(view.overlayStats.remoteCursorsCount).toBe(0);
      expect(view.overlayStats.remoteSelectedCount).toBe(0);

      // Simulate peer joining and broadcasting cursor & selection
      peers.set('peer-1', {
        user: { id: 'peer-1', name: 'Zack', color: '#e02874' },
        cursor: { x: 300, y: 400 },
        selection: ['boxA'],
        activeStroke: {
          id: 'temp-stroke-z',
          points: [[10, 10], [20, 20]],
          color: '#e02874',
          thickness: 3,
        },
      });

      // Notify change listener
      for (const listener of listeners.get('change') ?? []) {
        listener('peer-1', peers.get('peer-1'));
      }
      flushFrames();

      expect(view.overlayStats.rendered).toBe(true);
      expect(view.overlayStats.remoteCursorsCount).toBe(1);
      expect(view.overlayStats.remoteSelectedCount).toBe(1);
      expect(view.overlayStats.remoteLiveStrokesCount).toBe(1);

      // Peer leaves
      peers.delete('peer-1');
      for (const listener of listeners.get('peer-leave') ?? []) {
        listener('peer-1');
      }
      flushFrames();

      expect(view.overlayStats.remoteCursorsCount).toBe(0);
      expect(view.overlayStats.remoteSelectedCount).toBe(0);
    });

    it('renders subtle drop target preview when drop indicator is active (BOARD-608)', () => {
      const board = createBoard();
      boards.push(board);
      board.camera.setViewport({ width: 800, height: 600 });
      const overlayRenderer = new OverlayRenderer(board);

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;

      expect(overlayRenderer.getDropIndicator()).toBeNull();

      // Setting indicator
      expect(overlayRenderer.setDropIndicator({ x: 250, y: 150 })).toBe(true);
      expect(overlayRenderer.setDropIndicator({ x: 250, y: 150 })).toBe(false);
      expect(overlayRenderer.getDropIndicator()).toEqual({ x: 250, y: 150 });

      const ctx = createMockContext();
      const stats = overlayRenderer.render(canvas, ctx as unknown as CanvasRenderingContext2D, 1);

      expect(stats.rendered).toBe(true);
      expect(stats.hasDropIndicator).toBe(true);
      // Renders outer dashed halo and inner dot
      expect(ctx.arc).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.setLineDash).toHaveBeenCalledWith([3, 3]);

      // Clearing indicator
      expect(overlayRenderer.setDropIndicator(null)).toBe(true);
      expect(overlayRenderer.getDropIndicator()).toBeNull();

      const ctx2 = createMockContext();
      const statsCleared = overlayRenderer.render(canvas, ctx2 as unknown as CanvasRenderingContext2D, 1);
      expect(statsCleared.hasDropIndicator).toBe(false);
    });
  });
});
