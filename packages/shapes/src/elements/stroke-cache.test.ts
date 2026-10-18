// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard, type Board, type ElementCanvasContext } from '@kujam/core';
import { defaultElements } from '../index.js';
import { detailLevel, simplifyOutline, StrokePathCache } from './stroke-cache.js';
import { traceStrokeOutline } from './stroke-utils.js';

/** Records the commands traced into it, like a `Path2D`. */
class FakePath2D {
  static created = 0;
  readonly commands: string[] = [];
  constructor() {
    FakePath2D.created++;
  }
  moveTo(x: number, y: number): void {
    this.commands.push(`M${x},${y}`);
  }
  lineTo(x: number, y: number): void {
    this.commands.push(`L${x},${y}`);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.commands.push(`Q${cx},${cy},${x},${y}`);
  }
  closePath(): void {
    this.commands.push('Z');
  }
}

/** Stands in for the window's `CanvasRenderingContext2D`, so `instanceof` checks pass. */
class FakeContext2D {
  readonly canvas = { ownerDocument: document };
  fillStyle: unknown = '';
  globalCompositeOperation = 'source-over';
  readonly filled: unknown[] = [];
  beginPath = vi.fn();
  moveTo = vi.fn();
  lineTo = vi.fn();
  quadraticCurveTo = vi.fn();
  closePath = vi.fn();
  fill = vi.fn((path?: unknown) => {
    this.filled.push(path);
  });
}

const originals = {
  Path2D: (window as unknown as Record<string, unknown>).Path2D,
  CanvasRenderingContext2D: (window as unknown as Record<string, unknown>).CanvasRenderingContext2D,
};

beforeEach(() => {
  FakePath2D.created = 0;
  Object.assign(window, { Path2D: FakePath2D, CanvasRenderingContext2D: FakeContext2D });
});

afterEach(() => {
  Object.assign(window, originals);
});

function ctx(): FakeContext2D & ElementCanvasContext {
  return new FakeContext2D() as unknown as FakeContext2D & ElementCanvasContext;
}

/** A closed, wiggly outline with many nearly collinear points. */
function wigglyOutline(n = 200): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([100 * Math.cos(t) + 0.05 * Math.sin(t * 40), 100 * Math.sin(t)]);
  }
  return out;
}

describe('BOARD-807: detailLevel', () => {
  it('keeps full detail at 50% zoom and above', () => {
    expect(detailLevel(4)).toBe(0);
    expect(detailLevel(1)).toBe(0);
    expect(detailLevel(0.51)).toBe(0);
  });

  it('adds one level per halving of the zoom', () => {
    expect(detailLevel(0.5)).toBe(1);
    expect(detailLevel(0.3)).toBe(1);
    expect(detailLevel(0.25)).toBe(2);
    expect(detailLevel(0.1)).toBe(3);
  });

  it('clamps extreme and invalid zoom values', () => {
    expect(detailLevel(1e-9)).toBe(8);
    expect(detailLevel(0)).toBe(0);
    expect(detailLevel(Number.NaN)).toBe(0);
  });
});

describe('BOARD-807: simplifyOutline', () => {
  it('returns the outline unchanged at level 0', () => {
    const outline = wigglyOutline();
    expect(simplifyOutline(outline, 0)).toBe(outline);
  });

  it('drops points at higher levels, staying within the on-screen tolerance', () => {
    const outline = wigglyOutline();
    const l1 = simplifyOutline(outline, 1);
    const l4 = simplifyOutline(outline, 4);
    expect(l1.length).toBeLessThan(outline.length);
    expect(l4.length).toBeLessThan(l1.length);
    expect(l4.length).toBeGreaterThanOrEqual(3);
  });
});

