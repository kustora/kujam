import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachStorage,
  createBoard,
  createEmptyDocument,
  defineElement,
  definePlugin,
  isRetryableStorageError,
  object,
  string,
  type Board,
  type BoardDocument,
  type PageLifecycleTarget,
  type SaveErrorEvent,
  type StorageAdapter,
  type StorageChange,
} from '../index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});
const notes = definePlugin({ id: 'notes', elements: [noteElement] });

interface FakeAdapter extends StorageAdapter {
  saves: StorageChange[];
  /** Number of upcoming saves that should fail. */
  failNext: number;
}

function fakeAdapter(loaded: BoardDocument | Uint8Array | null = null): FakeAdapter {
  const adapter: FakeAdapter = {
    saves: [],
    failNext: 0,
    load: vi.fn(async () => loaded),
    save: vi.fn(async (_id: string, change: StorageChange) => {
      if (adapter.failNext > 0) {
        adapter.failNext--;
        throw new Error('offline');
      }
      adapter.saves.push(change);
    }),
  };
  return adapter;
}

function fakeLifecycle(): PageLifecycleTarget & { fire(): void; count(): number } {
  const listeners = new Set<() => void>();
  return {
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
    fire: () => listeners.forEach((fn) => fn()),
    count: () => listeners.size,
  };
}

function boardWith(): Board {
  return createBoard({ plugins: [notes] });
}

