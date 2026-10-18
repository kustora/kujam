// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard, DEFAULT_LIGHT_THEME, type Board, type CameraState } from '@kujam/core';
import { mountRenderer, type BoardView } from '../index.js';
import {
  assertBackground,
  BackgroundPainter,
  effectiveGridSpacing,
  MIN_GRID_SCREEN_SPACING,
} from './background.js';

const tokens = DEFAULT_LIGHT_THEME.canvas;

function camera(x: number, y: number, zoom: number): CameraState {
  return { x, y, zoom } as CameraState;
}

function createTileContext() {
  return {
    fillStyle: '',
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
  };
}

function createMainContext(withPattern = true) {
  const pattern = { id: 'pattern' } as unknown as CanvasPattern;
  return {
    canvas: document.createElement('canvas'),
    fillStyle: '' as unknown,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    ...(withPattern ? { createPattern: vi.fn(() => pattern) } : {}),
    pattern,
  };
}

let tileCtx: ReturnType<typeof createTileContext>;

beforeEach(() => {
  tileCtx = createTileContext();
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    tileCtx as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BOARD-1007: effectiveGridSpacing', () => {
  it('keeps the base spacing when it is dense enough on screen', () => {
    expect(effectiveGridSpacing(24, 1)).toBe(24);
    expect(effectiveGridSpacing(24, 0.5)).toBe(24);
    expect(effectiveGridSpacing(24, 4)).toBe(24);
  });

  it('doubles the spacing on jam-grid multiples when zoomed out', () => {
    expect(effectiveGridSpacing(24, 0.25)).toBe(48);
    expect(effectiveGridSpacing(24, 0.1)).toBe(192);
    for (const zoom of [0.05, 0.13, 0.3, 0.49]) {
      const spacing = effectiveGridSpacing(24, zoom);
      expect(spacing * zoom).toBeGreaterThanOrEqual(MIN_GRID_SCREEN_SPACING);
      expect(spacing % 24).toBe(0);
    }
  });

  it('returns 0 for invalid spacing or zoom', () => {
    expect(effectiveGridSpacing(0, 1)).toBe(0);
    expect(effectiveGridSpacing(24, 0)).toBe(0);
    expect(effectiveGridSpacing(Number.NaN, 1)).toBe(0);
    expect(effectiveGridSpacing(24, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('BOARD-1007: assertBackground', () => {
  it('accepts none, dots, and grid and rejects anything else', () => {
    expect(assertBackground('none')).toBe('none');
    expect(assertBackground('dots')).toBe('dots');
    expect(assertBackground('grid')).toBe('grid');
    expect(() => assertBackground('lines')).toThrow(RangeError);
    expect(() => assertBackground(undefined)).toThrow(RangeError);
  });
});

describe('BOARD-1007: BackgroundPainter', () => {
  const rect = { x: 0, y: 0, w: 800, h: 600 };

  it('paints nothing for the plain background', () => {
    const ctx = createMainContext();
    new BackgroundPainter().paint(ctx as never, rect, camera(0, 0, 1), 1, tokens, 'none');
    expect(ctx.createPattern).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('fills dots with one pattern fill instead of one call per dot', () => {
    const ctx = createMainContext();
    new BackgroundPainter().paint(ctx as never, rect, camera(0, 0, 1), 2, tokens, 'dots');

    expect(ctx.createPattern).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe(ctx.pattern);
    expect(tileCtx.arc).toHaveBeenCalledTimes(1);
    // 24px at zoom 1 and DPR 2 is a 48px tile with a 2 device-pixel dot at its center.
    expect(tileCtx.arc).toHaveBeenCalledWith(24, 24, 2, 0, Math.PI * 2);
    expect(tileCtx.fillStyle).toBe(tokens.gridDot);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('aligns the pattern with board coordinates and covers the requested rect', () => {
    const ctx = createMainContext();
    // Zoom 1.1 gives a 26.4 device-pixel cell drawn from a 26px tile scaled by 26.4 / 26.
    new BackgroundPainter().paint(ctx as never, rect, camera(100, -50, 1.1), 1, tokens, 'dots');

    const dev = 24 * 1.1;
    const s = dev / 26;
    const e = -100 * 1.1 - dev / 2;
    const f = 50 * 1.1 - dev / 2;
    const [a, , , d, te, tf] = ctx.setTransform.mock.calls[0]!;
    expect(a).toBeCloseTo(s);
    expect(d).toBeCloseTo(s);
    expect(te).toBeCloseTo(e);
    expect(tf).toBeCloseTo(f);

    // The filled rect maps back onto the device rect through the pattern transform.
    const [fx, fy, fw, fh] = ctx.fillRect.mock.calls[0]!;
    expect(fx * s + e).toBeCloseTo(rect.x);
    expect(fy * s + f).toBeCloseTo(rect.y);
    expect(fw * s).toBeCloseTo(rect.w);
    expect(fh * s).toBeCloseTo(rect.h);

    // A tile center (pattern space T/2) lands on board x = 0.
    expect(13 * s + e).toBeCloseTo(-100 * 1.1);
  });

  it('reuses the cached tile until the tile size, mode, or color changes', () => {
    const ctx = createMainContext();
    const painter = new BackgroundPainter();
    painter.paint(ctx as never, rect, camera(0, 0, 1), 1, tokens, 'dots');
    painter.paint(ctx as never, rect, camera(40, 40, 1), 1, tokens, 'dots');
    expect(ctx.createPattern).toHaveBeenCalledTimes(1);

    painter.paint(ctx as never, rect, camera(0, 0, 2), 1, tokens, 'dots');
    expect(ctx.createPattern).toHaveBeenCalledTimes(2);

    painter.paint(ctx as never, rect, camera(0, 0, 2), 1, tokens, 'grid');
    expect(ctx.createPattern).toHaveBeenCalledTimes(3);

    painter.paint(ctx as never, rect, camera(0, 0, 2), 1, { ...tokens, gridDot: '#000' }, 'grid');
    expect(ctx.createPattern).toHaveBeenCalledTimes(4);
  });

  it('draws grid lines as a horizontal and a vertical bar in the tile', () => {
    const ctx = createMainContext();
    new BackgroundPainter().paint(ctx as never, rect, camera(0, 0, 1), 1, tokens, 'grid');

    expect(tileCtx.arc).not.toHaveBeenCalled();
    expect(tileCtx.fillRect).toHaveBeenCalledTimes(2);
    expect(tileCtx.fillRect).toHaveBeenCalledWith(12, 0, 1, 24);
    expect(tileCtx.fillRect).toHaveBeenCalledWith(0, 12, 24, 1);
  });

  it('draws cells directly when zoomed far in, keeping the dot size constant', () => {
    const ctx = createMainContext();
    // 24px * zoom 8 * DPR 3 = 576 device pixels per cell, above the tile limit.
    new BackgroundPainter().paint(
      ctx as never,
      { x: 0, y: 0, w: 1200, h: 600 },
      camera(0, 0, 8),
      3,
      tokens,
      'dots',
    );

    expect(ctx.createPattern).not.toHaveBeenCalled();
    // Columns at x = 0, 576, 1152 and rows at y = 0, 576.
    expect(ctx.arc).toHaveBeenCalledTimes(6);
    expect(ctx.arc).toHaveBeenCalledWith(576, 576, 3, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

  it('skips painting when the context cannot create patterns', () => {
    const ctx = createMainContext(false);
    expect(() =>
      new BackgroundPainter().paint(ctx as never, rect, camera(0, 0, 1), 1, tokens, 'dots'),
    ).not.toThrow();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

describe('BOARD-1007: BoardView.background', () => {
  let boards: Board[] = [];
  let views: BoardView[] = [];
  const frames: FrameRequestCallback[] = [];
  let mainCtx: ReturnType<typeof createMainContext> & { clearRect: () => void };

  function flushFrames(): void {
    for (const cb of frames.splice(0)) cb(0);
  }

  beforeEach(() => {
    mainCtx = { ...createMainContext(), clearRect: vi.fn() };
    Object.assign(window, {
      requestAnimationFrame: (cb: FrameRequestCallback) => frames.push(cb),
      cancelAnimationFrame: () => {},
      devicePixelRatio: 1,
    });
    vi.mocked(window.HTMLCanvasElement.prototype.getContext).mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      // Layer canvases get the main context; tiles created by the painter get the tile context.
      return (this.dataset.kujamLayer ? mainCtx : tileCtx) as unknown as RenderingContext;
    } as never);
  });

  afterEach(() => {
    for (const view of views) view.unmount();
    for (const board of boards) board.dispose();
    views = [];
    boards = [];
    frames.length = 0;
    document.body.innerHTML = '';
  });

  function setup(options: Parameters<typeof mountRenderer>[2] = {}) {
    const container = document.body.appendChild(document.createElement('div'));
    const board = createBoard();
    boards.push(board);
    const view = mountRenderer(board, container, options);
    views.push(view);
    board.camera.setViewport({ width: 800, height: 600 });
    return { board, view };
  }

  it('defaults to dots and paints the pattern on render', () => {
    const { view } = setup();
    expect(view.background).toBe('dots');
    flushFrames();
    expect(mainCtx.createPattern).toHaveBeenCalled();
  });

  it('accepts the background option and validates it', () => {
    const { view } = setup({ background: 'none' });
    expect(view.background).toBe('none');
    flushFrames();
    expect(mainCtx.createPattern).not.toHaveBeenCalled();

    expect(() => setup({ background: 'stripes' as never })).toThrow(RangeError);
  });

  it('repaints the whole view when the background changes', () => {
    const { view } = setup({ background: 'none' });
    flushFrames();
    const before = view.stats.frameCount;

    view.background = 'grid';
    flushFrames();
    expect(view.background).toBe('grid');
    expect(view.stats.frameCount).toBe(before + 1);
    expect(view.stats.fullRedraw).toBe(true);
    expect(mainCtx.createPattern).toHaveBeenCalledTimes(1);

    expect(() => {
      view.background = 'stripes' as never;
    }).toThrow(RangeError);
    expect(view.background).toBe('grid');
  });
});
