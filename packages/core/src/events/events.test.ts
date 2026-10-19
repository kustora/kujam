import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  type BoardErrorEvent,
  type CameraEvent,
  type ElementRecord,
} from '../index.js';

function makeElement(overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id: 'el:1',
    kind: 'element',
    type: 'sticky',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 0,
    y: 0,
    rotation: 0,
    w: 100,
    h: 100,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('event error (BOARD-207)', () => {
  it('listener yang melempar diteruskan ke event error dengan kode stabil dan cause', () => {
    const board = createBoard();
    const boom = new Error('rusak');
    const errors: BoardErrorEvent[] = [];
    const after = vi.fn();
    board.on('error', (e) => errors.push(e));
    board.on('camera', () => {
      throw boom;
    });
    board.on('camera', after);

    expect(() => board.setCamera({ x: 5 })).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'listener-error', cause: boom, eventType: 'camera' });
    expect(errors[0]!.message).toContain('camera');
    expect(Object.isFrozen(errors[0])).toBe(true);
  });

  it('listener error yang melempar tidak memicu rekursi: dilaporkan ke console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const board = createBoard();
    const errorListener = vi.fn(() => {
      throw new Error('listener error ikut rusak');
    });
    const secondErrorListener = vi.fn();
    board.on('error', errorListener);
    board.on('error', secondErrorListener);
    board.on('change', () => {
      throw new Error('listener change rusak');
    });

    expect(() => board.transact((tx) => tx.put(makeElement()))).not.toThrow();
    expect(errorListener).toHaveBeenCalledTimes(1);
    // The other error listener is still called.
    expect(secondErrorListener).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain('"error"');
    expect((spy.mock.calls[0]![1] as Error).message).toBe('listener error ikut rusak');
  });

  it('tanpa listener error, error listener dilaporkan ke console.error (tidak ditelan)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const board = createBoard();
    const boom = new Error('rusak');
    board.on('change', () => {
      throw boom;
    });
    board.transact((tx) => tx.put(makeElement()));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"change"'), boom);
    expect(board.getElement('el:1')).toBeDefined();
  });

  it('tetap aman bila console tidak tersedia', () => {
    const original = globalThis.console;
    const board = createBoard();
    board.on('change', () => {
      throw new Error('rusak');
    });
    try {
      // Simulate an environment without console (for example certain sandboxes).
      Object.defineProperty(globalThis, 'console', { value: undefined, configurable: true });
      expect(() => board.transact((tx) => tx.put(makeElement()))).not.toThrow();
      Object.defineProperty(globalThis, 'console', {
        value: {
          error: () => {
            throw new Error('console rusak');
          },
        },
        configurable: true,
      });
      expect(() => board.transact((tx) => tx.put(makeElement({ x: 1 })))).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'console', { value: original, configurable: true });
    }
  });
});

describe('event camera (BOARD-207)', () => {
  it('dipancarkan hanya bila kamera benar-benar berubah, membawa kamera lama dan baru', () => {
    const board = createBoard();
    const events: CameraEvent[] = [];
    board.on('camera', (e) => events.push(e));

    board.setCamera({ x: 10, zoom: 2 });
    expect(events).toHaveLength(1);
    expect(events[0]!.previous).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(events[0]!.camera).toEqual({ x: 10, y: 0, zoom: 2 });
    expect(events[0]!.camera).toBe(board.getCamera());

    board.setCamera({});
    board.setCamera({ x: 10 });
    board.setCamera({ x: Number.NaN });
    board.setCamera({ zoom: 100 }); // clamped to 4
    board.setCamera({ zoom: 50 }); // still 4: unchanged
    expect(events).toHaveLength(2);
    expect(events[1]!.camera.zoom).toBe(4);
  });

  it('tetap dipancarkan pada papan readOnly', () => {
    const board = createBoard({ readOnly: true });
    const fn = vi.fn();
    board.on('camera', fn);
    board.setCamera({ y: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tidak dipancarkan setelah dispose', () => {
    const board = createBoard();
    const fn = vi.fn();
    board.on('camera', fn);
    board.dispose();
    board.setCamera({ x: 1 });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('tanpa state global (BOARD-207)', () => {
  it('dua board tidak saling menerima event apa pun', () => {
    const a = createBoard();
    const b = createBoard();
    const seenA: string[] = [];
    const seenB: string[] = [];
    for (const type of ['change', 'camera', 'error', 'history'] as const) {
      a.on(type, () => seenA.push(type));
      b.on(type, () => seenB.push(type));
    }
    a.on('change', () => {
      throw new Error('hanya di a');
    });

    a.transact((tx) => tx.put(makeElement()));
    a.setCamera({ x: 1 });
    a.undo();

    expect(seenA).toEqual(['change', 'error', 'history', 'camera', 'change', 'error', 'history']);
    expect(seenB).toEqual([]);

    b.setCamera({ y: 2 });
    expect(seenB).toEqual(['camera']);
    expect(a.getCamera()).toEqual({ x: 1, y: 0, zoom: 1 });
    expect(b.getElement('el:1')).toBeUndefined();
  });

  it('on mengembalikan unsubscribe untuk setiap jenis event', () => {
    const board = createBoard();
    const fn = vi.fn();
    const off = board.on('camera', fn);
    off();
    off();
    board.setCamera({ x: 1 });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('board.reportError (BOARD-207, BOARD-810)', () => {
  it('memancarkan event error dengan kode, pesan, dan cause', () => {
    const board = createBoard();
    const errors: { code: string; message: string; cause: unknown }[] = [];
    board.on('error', (e) => errors.push(e));

    board.reportError('render-error', 'Gagal render elemen test', { id: 'el-1' });

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('render-error');
    expect(errors[0].message).toBe('Gagal render elemen test');
    expect(errors[0].cause).toEqual({ id: 'el-1' });
  });
});
