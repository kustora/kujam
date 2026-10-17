import { describe, expect, it } from 'vitest';
import {
  computeSnap,
  createBoard,
  DEFAULT_SNAP_OPTIONS,
  defineElement,
  definePlugin,
  isSnapSuppressed,
  object,
  snapTranslation,
  string,
  type Board,
  type InputModifiers,
} from './index.js';

const NO_MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

describe('BOARD-407: computeSnap', () => {
  it('snaps to the closest target within the threshold and returns a guide', () => {
    const result = computeSnap(
      [{ x: 10, y: 0 }],
      [
        { x: 12, y: 50 },
        { x: 14, y: 80 },
      ],
      {
        threshold: 5,
      },
    );
    expect(result.dx).toBe(2);
    expect(result.dy).toBe(0);
    expect(result.guides).toEqual([
      { axis: 'x', position: 12, from: 0, to: 50, source: 'element' },
    ]);
  });

  it('ignores targets beyond the threshold', () => {
    expect(computeSnap([{ x: 0, y: 0 }], [{ x: 6, y: 6 }], { threshold: 5 })).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    });
  });

  it('snaps x and y independently', () => {
    const result = computeSnap(
      [{ x: 0, y: 0 }],
      [
        { x: 3, y: 100 },
        { x: 100, y: -2 },
      ],
      {
        threshold: 5,
      },
    );
    expect(result).toMatchObject({ dx: 3, dy: -2 });
    expect(result.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
  });

  it('merges aligned points into one guide spanning all of them', () => {
    const moving = [
      { x: 10, y: 0 },
      { x: 10, y: 20 },
    ];
    const targets = [
      { x: 11, y: -30 },
      { x: 11, y: 60 },
    ];
    const { guides } = computeSnap(moving, targets, { threshold: 2 });
    expect(guides).toEqual([{ axis: 'x', position: 11, from: -30, to: 60, source: 'element' }]);
  });

  it('snaps to the grid and reports grid guides', () => {
    const result = computeSnap(
      [
        { x: 3, y: 13 },
        { x: 9, y: 19 },
      ],
      [],
      { threshold: 5, grid: 8 },
    );
    expect(result).toMatchObject({ dx: -1, dy: 3 });
    expect(result.guides).toContainEqual({
      axis: 'x',
      position: 8,
      from: 22,
      to: 22,
      source: 'grid',
    });
    expect(result.guides).toContainEqual({
      axis: 'y',
      position: 16,
      from: 2,
      to: 2,
      source: 'grid',
    });
  });

  it('prefers an element over the grid on a tie', () => {
    const result = computeSnap([{ x: 4, y: 100 }], [{ x: 0, y: 0 }], { threshold: 5, grid: 8 });
    expect(result.dx).toBe(-4);
    expect(result.guides.find((g) => g.axis === 'x')?.source).toBe('element');
  });
});

const note = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});
const plugin = definePlugin({ id: 'notes', elements: [note] });

/** `a` at (0, 0) 100 × 100 and `b` at (200, 0) 50 × 50; grid snapping off unless enabled. */
function setup(grid: number | null = null): Board {
  const board = createBoard({ plugins: [plugin], snap: { grid } });
  board.create({ id: 'a', type: 'note', x: 0, y: 0, w: 100, h: 100 });
  board.create({ id: 'b', type: 'note', x: 200, y: 0, w: 50, h: 50 });
  return board;
}

