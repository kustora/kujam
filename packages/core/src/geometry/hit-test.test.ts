import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  ellipse,
  number,
  object,
  polyline,
  string,
  type Board,
  type ElementRecord,
} from '../index.js';

const box = defineElement({
  type: 'box',
  version: 1,
  props: object({ label: string() }),
  defaults: { label: '' },
});

const oval = defineElement({
  type: 'oval',
  version: 1,
  props: object({}),
  defaults: {},
  geometry: (el) => ellipse(el.w, el.h),
});

const line = defineElement({
  type: 'line',
  version: 1,
  props: object({ thickness: number() }),
  defaults: { thickness: 4 },
  geometry: (el) =>
    polyline(
      [
        { x: 0, y: 0 },
        { x: el.w, y: 0 },
      ],
      el.props.thickness,
    ),
});

const broken = defineElement({
  type: 'broken',
  version: 1,
  props: object({}),
  defaults: {},
  geometry: () => {
    throw new Error('boom');
  },
});

const shapes = definePlugin({ id: 'shapes', elements: [box, oval, line, broken] });

function makeBoard(): Board {
  return createBoard({ plugins: [shapes] });
}

describe('BOARD-404: board.hitTest', () => {
  it('returns the topmost element by layer index', () => {
    const board = makeBoard();
    board.create({ id: 'bottom', type: 'box', x: 0, y: 0, w: 100, h: 100 });
    board.create({ id: 'top', type: 'box', x: 50, y: 50, w: 100, h: 100 });

    expect(board.hitTest({ x: 75, y: 75 })?.id).toBe('top');
    expect(board.hitTest({ x: 25, y: 25 })?.id).toBe('bottom');
    expect(board.hitTest({ x: 500, y: 500 })).toBeUndefined();
  });

  it('follows layer changes made with update', () => {
    const board = makeBoard();
    const a = board.create({ id: 'a', type: 'box', w: 100, h: 100 })!;
    board.create({ id: 'b', type: 'box', w: 100, h: 100 });
    expect(board.hitTest({ x: 50, y: 50 })?.id).toBe('b');

    board.update(a.id, { index: 'z' });
    expect(board.hitTest({ x: 50, y: 50 })?.id).toBe('a');
  });

  it('uses element geometry and rotation', () => {
    const board = makeBoard();
    board.create({ id: 'o', type: 'oval', x: 0, y: 0, w: 100, h: 50 });
    // Inside the box but outside the ellipse.
    expect(board.hitTest({ x: 3, y: 3 })).toBeUndefined();
    expect(board.hitTest({ x: 50, y: 25 })?.id).toBe('o');

    // Rotated 90° around (150, 25), a 100×50 box covers x 125..175, y -25..75.
    board.create({ id: 'r', type: 'box', x: 100, y: 0, w: 100, h: 50, rotation: 90 });
    expect(board.hitTest({ x: 150, y: 70 })?.id).toBe('r');
    expect(board.hitTest({ x: 190, y: 25 })).toBeUndefined();
  });

  it('converts the screen-pixel tolerance with the camera zoom', () => {
    const board = makeBoard();
    board.create({ id: 'b', type: 'box', x: 0, y: 0, w: 100, h: 100 });
    const point = { x: 104, y: 50 };

    expect(board.hitTest(point)).toBeUndefined();
    expect(board.hitTest(point, { tolerance: 5 })?.id).toBe('b');

    board.setCamera({ zoom: 2 }); // 5 px = 2.5 board units
    expect(board.hitTest(point, { tolerance: 5 })).toBeUndefined();

    board.setCamera({ zoom: 0.5 }); // 5 px = 10 board units
    expect(board.hitTest({ x: 109, y: 50 }, { tolerance: 5 })?.id).toBe('b');
  });

  it('hits thin lines within their stroke thickness plus tolerance', () => {
    const board = makeBoard();
    board.create({ id: 'l', type: 'line', x: 0, y: 0, w: 100, h: 0, props: { thickness: 4 } });
    expect(board.hitTest({ x: 50, y: 2 })?.id).toBe('l');
    expect(board.hitTest({ x: 50, y: 5 })).toBeUndefined();
    expect(board.hitTest({ x: 50, y: 5 }, { tolerance: 3 })?.id).toBe('l');
  });

  it('skips locked elements unless includeLocked is set', () => {
    const board = makeBoard();
    board.create({ id: 'under', type: 'box', w: 100, h: 100 });
    board.create({ id: 'locked', type: 'box', w: 100, h: 100, locked: true });

    expect(board.hitTest({ x: 50, y: 50 })?.id).toBe('under');
    expect(board.hitTest({ x: 50, y: 50 }, { includeLocked: true })?.id).toBe('locked');
  });

  it('puts children of a container above the container, regardless of index', () => {
    const board = makeBoard();
    const child = board.create({ id: 'child', type: 'box', x: 10, y: 10, w: 20, h: 20 })!;
    const frame = board.create({ id: 'frame', type: 'box', x: 0, y: 0, w: 200, h: 200 })!;
    board.update(child.id, { parentId: frame.id, index: 'a0' });
    expect(board.getElement('child')!.index < board.getElement('frame')!.index).toBe(true);

    expect(board.hitTest({ x: 15, y: 15 })?.id).toBe('child');
    expect(board.hitTest({ x: 150, y: 150 })?.id).toBe('frame');

    // A root element above the frame covers the frame's children.
    board.create({ id: 'cover', type: 'box', x: 0, y: 0, w: 50, h: 50 });
    expect(board.hitTest({ x: 15, y: 15 })?.id).toBe('cover');
  });

  it('orders nested children by their whole ancestor chain', () => {
    const board = makeBoard();
    board.create({ id: 'outer', type: 'box', w: 300, h: 300, index: 'a5' });
    board.create({ id: 'g1', type: 'box', w: 200, h: 200, parentId: 'outer', index: 'a1' });
    board.create({ id: 'g2', type: 'box', w: 200, h: 200, parentId: 'outer', index: 'a2' });
    // Highest index, but inside the lower group g1: still below g2.
    board.create({ id: 'deep', type: 'box', w: 100, h: 100, parentId: 'g1', index: 'z' });
    expect(board.hitTest({ x: 50, y: 50 })?.id).toBe('g2');
  });

  it('tolerates dangling and cyclic parent chains', () => {
    const board = makeBoard();
    const el = (id: string, parentId: string | null, index: string): ElementRecord => ({
      kind: 'element',
      id,
      type: 'box',
      pageId: 'page:main',
      parentId,
      index,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      props: { label: '' },
      meta: {},
    });
    board.transact((tx) => {
      tx.put(el('orphan', 'missing', 'a1'));
      tx.put(el('loop-a', 'loop-b', 'a2'));
      tx.put(el('loop-b', 'loop-a', 'a3'));
    });
    expect(board.hitTest({ x: 50, y: 50 })?.id).toBeDefined();
  });

  it('filters by page', () => {
    const board = makeBoard();
    board.transact((tx) =>
      tx.put({ kind: 'page', id: 'page:two', name: 'Two', index: 'a1', meta: {} } as never),
    );
    board.create({ id: 'p1', type: 'box', w: 100, h: 100 });
    board.create({ id: 'p2', type: 'box', w: 100, h: 100, pageId: 'page:two' });

    expect(board.getElement('p1')!.index).toBe(board.getElement('p2')!.index);
    // Without a page filter, only the current page is tested (BOARD-208).
    expect(board.hitTest({ x: 50, y: 50 })?.id).toBe('p1');
    // Across all pages, equal paint order is broken by ID.
    expect(board.hitTest({ x: 50, y: 50 }, { allPages: true })?.id).toBe('p2');
    expect(board.hitTest({ x: 50, y: 50 }, { pageId: 'page:main' })?.id).toBe('p1');
    expect(board.hitTest({ x: 50, y: 50 }, { pageId: 'page:two' })?.id).toBe('p2');
    expect(board.hitTest({ x: 50, y: 50 }, { pageId: 'page:none' })).toBeUndefined();
  });

  it('falls back to the element box for unknown types and throwing geometry', () => {
    const board = makeBoard();
    board.create({ id: 'b', type: 'broken', x: 0, y: 0, w: 100, h: 100 });
    expect(board.hitTest({ x: 90, y: 90 })?.id).toBe('b');

    board.transact((tx) =>
      tx.put({ ...board.getElement('b')!, id: 'u', type: 'unknown', x: 200 } as ElementRecord),
    );
    expect(board.hitTest({ x: 290, y: 90 })?.id).toBe('u');
  });

  it('uses the spatial index for candidates', () => {
    const board = makeBoard();
    board.create({ id: 'b', type: 'box', w: 100, h: 100 });
    const search = vi.spyOn(board.spatial, 'search');
    board.hitTest({ x: 50, y: 50 }, { tolerance: 4 });
    expect(search).toHaveBeenCalledWith({ minX: 46, minY: 46, maxX: 54, maxY: 54 });
  });

  it('rejects invalid arguments and calls after dispose', () => {
    const board = makeBoard();
    expect(() => board.hitTest(null as never)).toThrow(TypeError);
    expect(() => board.hitTest({ x: Number.NaN, y: 0 })).toThrow(TypeError);
    expect(() => board.hitTest({ x: 0, y: 0 }, { tolerance: Infinity })).toThrow(TypeError);
    expect(() => board.hitTest({ x: 0, y: 0 }, { tolerance: '4' as never })).toThrow(TypeError);

    board.dispose();
    expect(() => board.hitTest({ x: 0, y: 0 })).toThrow('Papan sudah di-dispose.');
  });
});