async function attached(
  adapter: FakeAdapter,
  options: Partial<Parameters<typeof attachStorage>[2]> = {},
) {
  const board = boardWith();
  const storage = attachStorage(board, adapter, { boardId: 'b1', lifecycle: null, ...options });
  await storage.ready;
  return { board, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('BOARD-1601: attachStorage', () => {
  it('loads the stored document into the board', async () => {
    const source = boardWith();
    source.create({ id: 'n1', type: 'note' });
    const adapter = fakeAdapter(source.getDocument());
    const { board, storage } = await attached(adapter);

    expect(adapter.load).toHaveBeenCalledWith('b1');
    expect(board.getElement('n1')).toBeDefined();
    expect(storage.status).toBe('idle');
    expect(storage.dirty).toBe(false);
    // Loading itself is never saved back.
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.save).not.toHaveBeenCalled();
  });

  it('keeps the current document when nothing is stored', async () => {
    const adapter = fakeAdapter(null);
    const { board, storage } = await attached(adapter);
    expect(Object.keys(board.getDocument().records)).toEqual(
      Object.keys(createEmptyDocument().records),
    );
    expect(storage.status).toBe('idle');
  });

  it('does not autosave when loading fails', async () => {
    const adapter = fakeAdapter();
    adapter.load = vi.fn(async () => {
      throw new Error('network');
    });
    const board = boardWith();
    const storage = attachStorage(board, adapter, { boardId: 'b1', lifecycle: null });
    await expect(storage.ready).rejects.toThrow('network');
    expect(storage.status).toBe('error');

    board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.save).not.toHaveBeenCalled();
  });

  it('rejects binary updates from load', async () => {
    const adapter = fakeAdapter(new Uint8Array([1, 2, 3]));
    const storage = attachStorage(boardWith(), adapter, { boardId: 'b1', lifecycle: null });
    await expect(storage.ready).rejects.toThrow(TypeError);
    expect(storage.status).toBe('error');
  });

  it('saves once after the default 1000 ms debounce from the last change', async () => {
    const adapter = fakeAdapter();
    const { board, storage } = await attached(adapter);

    board.create({ id: 'a', type: 'note' });
    expect(storage.status).toBe('pending');
    expect(storage.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    board.update('a', { x: 10 });
    await vi.advanceTimersByTimeAsync(999);
    expect(adapter.save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.save).toHaveBeenCalledTimes(1);
    expect(adapter.save).toHaveBeenCalledWith('b1', { document: board.getDocument() });
    expect(storage.status).toBe('idle');
    expect(storage.dirty).toBe(false);
  });

  it('uses adapter.debounceMs, overridden by the debounceMs option', async () => {
    const adapter = fakeAdapter();
    adapter.debounceMs = 200;
    const first = await attached(adapter);
    first.board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(200);
    expect(adapter.save).toHaveBeenCalledTimes(1);

    const second = await attached(adapter, { debounceMs: 50 });
    second.board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(50);
    expect(adapter.save).toHaveBeenCalledTimes(2);
  });

  it('saves local, undo, redo, and migration changes but not remote or load', async () => {
    const adapter = fakeAdapter();
    const { board } = await attached(adapter);
    const tick = () => vi.advanceTimersByTimeAsync(1000);

    board.transact((tx) => tx.remove('missing'), { origin: 'remote' });
    board.create({ id: 'r', type: 'note' }, { origin: 'remote' });
    await tick();
    board.loadDocument(createEmptyDocument());
    await tick();
    expect(adapter.save).toHaveBeenCalledTimes(0);

    board.create({ id: 'l', type: 'note' });
    await tick();
    expect(adapter.save).toHaveBeenCalledTimes(1);
    board.undo();
    await tick();
    expect(adapter.save).toHaveBeenCalledTimes(2);
    board.redo();
    await tick();
    expect(adapter.save).toHaveBeenCalledTimes(3);
    board.update('l', { x: 1 }, { origin: 'migration' });
    await tick();
    expect(adapter.save).toHaveBeenCalledTimes(4);
  });

  it('emits save:start and save:success', async () => {
    const adapter = fakeAdapter();
    const { board, storage } = await attached(adapter);
    const log: string[] = [];
    storage.on('save:start', (e) => log.push(`start:${e.boardId}:${e.attempt}`));
    storage.on('save:success', (e) => {
      log.push('success');
      expect(e.document).toBe(board.getDocument());
    });

    board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(log).toEqual(['start:b1:1', 'success']);
  });

  it('retries failed saves with exponential backoff', async () => {
    const adapter = fakeAdapter();
    adapter.failNext = 2;
    const { board, storage } = await attached(adapter);
    const errors: SaveErrorEvent[] = [];
    storage.on('save:error', (e) => errors.push(e));

    board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.save).toHaveBeenCalledTimes(1);
    expect(storage.status).toBe('pending');
    expect(storage.dirty).toBe(true);

    // Retry 1 after 1000 ms, retry 2 after 2000 ms.
    await vi.advanceTimersByTimeAsync(999);
    expect(adapter.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(adapter.save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.save).toHaveBeenCalledTimes(3);

    expect(errors.map((e) => [e.attempt, e.willRetry])).toEqual([
      [1, true],
      [2, true],
    ]);
    expect(errors[0]!.error).toEqual(new Error('offline'));
    expect(storage.status).toBe('idle');
    expect(storage.dirty).toBe(false);
  });

  it('keeps the backoff when changes arrive while a retry is waiting', async () => {
    const adapter = fakeAdapter();
    adapter.failNext = 1;
    const { board } = await attached(adapter, { retry: { baseDelayMs: 5000 } });

    board.create({ id: 'a', type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    board.update('a', { x: 5 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(adapter.save).toHaveBeenCalledTimes(2);
    expect(adapter.saves.at(-1)!.document).toBe(board.getDocument());
  });

  it('caps the retry delay with maxDelayMs', async () => {
    const adapter = fakeAdapter();
    adapter.failNext = 3;
    const { board } = await attached(adapter, { retry: { baseDelayMs: 1000, maxDelayMs: 1500 } });
    board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(1000); // attempt 1
    await vi.advanceTimersByTimeAsync(1000); // attempt 2 after 1000
    await vi.advanceTimersByTimeAsync(1500); // attempt 3 after min(2000, 1500)
    expect(adapter.save).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxAttempts and saves again on the next change', async () => {
    const adapter = fakeAdapter();
    adapter.failNext = 2;
    const { board, storage } = await attached(adapter, { retry: { maxAttempts: 2 } });
    const errors: SaveErrorEvent[] = [];
    storage.on('save:error', (e) => errors.push(e));

    board.create({ id: 'a', type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.save).toHaveBeenCalledTimes(2);
    expect(errors.map((e) => e.willRetry)).toEqual([true, false]);
    expect(storage.status).toBe('error');
    expect(storage.dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.save).toHaveBeenCalledTimes(2);

    board.update('a', { x: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.save).toHaveBeenCalledTimes(3);
    expect(storage.status).toBe('idle');
  });

  it('does not retry errors marked retryable: false', async () => {
    const adapter = fakeAdapter();
    const denied = Object.assign(new Error('forbidden'), { retryable: false });
    adapter.save = vi.fn(async () => {
      throw denied;
    });
    const { board, storage } = await attached(adapter);
    const errors: SaveErrorEvent[] = [];
    storage.on('save:error', (e) => errors.push(e));

    board.create({ id: 'a', type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.save).toHaveBeenCalledTimes(1);
    expect(errors.map((e) => [e.attempt, e.willRetry, e.error])).toEqual([[1, false, denied]]);
    expect(storage.status).toBe('error');
    expect(storage.dirty).toBe(true);

    // The next change schedules a fresh save.
    board.update('a', { x: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.save).toHaveBeenCalledTimes(2);
  });

  it('isRetryableStorageError only opts out on retryable === false', () => {
    expect(isRetryableStorageError(new Error('offline'))).toBe(true);
    expect(isRetryableStorageError({ retryable: true })).toBe(true);
    expect(isRetryableStorageError({ retryable: 0 })).toBe(true);
    expect(isRetryableStorageError(null)).toBe(true);
    expect(isRetryableStorageError('boom')).toBe(true);
    expect(isRetryableStorageError({ retryable: false })).toBe(false);
  });

  it('handles an adapter that throws synchronously', async () => {
    const adapter = fakeAdapter();
    adapter.save = vi.fn(() => {
      throw new Error('sync');
    });
    const { board, storage } = await attached(adapter, { retry: { maxAttempts: 1 } });
    board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.status).toBe('error');
    expect(storage.dirty).toBe(true);
    expect(await storage.flush()).toBe(false);
  });

  it('saves changes made during a running save afterwards', async () => {
    const adapter = fakeAdapter();
    let release!: () => void;
    adapter.save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { board, storage } = await attached(adapter);

    board.create({ id: 'a', type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.status).toBe('saving');
    board.update('a', { x: 3 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.save).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.save).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.status).toBe('idle');
  });

  it('flush saves immediately', async () => {
    const adapter = fakeAdapter();
    const { board, storage } = await attached(adapter);
    expect(await storage.flush()).toBe(true);
    expect(adapter.save).not.toHaveBeenCalled();

    board.create({ type: 'note' });
    expect(await storage.flush()).toBe(true);
    expect(adapter.save).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('saves immediately on dispose and clears every timer', async () => {
    const adapter = fakeAdapter();
    const { board, storage } = await attached(adapter);
    board.create({ id: 'a', type: 'note' });
    const doc = board.getDocument();

    board.dispose();
    await vi.advanceTimersByTimeAsync(0);
    // The snapshot is taken synchronously during dispose, before the store is released.
    expect(adapter.save).toHaveBeenCalledWith('b1', { document: doc });
    expect(storage.status).toBe('detached');
    expect(storage.dirty).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose without changes does not save', async () => {
    const adapter = fakeAdapter();
    const { board, storage } = await attached(adapter);
    board.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.save).not.toHaveBeenCalled();
    expect(storage.status).toBe('detached');
  });

  it('gives a waiting retry one final attempt on dispose, without further retries', async () => {
    const adapter = fakeAdapter();
    adapter.failNext = 5;
    const { board, storage } = await attached(adapter);
    const errors: SaveErrorEvent[] = [];
    storage.on('save:error', (e) => errors.push(e));

    board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    board.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.save).toHaveBeenCalledTimes(2);
    expect(errors.at(-1)!.willRetry).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.save).toHaveBeenCalledTimes(2);
  });

  it('saves immediately on pagehide and stays attached', async () => {
    const adapter = fakeAdapter();
    const lifecycle = fakeLifecycle();
    const { board, storage } = await attached(adapter, { lifecycle });
    expect(lifecycle.count()).toBe(1);

    board.create({ type: 'note' });
    lifecycle.fire();
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.save).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.save).toHaveBeenCalledTimes(2);

    await storage.detach();
    expect(lifecycle.count()).toBe(0);
  });

  it('uses globalThis as the lifecycle target when it supports events', async () => {
    const target = globalThis as unknown as Partial<PageLifecycleTarget>;
    const original = { add: target.addEventListener, remove: target.removeEventListener };
    const lifecycle = fakeLifecycle();
    target.addEventListener = lifecycle.addEventListener;
    target.removeEventListener = lifecycle.removeEventListener;
    try {
      const storage = attachStorage(boardWith(), fakeAdapter(), { boardId: 'b1' });
      await storage.ready;
      expect(lifecycle.count()).toBe(1);
      await storage.detach();
      expect(lifecycle.count()).toBe(0);
    } finally {
      target.addEventListener = original.add;
      target.removeEventListener = original.remove;
    }
  });

  it('detach stops autosave and is idempotent', async () => {
    const adapter = fakeAdapter();
    const { board, storage } = await attached(adapter);
    board.create({ type: 'note' });
    const first = storage.detach();
    expect(storage.detach()).toBe(first);
    expect(await first).toBe(true);
    expect(adapter.save).toHaveBeenCalledTimes(1);

    board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.save).toHaveBeenCalledTimes(1);
    expect(storage.status).toBe('detached');
  });

  it('does not apply a load that finishes after detach', async () => {
    let resolveLoad!: (doc: BoardDocument) => void;
    const adapter = fakeAdapter();
    adapter.load = vi.fn(
      () =>
        new Promise<BoardDocument>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const board = boardWith();
    const storage = attachStorage(board, adapter, { boardId: 'b1', lifecycle: null });
    await storage.detach();

    const other = boardWith();
    other.create({ id: 'late', type: 'note' });
    resolveLoad(other.getDocument());
    await storage.ready;
    expect(board.getElement('late')).toBeUndefined();
    expect(storage.status).toBe('detached');
  });

  it('reports listener errors without breaking the save', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter = fakeAdapter();
    const { board, storage } = await attached(adapter);
    storage.on('save:start', () => {
      throw new Error('listener');
    });
    board.create({ type: 'note' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.saves).toHaveLength(1);
    expect(report).toHaveBeenCalled();
    report.mockRestore();
  });

  it('validates its arguments', () => {
    const board = boardWith();
    const adapter = fakeAdapter();
    expect(() => attachStorage(board, {} as never, { boardId: 'b1' })).toThrow(TypeError);
    expect(() => attachStorage(board, adapter, null as never)).toThrow(TypeError);
    expect(() => attachStorage(board, adapter, { boardId: '' })).toThrow(TypeError);
    expect(() => attachStorage(board, adapter, { boardId: 'b1', debounceMs: -1 })).toThrow(
      TypeError,
    );
    expect(() =>
      attachStorage(board, adapter, { boardId: 'b1', retry: { maxAttempts: 0 } }),
    ).toThrow(TypeError);
    board.dispose();
    expect(() => attachStorage(board, adapter, { boardId: 'b1' })).toThrow(
      'Papan sudah di-dispose.',
    );
  });
});

describe('BOARD-1601: dispose event', () => {
  it('is emitted once at the start of dispose while the document is readable', () => {
    vi.useRealTimers();
    const board = boardWith();
    board.create({ id: 'a', type: 'note' });
    const seen: boolean[] = [];
    board.on('dispose', () => seen.push(board.getElement('a') !== undefined));
    board.dispose();
    board.dispose();
    expect(seen).toEqual([true]);
  });
});

describe('BOARD-1210: onDocumentSaved plugin hook', () => {
  it('calls onDocumentSaved with the saved document snapshot upon save success', async () => {
    vi.useRealTimers();
    const savedSnapshots: BoardDocument[] = [];
    const saveTrackerPlugin = definePlugin({
      id: 'save-tracker',
      dependsOn: ['notes'],
      onDocumentSaved: (doc) => {
        savedSnapshots.push(doc as BoardDocument);
      },
    });

    const board = createBoard({ plugins: [notes, saveTrackerPlugin] });
    const adapter = fakeAdapter();
    const storage = attachStorage(board, adapter, { boardId: 'b1', debounceMs: 10 });
    await storage.ready;

    board.create({ id: 'note-1', type: 'note', props: { text: 'Halo' } });
    const saved = await storage.flush();
    expect(saved).toBe(true);
    expect(savedSnapshots).toHaveLength(1);
    expect(savedSnapshots[0].records['note-1']).toBeDefined();
    expect((savedSnapshots[0].records['note-1'] as any).props.text).toBe('Halo');
  });

  it('isolates synchronous errors thrown by onDocumentSaved without canceling save', async () => {
    vi.useRealTimers();
    const errors: any[] = [];
    const faultyPlugin = definePlugin({
      id: 'faulty-plugin',
      dependsOn: ['notes'],
      onDocumentSaved: () => {
        throw new Error('Simulated synchronous hook crash');
      },
    });

    const board = createBoard({ plugins: [notes, faultyPlugin] });
    board.on('error', (e) => errors.push(e));

    const adapter = fakeAdapter();
    const storage = attachStorage(board, adapter, { boardId: 'b1', debounceMs: 10 });
    await storage.ready;

    board.create({ id: 'note-err', type: 'note', props: { text: 'Test' } });
    const saved = await storage.flush();

    expect(saved).toBe(true);
    expect(adapter.saves).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('plugin-error');
    expect(errors[0].message).toContain('Hook onDocumentSaved melempar error');
  });

  it('isolates asynchronous rejections returned by onDocumentSaved without canceling save', async () => {
    vi.useRealTimers();
    const errors: any[] = [];
    const asyncFaultyPlugin = definePlugin({
      id: 'async-faulty-plugin',
      dependsOn: ['notes'],
      onDocumentSaved: async () => {
        await Promise.resolve();
        throw new Error('Simulated async hook rejection');
      },
    });

    const board = createBoard({ plugins: [notes, asyncFaultyPlugin] });
    board.on('error', (e) => errors.push(e));

    const adapter = fakeAdapter();
    const storage = attachStorage(board, adapter, { boardId: 'b1', debounceMs: 10 });
    await storage.ready;

    board.create({ id: 'note-async-err', type: 'note', props: { text: 'Async' } });
    const saved = await storage.flush();

    expect(saved).toBe(true);
    expect(adapter.saves).toHaveLength(1);

    // Wait a tick for microtask promise rejection handling
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('plugin-error');
    expect(errors[0].message).toContain('Hook onDocumentSaved melempar error');
  });

  it('supports direct invocation via board.notifyDocumentSaved', () => {
    vi.useRealTimers();
    const savedSnapshots: BoardDocument[] = [];
    const saveTrackerPlugin = definePlugin({
      id: 'direct-save-tracker',
      dependsOn: ['notes'],
      onDocumentSaved: (doc) => {
        savedSnapshots.push(doc as BoardDocument);
      },
    });

    const board = createBoard({ plugins: [notes, saveTrackerPlugin] });
    const doc = board.getDocument();
    board.notifyDocumentSaved(doc);

    expect(savedSnapshots).toHaveLength(1);
    expect(savedSnapshots[0]).toBe(doc);
  });
});
