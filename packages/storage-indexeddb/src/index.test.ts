import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { attachStorage, createBoard, createEmptyDocument, type BoardDocument } from '@kujam/core';
import { createIndexedDbStorage } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(factory: IDBFactory = new IDBFactory()) {
  const onFallback = vi.fn();
  const storage = createIndexedDbStorage({ indexedDB: factory, databaseName: 'test', onFallback });
  return { storage, factory, onFallback };
}

/** Factory whose databases open but reject every write, like some private browsing modes. */
function readOnlyFactory(): IDBFactory {
  const real = new IDBFactory();
  return {
    open(name: string, version?: number) {
      const request = real.open(name, version);
      const proxy = {
        get result() {
          return request.result;
        },
        get error() {
          return request.error;
        },
        onupgradeneeded: null as ((event: Event) => void) | null,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
      };
      request.onupgradeneeded = (event) => proxy.onupgradeneeded?.(event);
      request.onerror = (event) => proxy.onerror?.(event);
      request.onsuccess = (event) => {
        request.result.transaction = (() => {
          throw new DOMException('Quota terlampaui', 'QuotaExceededError');
        }) as IDBDatabase['transaction'];
        proxy.onsuccess?.(event);
      };
      return proxy;
    },
  } as unknown as IDBFactory;
}

