// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard, definePlugin, type Board } from '@kujam/core';
import {
  clampPixelRatio,
  mountRenderer,
  SAFARI_MAX_CANVAS_PIXELS,
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

const emptyPlugin = definePlugin({ id: 'empty' });

function createMockContext() {
  const calls: string[] = [];
  return {
    calls,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    setLineDash: vi.fn(),
  };
}

describe('BOARD-803: devicePixelRatio and Safari canvas memory limits', () => {
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
        return ctx as unknown as CanvasRenderingContext2D;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    for (const v of views) v.unmount();
    for (const b of boards) b.dispose();
  });

  describe('clampPixelRatio pure function', () => {
    it('returns desired DPR when canvas area is well below Safari limit', () => {
      // 800x600 at DPR 1: 480k px
      expect(clampPixelRatio(800, 600, 1)).toBe(1);
      // 800x600 at DPR 2: 1.92M px
      expect(clampPixelRatio(800, 600, 2)).toBe(2);
      // 800x600 at DPR 3: 4.32M px
      expect(clampPixelRatio(800, 600, 3)).toBe(3);
      // 1920x1080 at DPR 2: 8.29M px
      expect(clampPixelRatio(1920, 1080, 2)).toBe(2);
    });

    it('clamps DPR when canvas area exceeds Safari 16.7M px limit', () => {
      // 4000x3000 = 12M CSS pixels. At DPR 2 = 48M physical pixels (> 16,777,216)
      const clamped = clampPixelRatio(4000, 3000, 2);
      expect(clamped).toBeLessThan(2);
      expect(clamped).toBeGreaterThan(1);
      // Total physical pixels must be <= 16,777,216
      const totalPixels = 4000 * clamped * (3000 * clamped);
      expect(totalPixels).toBeLessThanOrEqual(SAFARI_MAX_CANVAS_PIXELS + 1);
    });

    it('handles degenerate dimensions gracefully', () => {
      expect(clampPixelRatio(0, 500, 2)).toBe(2);
      expect(clampPixelRatio(500, 0, 2)).toBe(2);
      expect(clampPixelRatio(-100, 500, 2)).toBe(2);
    });
  });

  describe('DPR support up to 3 in mountRenderer', () => {
    it.each([1, 2, 3])('scales canvas backing stores accurately for DPR %d', (dpr) => {
      const board = createBoard({ plugins: [emptyPlugin] });
      boards.push(board);
      const container = document.createElement('div');
      document.body.appendChild(container);

      const view = mountRenderer(board, container, { pixelRatio: dpr });
      views.push(view);
      FakeResizeObserver.instances[0]!.resize(800, 600);
      flushFrames();

      expect(view.pixelRatio).toBe(dpr);
      expect(view.layers.canvas.width).toBe(800 * dpr);
      expect(view.layers.canvas.height).toBe(600 * dpr);
      expect(view.layers.overlay.width).toBe(800 * dpr);
      expect(view.layers.overlay.height).toBe(600 * dpr);
    });

    it('clamps canvas backing store size when viewport exceeds Safari memory limit at high DPR', () => {
      const board = createBoard({ plugins: [emptyPlugin] });
      boards.push(board);
      const container = document.createElement('div');
      document.body.appendChild(container);

      // Desired DPR 3 for a 4000x3000 container = 108M px
      const view = mountRenderer(board, container, { pixelRatio: 3 });
      views.push(view);
      FakeResizeObserver.instances[0]!.resize(4000, 3000);
      flushFrames();

      expect(view.pixelRatio).toBeLessThan(3);
      const canvasArea = view.layers.canvas.width * view.layers.canvas.height;
      expect(canvasArea).toBeLessThanOrEqual(SAFARI_MAX_CANVAS_PIXELS + 10);

      const overlayArea = view.layers.overlay.width * view.layers.overlay.height;
      expect(overlayArea).toBeLessThanOrEqual(SAFARI_MAX_CANVAS_PIXELS + 10);
    });
  });

  describe('Reaction to DPR changes (monitor switch or browser zoom)', () => {
    it('updates backing size when matchMedia resolution changes', () => {
      let currentDpr = 1;
      const listeners: Array<() => void> = [];

      window.matchMedia = vi.fn((query: string) => ({
        matches: query.includes(`${currentDpr}dppx`),
        media: query,
        onchange: null,
        addEventListener: vi.fn((_type: string, listener: () => void) => {
          listeners.push(listener);
        }),
        removeEventListener: vi.fn((_type: string, listener: () => void) => {
          const idx = listeners.indexOf(listener);
          if (idx !== -1) listeners.splice(idx, 1);
        }),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;

      Object.defineProperty(window, 'devicePixelRatio', {
        get: () => currentDpr,
        configurable: true,
      });

      const board = createBoard({ plugins: [emptyPlugin] });
      boards.push(board);
      const container = document.createElement('div');
      document.body.appendChild(container);

      const view = mountRenderer(board, container);
      views.push(view);
      FakeResizeObserver.instances[0]!.resize(1000, 500);
      flushFrames();

      expect(view.pixelRatio).toBe(1);
      expect(view.layers.canvas.width).toBe(1000);

      // Simulate moving window to Retina monitor (DPR becomes 2)
      currentDpr = 2;
      for (const cb of [...listeners]) cb();
      flushFrames();

      expect(view.pixelRatio).toBe(2);
      expect(view.layers.canvas.width).toBe(2000);
      expect(view.layers.canvas.height).toBe(1000);
    });
  });
});