describe('BOARD-407: snapTranslation on a board', () => {
  it('snaps the dragged elements to the edges of other elements', () => {
    const board = setup();
    const b = board.getElement('b')!;
    // b's left edge would land at 103; a's right edge is at 100.
    const result = snapTranslation(board, [b], { x: -97, y: 0 });
    expect(result.delta).toEqual({ x: -100, y: 0 });
    expect(result.guides).toContainEqual(expect.objectContaining({ axis: 'x', position: 100 }));
  });

  it('snaps to centers', () => {
    const board = setup();
    // b's center (225, 25) moved by (-173, 22) lands at (52, 47); a's center is (50, 50).
    const result = snapTranslation(board, [board.getElement('b')!], { x: -173, y: 22 });
    expect(result.delta).toEqual({ x: -175, y: 25 });
  });

  it('measures the threshold in screen pixels', () => {
    const board = setup();
    const b = board.getElement('b')!;
    // 5 board units away: inside 8 px at zoom 1, outside at zoom 2 (8 px = 4 units).
    expect(snapTranslation(board, [b], { x: -95, y: 0 }).delta.x).toBe(-100);
    board.camera.set({ zoom: 2 });
    expect(snapTranslation(board, [b], { x: -95, y: 0 }).delta.x).toBe(-95);
  });

  it('is turned off by Ctrl/Cmd, by the board settings, or per call', () => {
    const board = setup();
    const b = board.getElement('b')!;
    const drag = { x: -97, y: 0 };
    expect(
      snapTranslation(board, [b], drag, { modifiers: { ...NO_MODS, ctrl: true } }).delta,
    ).toEqual(drag);
    expect(
      snapTranslation(board, [b], drag, { modifiers: { ...NO_MODS, meta: true } }).delta,
    ).toEqual(drag);
    expect(snapTranslation(board, [b], drag, { snap: { enabled: false } }).delta).toEqual(drag);
    board.setSnapOptions({ enabled: false });
    expect(snapTranslation(board, [b], drag).delta).toEqual(drag);
    expect(isSnapSuppressed(NO_MODS)).toBe(false);
  });

  it('snaps to the 8-unit grid by default and can change or disable it', () => {
    const board = createBoard({ plugins: [plugin] });
    expect(board.snapOptions).toEqual(DEFAULT_SNAP_OPTIONS);
    // Edges and center of a 16 × 16 element moved by (3, 13): x 3, 11, 19 and y 13, 21, 29.
    const el = board.create({ id: 'solo', type: 'note', x: 0, y: 0, w: 16, h: 16 })!;
    expect(snapTranslation(board, [el], { x: 3, y: 13 }).delta).toEqual({ x: 0, y: 16 });

    // Grid 20: the right edge 19 → 20 and the center 21 → 20 are the closest lines.
    board.setSnapOptions({ grid: 20 });
    expect(snapTranslation(board, [el], { x: 3, y: 13 }).delta).toEqual({ x: 4, y: 12 });

    board.setSnapOptions({ grid: null });
    expect(snapTranslation(board, [el], { x: 3, y: 13 }).delta).toEqual({ x: 3, y: 13 });
  });

  it('only snaps to visible elements on the same page', () => {
    const board = setup();
    board.camera.setViewport({ width: 150, height: 150 });
    board.camera.set({ x: 160, y: -10 }); // shows x 160..310: `a` is off screen.
    const b = board.getElement('b')!;
    expect(snapTranslation(board, [b], { x: -97, y: 3 }).delta).toEqual({ x: -97, y: 3 });
  });

  it('ignores elements on other pages', () => {
    const board = setup();
    board.transact((tx) => {
      tx.put({ kind: 'page', id: 'page:two', name: 'Two', index: 'a1', meta: {} });
      tx.put({ ...board.getElement('a')!, pageId: 'page:two' });
    });
    const b = board.getElement('b')!;
    expect(snapTranslation(board, [b], { x: -97, y: 3 }).delta).toEqual({ x: -97, y: 3 });
  });

  it('validates snap settings', () => {
    const board = setup();
    expect(() => board.setSnapOptions({ grid: -1 })).toThrow(RangeError);
    expect(() => board.setSnapOptions({ threshold: Number.NaN })).toThrow(RangeError);
    expect(() => board.setSnapOptions({ enabled: 'yes' as never })).toThrow(TypeError);
    expect(board.snapOptions.grid).toBeNull();
    expect(() => createBoard({ snap: 5 as never })).toThrow(TypeError);
  });
});