describe('BOARD-1603: IndexedDB storage', () => {
  it('stores a JSON document per boardId and loads an independent copy', async () => {
    const { storage, onFallback } = setup();
    const a = createEmptyDocument({ name: 'A', ratio: Number.NaN, missing: undefined });
    const b = createEmptyDocument({ name: 'B' });
    await storage.save('a', { document: a });
    await storage.save('b', { document: b });
    a.meta.name = 'changed';

    expect(await storage.load('a')).toEqual(
      createEmptyDocument({ name: 'A', ratio: Number.NaN, missing: undefined }),
    );
    expect(await storage.load('b')).toEqual(b);
    expect(await storage.load('nope')).toBeNull();
    expect(await storage.mode()).toBe('indexeddb');
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('persists across adapter instances on the same database', async () => {
    const factory = new IDBFactory();
    const first = setup(factory).storage;
    await first.save('b1', { document: createEmptyDocument({ v: 1 }) });
    first.close();

    const second = setup(factory).storage;
    expect(((await second.load('b1')) as BoardDocument).meta).toEqual({ v: 1 });
  });

  it('stores binary updates, and prefers the document when both are given', async () => {
    const { storage } = setup();
    await storage.save('bin', { update: new Uint8Array([1, 2, 3]) });
    expect(Array.from((await storage.load('bin')) as Uint8Array)).toEqual([1, 2, 3]);

    const doc = createEmptyDocument();
    await storage.save('both', { document: doc, update: new Uint8Array([9]) });
    expect(await storage.load('both')).toEqual(doc);
    await storage.save('empty', {});
    expect(await storage.load('empty')).toBeNull();
  });

  it('lists stored boards for demos, most recently saved first', async () => {
    const { storage } = setup();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    await storage.save('old', { document: createEmptyDocument() });
    now.mockReturnValue(3000);
    await storage.save('new', { update: new Uint8Array([1]) });
    now.mockReturnValue(2000);
    await storage.save('mid-b', { document: createEmptyDocument() });
    await storage.save('mid-a', { document: createEmptyDocument() });

    expect(await storage.list()).toEqual([
      { boardId: 'new', updatedAt: 3000, kind: 'update' },
      { boardId: 'mid-a', updatedAt: 2000, kind: 'document' },
      { boardId: 'mid-b', updatedAt: 2000, kind: 'document' },
      { boardId: 'old', updatedAt: 1000, kind: 'document' },
    ]);

    now.mockReturnValue(4000);
    await storage.save('old', { document: createEmptyDocument() });
    expect((await storage.list())[0]).toEqual({
      boardId: 'old',
      updatedAt: 4000,
      kind: 'document',
    });
  });

  it('removes a board from storage and from the list', async () => {
    const { storage } = setup();
    await storage.save('a', { document: createEmptyDocument() });
    expect(await storage.remove('a')).toBe(true);
    expect(await storage.remove('a')).toBe(false);
    expect(await storage.load('a')).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('rejects an empty boardId', async () => {
    const { storage } = setup();
    await expect(storage.load('')).rejects.toThrow(TypeError);
    await expect(storage.save('', { document: createEmptyDocument() })).rejects.toThrow(TypeError);
    await expect(storage.remove('')).rejects.toThrow(TypeError);
  });

  it('reopens the database after close and after another tab upgrades it', async () => {
    const factory = new IDBFactory();
    const { storage, onFallback } = setup(factory);
    await storage.save('a', { document: createEmptyDocument({ n: 1 }) });
    storage.close();
    expect(((await storage.load('a')) as BoardDocument).meta).toEqual({ n: 1 });

    // A newer version elsewhere fires `versionchange`; the adapter closes so the upgrade can run.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('test', 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    // Opening at the old version now fails with `VersionError`: reject instead of falling back,
    // so the newer data never looks missing.
    await expect(storage.load('a')).rejects.toMatchObject({ name: 'VersionError' });
    expect(onFallback).not.toHaveBeenCalled();
    expect(await storage.mode().catch(() => 'rejected')).toBe('rejected');
  });
});

describe('BOARD-1603: memory fallback (Safari private browsing)', () => {
  it('falls back with a warning when there is no indexedDB global', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createIndexedDbStorage();
    await storage.save('a', { document: createEmptyDocument({ x: 1 }) });

    expect(await storage.mode()).toBe('memory');
    expect(((await storage.load('a')) as BoardDocument).meta).toEqual({ x: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('IndexedDB tidak tersedia');
  });

  it('falls back when indexedDB.open throws', async () => {
    const factory = {
      open() {
        throw new DOMException('A mutation operation was attempted', 'InvalidStateError');
      },
    } as unknown as IDBFactory;
    const { storage, onFallback } = setup(factory as never);
    await storage.save('a', { document: createEmptyDocument() });

    expect(await storage.mode()).toBe('memory');
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect((onFallback.mock.calls[0]![0] as DOMException).name).toBe('InvalidStateError');
  });

  it('falls back when the open request fails', async () => {
    const factory = {
      open() {
        const request = {} as { error?: DOMException; onerror?: () => void };
        queueMicrotask(() => {
          request.error = new DOMException('denied', 'UnknownError');
          request.onerror?.();
        });
        return request;
      },
    } as unknown as IDBFactory;
    const { storage, onFallback } = setup(factory as never);
    expect(await storage.mode()).toBe('memory');
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('falls back when the database opens but rejects writes', async () => {
    const { storage, onFallback } = setup(readOnlyFactory());
    await storage.save('a', { document: createEmptyDocument({ ok: true }) });

    expect(await storage.mode()).toBe('memory');
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(((await storage.load('a')) as BoardDocument).meta).toEqual({ ok: true });
  });

  it('keeps fallback copies independent and lists them', async () => {
    const { storage } = setup(null as never);
    const doc = createEmptyDocument({ n: 1 });
    await storage.save('a', { document: doc });
    doc.meta.n = 2;

    const loaded = (await storage.load('a')) as BoardDocument;
    expect(loaded.meta.n).toBe(1);
    loaded.meta.n = 3;
    expect(((await storage.load('a')) as BoardDocument).meta.n).toBe(1);
    expect((await storage.list()).map((i) => i.boardId)).toEqual(['a']);
    expect(await storage.remove('a')).toBe(true);
  });

  it('warns only once', async () => {
    const { storage, onFallback } = setup(null as never);
    await storage.load('a');
    await storage.save('a', { document: createEmptyDocument() });
    await storage.list();
    storage.close();
    await storage.load('a');
    expect(onFallback).toHaveBeenCalledTimes(1);
  });
});

describe('BOARD-1603: integration with attachStorage', () => {
  it('autosaves a board and restores it in a new board', async () => {
    const factory = new IDBFactory();
    const { storage } = setup(factory);
    const board = createBoard();
    const attachment = attachStorage(board, storage, {
      boardId: 'retro',
      debounceMs: 0,
      lifecycle: null,
    });
    await attachment.ready;

    board.transact((tx) => {
      tx.put({ id: 'page:two', kind: 'page', name: 'Dua', index: 'a1', meta: {} });
    });
    expect(await attachment.flush()).toBe(true);
    await attachment.detach();
    const saved = board.getDocument();
    board.dispose();

    expect((await storage.list()).map((i) => i.boardId)).toEqual(['retro']);

    const restored = createBoard();
    const second = attachStorage(restored, setup(factory).storage, {
      boardId: 'retro',
      lifecycle: null,
    });
    await second.ready;
    expect(restored.getDocument()).toEqual(saved);
    await second.detach();
    restored.dispose();
  });
});
