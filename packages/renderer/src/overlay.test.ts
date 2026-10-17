// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  rect,
  schema,
  string,
  type Board,
  type SnapGuide,
} from '@kujam/core';
import {
  mountRenderer,
  OverlayRenderer,
  ROTATE_HANDLE_RADIUS_PX,
  SELECTION_COLOR,
  SNAP_GUIDE_COLOR,
  type BoardView,
} from './index.js';

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

const testPlugin = definePlugin({
  id: 'test-elements',
  elements: [boxElement],
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
});
