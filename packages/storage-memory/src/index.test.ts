import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachStorage, createBoard, createEmptyDocument, type BoardDocument } from '@kujam/core';
import { createMemoryStorage } from './index.js';

describe('createMemoryStorage', () => {
  it('menyimpan salinan dokumen tanpa mengubah nilai NaN atau undefined', async () => {
    const storage = createMemoryStorage();
    const doc = createEmptyDocument({ ratio: Number.NaN, note: undefined });
    await storage.save('b1', { document: doc });

    doc.meta.extra = true;
    const loaded = await storage.load('b1');
    expect(loaded).toEqual(createEmptyDocument({ ratio: Number.NaN, note: undefined }));
    expect(loaded).not.toBe(doc);
  });

  it('menyimpan update biner dan mengembalikan null untuk papan yang belum ada', async () => {
    const storage = createMemoryStorage();
    await storage.save('b1', { update: new Uint8Array([1, 2]) });
    expect(Array.from((await storage.load('b1')) as Uint8Array)).toEqual([1, 2]);
    await expect(storage.load('nope')).resolves.toBeNull();
  });
});

describe('BOARD-1602: inspectable memory storage', () => {
  it('records every save as a deep copy in `saved`', async () => {
    const storage = createMemoryStorage();
    const doc = createEmptyDocument({ v: 1 });
    await storage.save('b1', { document: doc });
    doc.meta.v = 2;
    await storage.save('b2', { update: new Uint8Array([7]) });

    expect(storage.saved).toHaveLength(2);
    expect(storage.saved[0]).toEqual({
      boardId: 'b1',
      change: { document: createEmptyDocument({ v: 1 }) },
    });
    expect(storage.saved[1]!.boardId).toBe('b2');
    expect(Array.from(storage.saved[1]!.change.update!)).toEqual([7]);
    expect(Object.isFrozen(storage.saved[0])).toBe(true);
  });

  it('prefers the document when a change carries both a document and an update', async () => {
    const storage = createMemoryStorage();
    const doc = createEmptyDocument();
    await storage.save('b1', { document: doc, update: new Uint8Array([1]) });
    expect(storage.peek('b1')).toEqual(doc);
  });

  it('peek and boards inspect what is stored without exposing internal state', async () => {
    const storage = createMemoryStorage({ initial: { seeded: createEmptyDocument({ s: true }) } });
    await storage.save('b1', { document: createEmptyDocument() });

    expect(storage.boards()).toEqual(['seeded', 'b1']);
    const peeked = storage.peek('seeded') as BoardDocument;
    peeked.meta.s = false;
    expect((storage.peek('seeded') as BoardDocument).meta.s).toBe(true);
    expect(storage.peek('missing')).toBeNull();
  });

  it('copies `initial` so the caller can keep mutating it', async () => {
    const seed = createEmptyDocument({ n: 1 });
    const storage = createMemoryStorage({ initial: { b: seed } });
    seed.meta.n = 2;
    expect(((await storage.load('b')) as BoardDocument).meta.n).toBe(1);
  });

  it('failNextSaves rejects saves without storing or recording them', async () => {
    const storage = createMemoryStorage();
    const boom = new Error('offline');
    storage.failNextSaves(2, boom);

    await expect(storage.save('b1', { document: createEmptyDocument() })).rejects.toBe(boom);
    await expect(storage.save('b1', { document: createEmptyDocument() })).rejects.toBe(boom);
    expect(storage.saved).toHaveLength(0);
    expect(storage.peek('b1')).toBeNull();

    await storage.save('b1', { document: createEmptyDocument() });
    expect(storage.saved).toHaveLength(1);
    expect(() => storage.failNextSaves(-1)).toThrow(TypeError);
  });

  it('clear empties boards, the save log, and pending failures', async () => {
    const storage = createMemoryStorage();
    await storage.save('b1', { document: createEmptyDocument() });
    storage.failNextSaves(1);
    storage.clear();

    expect(storage.boards()).toEqual([]);
    expect(storage.saved).toEqual([]);
    await expect(storage.save('b1', { document: createEmptyDocument() })).resolves.toBeUndefined();
  });

  it('advertises debounceMs only when given', () => {
    expect(createMemoryStorage().debounceMs).toBeUndefined();
    expect(createMemoryStorage({ debounceMs: 50 }).debounceMs).toBe(50);
  });
});

describe('BOARD-1602: integration with attachStorage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the stored board, then records autosaves of local changes', async () => {
    vi.useFakeTimers();
    const stored = createEmptyDocument({ title: 'tersimpan' });
    const storage = createMemoryStorage({ initial: { b1: stored }, debounceMs: 100 });
    const board = createBoard();
    const attachment = attachStorage(board, storage, { boardId: 'b1', lifecycle: null });

    await attachment.ready;
    expect(board.getDocument().meta).toEqual({ title: 'tersimpan' });
    expect(storage.saved).toHaveLength(0);

    board.transact((tx) => {
      tx.put({
        id: 'page:two',
        kind: 'page',
        name: 'Dua',
        index: 'a1',
        meta: {},
      });
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0]!.change.document).toEqual(board.getDocument());
    expect(storage.peek('b1')).toEqual(board.getDocument());

    await attachment.detach();
    board.dispose();
  });

  it('retries a failed save and stores the result once it succeeds', async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorage({ debounceMs: 0 });
    storage.failNextSaves(1);
    const board = createBoard();
    const attachment = attachStorage(board, storage, {
      boardId: 'b1',
      lifecycle: null,
      retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 10 },
    });
    await attachment.ready;
    const errors: boolean[] = [];
    attachment.on('save:error', (e) => errors.push(e.willRetry));

    board.transact((tx) => {
      tx.put({ id: 'page:x', kind: 'page', name: 'X', index: 'a1', meta: {} });
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).toEqual([true]);
    expect(storage.saved).toHaveLength(1);
    expect(storage.peek('b1')).toEqual(board.getDocument());

    await attachment.detach();
    board.dispose();
  });
});
