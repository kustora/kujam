import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  type Board,
  type BoardErrorEvent,
  type ElementRecord,
  type Point,
} from './index.js';

describe('BOARD-608: acceptDrop and dropAt (core API)', () => {
  it('registers drop handlers and inspects registered types', () => {
    const board = createBoard();

    expect(board.hasDropHandler('application/x-tayang-task')).toBe(false);
    expect(board.getDropTypes()).toEqual([]);

    const unsubscribe = board.acceptDrop('application/x-tayang-task', () => {});

    expect(board.hasDropHandler('application/x-tayang-task')).toBe(true);
    // Case-insensitive check for MIME types
    expect(board.hasDropHandler('APPLICATION/X-TAYANG-TASK')).toBe(true);
    expect(board.getDropTypes()).toEqual(['application/x-tayang-task']);

    unsubscribe();
    expect(board.hasDropHandler('application/x-tayang-task')).toBe(false);
    expect(board.getDropTypes()).toEqual([]);

    // Idempotent unsubscribe
    expect(() => unsubscribe()).not.toThrow();
  });

  it('allows multiple handlers for the same type and executes all', async () => {
    const board = createBoard();
    const calls: string[] = [];

    const un1 = board.acceptDrop('custom/item', (_payload, pt) => {
      calls.push(`h1 at ${pt.x},${pt.y}`);
    });
    const un2 = board.acceptDrop('custom/item', (_payload, pt) => {
      calls.push(`h2 at ${pt.x},${pt.y}`);
    });

    const result = await board.dropAt({ x: 10, y: 20 }, 'custom/item', { id: 'test' });
    expect(result).toEqual([]);
    expect(calls).toEqual(['h1 at 10,20', 'h2 at 10,20']);

    un1();
    expect(board.hasDropHandler('custom/item')).toBe(true);

    calls.length = 0;
    await board.dropAt({ x: 30, y: 40 }, 'custom/item', { id: 'test2' });
    expect(calls).toEqual(['h2 at 30,40']);

    un2();
    expect(board.hasDropHandler('custom/item')).toBe(false);
  });

  it('returns created element records from synchronous handler', async () => {
    const board = createBoard();
    const mockElement: ElementRecord = {
      id: 'el-1',
      kind: 'element',
      type: 'sticky',
      pageId: 'page:main',
      parentId: null,
      index: 'a0',
      x: 100,
      y: 150,
      w: 120,
      h: 120,
      rotation: 0,
      locked: false,
      opacity: 1,
      props: {},
      meta: {},
    };

    board.acceptDrop('tayang/post', (payload: { title: string }, point: Point) => {
      expect(payload.title).toBe('My Post');
      expect(point).toEqual({ x: 100, y: 150 });
      return [mockElement];
    });

    const created = await board.dropAt({ x: 100, y: 150 }, 'tayang/post', { title: 'My Post' });
    expect(created).toEqual([mockElement]);
  });

  it('returns created element records from asynchronous handler', async () => {
    const board = createBoard();
    const mockElement: ElementRecord = {
      id: 'el-async',
      kind: 'element',
      type: 'sticky',
      pageId: 'page:main',
      parentId: null,
      index: 'a0',
      x: 200,
      y: 300,
      w: 100,
      h: 100,
      rotation: 0,
      locked: false,
      opacity: 1,
      props: {},
      meta: {},
    };

    board.acceptDrop('async/item', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [mockElement];
    });

    const created = await board.dropAt({ x: 200, y: 300 }, 'async/item', { data: 123 });
    expect(created).toEqual([mockElement]);
  });

  it('returns empty array when handler returns void or non-array', async () => {
    const board = createBoard();
    board.acceptDrop('void/item', () => {
      // returns undefined
    });

    const created = await board.dropAt({ x: 50, y: 50 }, 'void/item', null);
    expect(created).toEqual([]);
  });

  it('returns empty array when dropping unregistered type', async () => {
    const board = createBoard();
    const created = await board.dropAt({ x: 0, y: 0 }, 'unknown/type', { data: 1 });
    expect(created).toEqual([]);
  });

  it('does not execute drop when board is read-only', async () => {
    const board = createBoard({ readOnly: true });
    const handler = vi.fn();
    board.acceptDrop('test/read-only', handler);

    const created = await board.dropAt({ x: 0, y: 0 }, 'test/read-only', 'val');
    expect(created).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  describe('Argument validation', () => {
    it('throws TypeError when acceptDrop receives invalid type', () => {
      const board = createBoard();
      expect(() => board.acceptDrop('', () => {})).toThrow(TypeError);
      expect(() => board.acceptDrop('   ', () => {})).toThrow(TypeError);
      expect(() => board.acceptDrop(null as unknown as string, () => {})).toThrow(TypeError);
      expect(() => board.acceptDrop(123 as unknown as string, () => {})).toThrow(TypeError);
    });

    it('throws TypeError when acceptDrop receives invalid handler', () => {
      const board = createBoard();
      expect(() => board.acceptDrop('test/type', null as unknown as () => void)).toThrow(TypeError);
      expect(() => board.acceptDrop('test/type', 'invalid' as unknown as () => void)).toThrow(TypeError);
    });

    it('throws TypeError when dropAt receives invalid point', async () => {
      const board = createBoard();
      board.acceptDrop('test/type', () => {});

      await expect(board.dropAt(null as unknown as Point, 'test/type', {})).rejects.toThrow(TypeError);
      await expect(board.dropAt({ x: NaN, y: 0 }, 'test/type', {})).rejects.toThrow(TypeError);
      await expect(board.dropAt({ x: 0, y: Infinity }, 'test/type', {})).rejects.toThrow(TypeError);
    });

    it('throws TypeError when dropAt receives invalid type', async () => {
      const board = createBoard();
      await expect(board.dropAt({ x: 0, y: 0 }, '', {})).rejects.toThrow(TypeError);
      await expect(board.dropAt({ x: 0, y: 0 }, null as unknown as string, {})).rejects.toThrow(TypeError);
    });

    it('throws Error when board is disposed', async () => {
      const board = createBoard();
      board.dispose();

      expect(() => board.acceptDrop('test/type', () => {})).toThrow(/dispose/i);
      await expect(board.dropAt({ x: 0, y: 0 }, 'test/type', {})).rejects.toThrow(/dispose/i);
      expect(board.hasDropHandler('test/type')).toBe(false);
      expect(board.getDropTypes()).toEqual([]);
    });
  });

  describe('Error handling', () => {
    it('emits drop-error and rejects dropAt when synchronous handler throws', async () => {
      const board = createBoard();
      const errors: BoardErrorEvent[] = [];
      board.on('error', (e) => errors.push(e));

      const failure = new Error('Sync drop failure');
      board.acceptDrop('fail/sync', () => {
        throw failure;
      });

      await expect(board.dropAt({ x: 0, y: 0 }, 'fail/sync', null)).rejects.toThrow('Sync drop failure');

      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('drop-error');
      expect(errors[0]!.cause).toBe(failure);
    });

    it('emits drop-error and rejects dropAt when asynchronous handler rejects', async () => {
      const board = createBoard();
      const errors: BoardErrorEvent[] = [];
      board.on('error', (e) => errors.push(e));

      const failure = new Error('Async drop failure');
      board.acceptDrop('fail/async', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw failure;
      });

      await expect(board.dropAt({ x: 0, y: 0 }, 'fail/async', null)).rejects.toThrow('Async drop failure');

      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('drop-error');
      expect(errors[0]!.cause).toBe(failure);
    });
  });

  describe('Drag preview event', () => {
    it('emits and listens to drag-preview event', () => {
      const board = createBoard();
      const previews: (Point | null)[] = [];

      board.on('drag-preview', (event) => {
        previews.push(event.point);
      });

      board.emit('drag-preview', { point: { x: 50, y: 75 }, type: 'custom/card' });
      board.emit('drag-preview', { point: null });

      expect(previews).toEqual([{ x: 50, y: 75 }, null]);
    });
  });
});
