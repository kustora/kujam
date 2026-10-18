import { describe, expect, it } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  getReadingOrder,
  nextInReadingOrder,
  object,
  revealBounds,
  sortReadingOrder,
  string,
  type Board,
  type ReadingOrderItem,
} from '../index.js';

const note = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});
const notes = definePlugin({ id: 'notes', elements: [note] });

function item(id: string, x: number, y: number, w = 100, h = 100, parentId: string | null = null) {
  return { id, parentId, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h } };
}

function boardWith(...elements: [string, number, number][]): Board {
  const board = createBoard({ plugins: [notes] });
  for (const [id, x, y] of elements) board.create({ id, type: 'note', x, y, w: 100, h: 100 });
  return board;
}

describe('BOARD-1901: sortReadingOrder', () => {
  it('reads rows top to bottom and left to right within a row', () => {
    const items: ReadingOrderItem[] = [
      item('c', 0, 300),
      item('b', 220, 0),
      item('a', 0, 0),
      item('d', 220, 310),
    ];
    expect(sortReadingOrder(items)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps side-by-side elements with slightly different tops in one row', () => {
    // `left` starts 40 units lower than `right`, but above its vertical center: same row.
    const items = [item('right', 300, 0), item('left', 0, 40), item('below', 0, 200)];
    expect(sortReadingOrder(items)).toEqual(['left', 'right', 'below']);
  });

  it('starts a new row once an element begins below the row center', () => {
    const items = [item('top', 300, 0), item('lower', 0, 60)];
    expect(sortReadingOrder(items)).toEqual(['top', 'lower']);
  });

  it('reads each frame right after itself, before the next top-level element', () => {
    const items = [
      item('frame', 0, 0, 400, 400),
      item('after', 500, 0),
      item('child-b', 200, 50, 50, 50, 'frame'),
      item('child-a', 20, 50, 50, 50, 'frame'),
      item('grandchild', 30, 60, 10, 10, 'child-a'),
    ];
    expect(sortReadingOrder(items)).toEqual(['frame', 'child-a', 'grandchild', 'child-b', 'after']);
  });

  it('treats a missing parent as top level and still reads parent cycles', () => {
    const items = [
      item('orphan', 0, 0, 100, 100, 'gone'),
      item('x', 0, 200, 100, 100, 'y'),
      item('y', 0, 300, 100, 100, 'x'),
    ];
    const order = sortReadingOrder(items);
    expect(order[0]).toBe('orphan');
    expect(order.slice(1).sort()).toEqual(['x', 'y']);
  });

  it('is deterministic for equal positions', () => {
    const items = [item('b', 0, 0), item('a', 0, 0), item('c', 0, 0)];
    expect(sortReadingOrder(items)).toEqual(['a', 'b', 'c']);
    expect(sortReadingOrder([...items].reverse())).toEqual(['a', 'b', 'c']);
  });
});

describe('BOARD-1901: getReadingOrder', () => {
  it('orders the current page by position, not by layer', () => {
    const board = boardWith(['c', 0, 300], ['b', 200, 0], ['a', 0, 0]);
    const order = getReadingOrder(board);
    expect(order.ids).toEqual(['a', 'b', 'c']);
    expect(order.indexOf('b')).toBe(1);
    expect(order.indexOf('missing')).toBe(-1);
    expect(Object.isFrozen(order.ids)).toBe(true);
  });

  it('keeps the same order object for text edits and recomputes after moves', () => {
    const board = boardWith(['a', 0, 0], ['b', 200, 0]);
    const first = getReadingOrder(board);
    expect(getReadingOrder(board)).toBe(first);

    board.update('a', { props: { text: 'hello' } });
    expect(getReadingOrder(board)).toBe(first);

    board.update('a', { x: 400 });
    const moved = getReadingOrder(board);
    expect(moved).not.toBe(first);
    expect(moved.ids).toEqual(['b', 'a']);

    board.create({ id: 'c', type: 'note', x: 0, y: 500, w: 10, h: 10 });
    expect(getReadingOrder(board).ids).toEqual(['b', 'a', 'c']);
    board.delete('b');
    expect(getReadingOrder(board).ids).toEqual(['a', 'c']);
  });

  it('follows the current page and does not subscribe to the board', () => {
    const board = boardWith(['a', 0, 0]);
    let listeners = 0;
    const on = board.on.bind(board);
    board.on = ((type: never, fn: never) => {
      listeners++;
      return on(type, fn);
    }) as Board['on'];
    expect(getReadingOrder(board).ids).toEqual(['a']);
    const page = board.pages.create({ name: 'Dua' });
    board.pages.setCurrent(page.id);
    expect(getReadingOrder(board).ids).toEqual([]);
    expect(listeners).toBe(0);
  });

  it('throws after dispose', () => {
    const board = boardWith();
    board.dispose();
    expect(() => getReadingOrder(board)).toThrow(/dispose/);
  });

  it('sorts 5,000 elements once and serves later reads from the cache', () => {
    const board = createBoard({ plugins: [notes], freezeSnapshots: false });
    board.transact(() => {
      for (let i = 0; i < 5000; i++) {
        board.create({
          type: 'note',
          x: (i % 100) * 120,
          y: Math.floor(i / 100) * 120,
          w: 100,
          h: 100,
        });
      }
    });
    const order = getReadingOrder(board);
    expect(order.ids).toHaveLength(5000);
    const first = board.getElement(order.ids[0]!)!;
    const second = board.getElement(order.ids[1]!)!;
    expect([first.x, first.y, second.x, second.y]).toEqual([0, 0, 120, 0]);
    expect(getReadingOrder(board)).toBe(order);
  });
});

describe('BOARD-1902: nextInReadingOrder', () => {
  it('walks forward and backward and stops at both ends', () => {
    const board = boardWith(['b', 200, 0], ['a', 0, 0]);
    expect(nextInReadingOrder(board, null)).toBe('a');
    expect(nextInReadingOrder(board, 'a')).toBe('b');
    expect(nextInReadingOrder(board, 'b')).toBeUndefined();
    expect(nextInReadingOrder(board, 'b', 'previous')).toBe('a');
    expect(nextInReadingOrder(board, 'a', 'previous')).toBeUndefined();
    expect(nextInReadingOrder(board, null, 'previous')).toBeUndefined();
    expect(nextInReadingOrder(board, 'deleted')).toBe('a');
  });

  it('returns nothing on an empty page', () => {
    expect(nextInReadingOrder(boardWith(), null)).toBeUndefined();
  });
});

describe('BOARD-1902: revealBounds', () => {
  function viewBoard(): Board {
    const board = boardWith();
    board.camera.setViewport({ width: 800, height: 600 });
    return board;
  }

  it('does nothing when the bounds are already visible', () => {
    const board = viewBoard();
    expect(revealBounds(board, { minX: 100, minY: 100, maxX: 200, maxY: 200 })).toBe(false);
    expect(board.camera.get()).toMatchObject({ x: 0, y: 0 });
  });

  it('pans by the smallest amount, keeping the padding, without zooming', () => {
    const board = viewBoard();
    board.camera.set({ zoom: 2 });
    // Viewport covers 0..400 × 0..300 at zoom 2; padding 48 px is 24 units.
    expect(revealBounds(board, { minX: 500, minY: 100, maxX: 550, maxY: 150 })).toBe(true);
    expect(board.camera.get()).toEqual({ x: 550 + 24 - 400, y: 0, zoom: 2 });
    expect(revealBounds(board, { minX: -100, minY: -60, maxX: -50, maxY: -10 })).toBe(true);
    expect(board.camera.get()).toMatchObject({ x: -124, y: -84 });
  });

  it('centers bounds larger than the viewport and honors a custom padding', () => {
    const board = viewBoard();
    revealBounds(board, { minX: 1000, minY: 0, maxX: 3000, maxY: 100 }, { padding: 0 });
    expect(board.camera.get().x).toBe(2000 - 400);
  });

  it('returns false before the viewport is known', () => {
    const board = boardWith();
    expect(revealBounds(board, { minX: 5000, minY: 0, maxX: 5100, maxY: 100 })).toBe(false);
  });
});
