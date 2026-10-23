import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoard, type Board } from '@kujam/core';
import { contactCardPlugin } from '@kujam/example-contact-card';
import type { CanvasFactory } from '@kujam/server';
import { defaultElements } from '@kujam/shapes';
import { documentToUpdate } from '@kujam/sync-yjs';
import { createMemoryStore } from './memory-store.js';
import { createBoardWorker, diffPlacements, type BoardReport } from './worker.js';

/** BOARD-1805: worker reading Yjs state, validating, indexing references, and rendering. */

const plugins = [defaultElements, contactCardPlugin];

let boards: Board[] = [];
afterEach(() => {
  for (const b of boards) b.dispose();
  boards = [];
  vi.useRealTimers();
});

function boardWithCards(): Board {
  const board = createBoard({ plugins });
  boards.push(board);
  board.create({ id: 'f', type: 'frame', x: 0, y: 0, w: 600, h: 300, props: { name: 'Tim' } });
  board.create({
    id: 'card:a',
    type: 'contact-card',
    parentId: 'f',
    x: 20,
    y: 40,
    w: 200,
    h: 96,
    props: { contactId: 'c-a' },
  });
  board.create({
    id: 'card:b',
    type: 'contact-card',
    x: 700,
    y: 40,
    w: 200,
    h: 96,
    props: { contactId: 'c-b' },
  });
  return board;
}

/** Canvas stand-in whose context accepts every call and which encodes to a fixed byte string. */
const fakeCanvas: CanvasFactory = (width, height) => ({
  canvas: { width, height, toBuffer: () => Buffer.from('PNG') },
  ctx: new Proxy({}, { get: () => () => {}, set: () => true }),
});

describe('BOARD-1805: server worker example', () => {
  it('validates, indexes references with their frame, and saves a thumbnail', async () => {
    const store = createMemoryStore();
    store.states.set('b1', documentToUpdate(boardWithCards().getDocument()));
    const worker = createBoardWorker({ store, plugins, canvasFactory: fakeCanvas });

    const report = await worker.process('b1');
    expect(report).toMatchObject({ status: 'processed', thumbnail: 'saved', invalidRecords: [] });
    expect(store.placements.get('b1')).toEqual([
      {
        resolver: 'contact',
        id: 'c-a',
        elementId: 'card:a',
        pageId: expect.any(String),
        frameId: 'f',
      },
      { resolver: 'contact', id: 'c-b', elementId: 'card:b', pageId: expect.any(String) },
    ]);
    expect(Buffer.from(store.thumbnails.get('b1')!).toString()).toBe('PNG');
  });

  it('updates placements by diff on the next run', async () => {
    const store = createMemoryStore();
    const board = boardWithCards();
    store.states.set('b1', documentToUpdate(board.getDocument()));
    const savePlacements = vi.spyOn(store, 'savePlacements');
    const worker = createBoardWorker({ store, plugins, canvasFactory: fakeCanvas });
    await worker.process('b1');

    // Unchanged state: nothing to write.
    await worker.process('b1');
    expect(savePlacements).toHaveBeenCalledTimes(1);

    board.update('card:a', { parentId: null, x: 1000 });
    board.delete(['card:b']);
    store.states.set('b1', documentToUpdate(board.getDocument()));
    const report = (await worker.process('b1')) as Extract<BoardReport, { status: 'processed' }>;
    expect(report.placements.added.map((r) => [r.id, r.frameId])).toEqual([['c-a', undefined]]);
    expect(report.placements.removed.map((r) => [r.id, r.frameId])).toEqual([
      ['c-a', 'f'],
      ['c-b', undefined],
    ]);
    expect(store.placements.get('b1')!.map((r) => r.elementId)).toEqual(['card:a']);
  });

  it('rejects corrupted and invalid states before indexing', async () => {
    const store = createMemoryStore();
    store.states.set('broken', new Uint8Array([1, 2, 3]));
    const worker = createBoardWorker({ store, plugins, canvasFactory: fakeCanvas, strict: true });
    expect(await worker.process('broken')).toMatchObject({ status: 'invalid' });

    const board = boardWithCards();
    const doc = board.getDocument();
    const bad = structuredClone(doc);
    (bad.records['card:a'] as { props: unknown }).props = { contactId: 42 };
    store.states.set('bad', documentToUpdate(bad));
    expect(await worker.process('bad')).toMatchObject({ status: 'invalid' });
    expect(store.placements.size).toBe(0);
    expect(await worker.process('gone')).toEqual({ boardId: 'gone', status: 'missing' });
  });

  it('keeps going without a canvas and reports the skipped thumbnail', async () => {
    const store = createMemoryStore();
    store.states.set('b1', documentToUpdate(boardWithCards().getDocument()));
    const failing: CanvasFactory = () => {
      throw new Error('Package "@napi-rs/canvas" tidak terpasang.');
    };
    const report = await createBoardWorker({ store, plugins, canvasFactory: failing }).process(
      'b1',
    );
    expect(report).toMatchObject({ status: 'processed', thumbnail: 'skipped' });
    expect(store.placements.get('b1')).toHaveLength(2);
  });

  it('debounces saves: three quick enqueues process the board once', async () => {
    vi.useFakeTimers();
    const store = createMemoryStore();
    store.states.set('b1', documentToUpdate(boardWithCards().getDocument()));
    const reports: BoardReport[] = [];
    const worker = createBoardWorker({
      store,
      plugins,
      canvasFactory: fakeCanvas,
      debounceMs: 500,
      onReport: (r) => reports.push(r),
    });
    worker.enqueue('b1');
    await vi.advanceTimersByTimeAsync(300);
    worker.enqueue('b1');
    await vi.advanceTimersByTimeAsync(300);
    worker.enqueue('b1');
    expect(reports).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(reports).toHaveLength(1);

    worker.enqueue('b1');
    worker.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reports).toHaveLength(1);
  });

  it('flush processes pending boards right away', async () => {
    const store = createMemoryStore();
    store.states.set('b1', documentToUpdate(boardWithCards().getDocument()));
    store.states.set('b2', documentToUpdate(boardWithCards().getDocument()));
    const worker = createBoardWorker({
      store,
      plugins,
      canvasFactory: fakeCanvas,
      debounceMs: 60_000,
    });
    worker.enqueue('b1');
    worker.enqueue('b2');
    const reports = await worker.flush();
    expect(reports.map((r) => r.boardId).sort()).toEqual(['b1', 'b2']);
  });

  it('diffPlacements compares every field that locates a placement', () => {
    const a = { resolver: 'contact', id: 'x', elementId: 'e1', pageId: 'p' };
    const moved = { ...a, frameId: 'f' };
    expect(diffPlacements([a], [a])).toEqual({ added: [], removed: [] });
    expect(diffPlacements([a], [moved])).toEqual({ added: [moved], removed: [a] });
  });
});