describe('BOARD-807: StrokePathCache', () => {
  const props = { points: [] };
  const brush = { id: 'pen' };

  it('builds the path once and reuses it while the deps are unchanged', () => {
    const cache = new StrokePathCache();
    const g = ctx();
    const build = vi.fn(() => wigglyOutline(20));

    cache.fill(g, 'a', [props, brush], 1, build);
    cache.fill(g, 'a', [props, brush], 1, build);
    cache.fill(g, 'a', [props, brush], 0.8, build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(FakePath2D.created).toBe(1);
    expect(g.fill).toHaveBeenCalledTimes(3);
    expect(g.filled[0]).toBeInstanceOf(FakePath2D);
    expect(g.filled[1]).toBe(g.filled[0]);
    // The context itself is never traced on a hit.
    expect(g.quadraticCurveTo).not.toHaveBeenCalled();
  });

  it('traces the same commands as drawing the outline directly', () => {
    const cache = new StrokePathCache();
    const g = ctx();
    const outline = wigglyOutline(20);
    cache.fill(g, 'a', [props], 1, () => outline);

    const expected = new FakePath2D();
    traceStrokeOutline(expected, outline);
    expect((g.filled[0] as FakePath2D).commands).toEqual(expected.commands);
  });

  it('rebuilds when the props or the brush change', () => {
    const cache = new StrokePathCache();
    const g = ctx();
    const build = vi.fn(() => wigglyOutline(20));

    cache.fill(g, 'a', [props, brush], 1, build);
    cache.fill(g, 'a', [{ ...props }, brush], 1, build);
    cache.fill(g, 'a', [props, { ...brush }], 1, build);
    expect(build).toHaveBeenCalledTimes(3);
  });

  it('treats cloned point arrays with equal content as unchanged', () => {
    const cache = new StrokePathCache();
    const g = ctx();
    const build = vi.fn(() => wigglyOutline(20));
    const points = [
      [0, 0],
      [10, 5, 0.5],
    ];

    cache.fill(g, 'a', [points, 4], 1, build);
    cache.fill(g, 'a', [structuredClone(points), 4], 1, build);
    expect(build).toHaveBeenCalledTimes(1);

    cache.fill(
      g,
      'a',
      [
        [
          [0, 0],
          [10, 6, 0.5],
        ],
        4,
      ],
      1,
      build,
    );
    cache.fill(
      g,
      'a',
      [
        [
          [0, 0],
          [10, 6, 0.5],
        ],
        5,
      ],
      1,
      build,
    );
    expect(build).toHaveBeenCalledTimes(3);
  });

  it('rebuilds on the next draw after the zoom crosses a detail level', () => {
    const cache = new StrokePathCache();
    const g = ctx();
    const build = vi.fn(() => wigglyOutline());

    cache.fill(g, 'a', [props], 1, build);
    cache.fill(g, 'a', [props], 0.2, build);
    cache.fill(g, 'a', [props], 0.15, build);
    cache.fill(g, 'a', [props], 1, build);

    expect(build).toHaveBeenCalledTimes(3);
    const [full, coarse, , back] = g.filled as FakePath2D[];
    expect(coarse!.commands.length).toBeLessThan(full!.commands.length);
    expect(back!.commands).toEqual(full!.commands);
  });

  it('evicts the least recently drawn strokes when full', () => {
    const cache = new StrokePathCache(8);
    const g = ctx();
    const build = vi.fn(() => wigglyOutline(10));

    for (let i = 0; i < 8; i++) cache.fill(g, `s${i}`, [props], 1, build);
    // Keep s0 and s1 recently drawn, as if they were still on screen.
    cache.fill(g, 's0', [props], 1, build);
    cache.fill(g, 's1', [props], 1, build);
    cache.fill(g, 'new', [props], 1, build);

    expect(cache.size).toBeLessThanOrEqual(8);
    build.mockClear();
    cache.fill(g, 's0', [props], 1, build);
    cache.fill(g, 's1', [props], 1, build);
    cache.fill(g, 'new', [props], 1, build);
    expect(build).not.toHaveBeenCalled();
    // The oldest untouched stroke was dropped and needs a rebuild.
    cache.fill(g, 's2', [props], 1, build);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('draws directly without caching on contexts that cannot fill a Path2D', () => {
    const cache = new StrokePathCache();
    const plain = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
    } as unknown as ElementCanvasContext;
    const build = vi.fn(() => wigglyOutline(10));

    cache.fill(plain, 'a', [props], 1, build);
    cache.fill(plain, 'a', [props], 1, build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
    expect(FakePath2D.created).toBe(0);
    expect(plain.fill).toHaveBeenCalledWith();
  });

  it('skips empty outlines', () => {
    const cache = new StrokePathCache();
    const g = ctx();
    cache.fill(g, 'a', [props], 1, () => []);
    expect(g.fill).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });
});

describe('BOARD-807: draw element uses the cache', () => {
  let board: Board;

  beforeEach(() => {
    board = createBoard({ plugins: [defaultElements] });
  });

  afterEach(() => board.dispose());

  function drawStroke(g: ElementCanvasContext, id: string, zoom = 1): void {
    const el = board.getElement(id)!;
    const def = board.elements.get('draw')!;
    def.render!.canvas!(g, el as never, undefined, { zoom, compact: false }, board.elementContext);
  }

  it('reuses the path when a stroke moves, and rebuilds when its points change', () => {
    const el = board.create({
      type: 'draw',
      x: 0,
      y: 0,
      props: {
        points: [
          [0, 0],
          [40, 10],
          [80, 0],
        ],
      },
    });
    const g = ctx();

    drawStroke(g, el.id);
    board.update(el.id, { x: 200, y: 50 });
    drawStroke(g, el.id);
    expect(FakePath2D.created).toBe(1);
    expect(g.filled[1]).toBe(g.filled[0]);

    board.update(el.id, {
      props: {
        points: [
          [0, 0],
          [40, 30],
          [80, 0],
        ],
      },
    });
    drawStroke(g, el.id);
    expect(FakePath2D.created).toBe(2);
    expect(g.filled[2]).not.toBe(g.filled[0]);
  });

  it('keeps one cache per board so equal IDs never share a path', () => {
    const other = createBoard({ plugins: [defaultElements] });
    try {
      const points = [
        [0, 0],
        [50, 50],
      ];
      board.create({ id: 'same', type: 'draw', x: 0, y: 0, props: { points } });
      other.create({ id: 'same', type: 'draw', x: 0, y: 0, props: { points } });
      const g = ctx();

      drawStroke(g, 'same');
      const otherEl = other.getElement('same')!;
      other.elements.get('draw')!.render!.canvas!(
        g,
        otherEl as never,
        undefined,
        { zoom: 1, compact: false },
        other.elementContext,
      );
      drawStroke(g, 'same');

      expect(FakePath2D.created).toBe(2);
      expect(g.filled[2]).toBe(g.filled[0]);
    } finally {
      other.dispose();
    }
  });
});
