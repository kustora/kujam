import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as Y from 'yjs';
import { attachSync, createBoard, type ElementRecord } from '@kujam/core';
import {
  createYjsSyncAdapter,
  isIndexedDbSupported,
  IndexeddbPersistence,
} from './index.js';

function makeElement(id: string, overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'sticky',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 10,
    y: 20,
    rotation: 0,
    w: 100,
    h: 100,
    locked: false,
    opacity: 1,
    props: { text: 'Hello', color: 'yellow' },
    meta: {},
    ...overrides,
  };
}

describe('BOARD-1508: IndexedDB persistence with y-indexeddb', () => {
  describe('Environment detection and options', () => {
    afterEach(() => {
      delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
      delete (globalThis as unknown as { IDBKeyRange?: unknown }).IDBKeyRange;
    });

    it('disables persistence by default in Node/SSR environment where indexedDB is undefined', async () => {
      delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
      delete (globalThis as unknown as { IDBKeyRange?: unknown }).IDBKeyRange;

      expect(isIndexedDbSupported()).toBe(false);

      const adapter = createYjsSyncAdapter();
      expect(adapter.persistence).toBeNull();

      // whenLoaded resolves immediately
      await adapter.whenLoaded;
      await adapter.whenLoaded();

      const board = createBoard();
      adapter.connect(board);
      expect(adapter.status).toBe('synced');
      adapter.disconnect();
    });

    it('enables persistence by default when indexedDB is available in the environment', async () => {
      globalThis.indexedDB = new IDBFactory();
      (globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = IDBKeyRange;

      expect(isIndexedDbSupported()).toBe(true);

      const adapter = createYjsSyncAdapter();
      expect(adapter.persistence).toBeInstanceOf(IndexeddbPersistence);
      expect(adapter.persistence?.name).toBe('kujam-yjs');

      await adapter.whenLoaded;
      adapter.disconnect();
    });

    it('respects indexeddb: false to explicitly disable persistence even when available', async () => {
      globalThis.indexedDB = new IDBFactory();
      (globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = IDBKeyRange;

      const adapter = createYjsSyncAdapter({ indexeddb: false });
      expect(adapter.persistence).toBeNull();

      await adapter.whenLoaded;
      const board = createBoard();
      adapter.connect(board);
      expect(adapter.status).toBe('synced');
      adapter.disconnect();
    });

    it('accepts custom database name via indexeddb option', async () => {
      globalThis.indexedDB = new IDBFactory();
      (globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = IDBKeyRange;

      const adapter = createYjsSyncAdapter({
        indexeddb: { name: 'custom-board-room' },
      });
      expect(adapter.persistence).toBeInstanceOf(IndexeddbPersistence);
      expect(adapter.persistence?.name).toBe('custom-board-room');

      await adapter.whenLoaded;
      adapter.disconnect();
    });
  });

  describe('Lifecycle, status indicators, and whenLoaded', () => {
    beforeEach(() => {
      globalThis.indexedDB = new IDBFactory();
      (globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = IDBKeyRange;
    });

    afterEach(() => {
      delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
      delete (globalThis as unknown as { IDBKeyRange?: unknown }).IDBKeyRange;
    });

    it('supports awaiting whenLoaded both as property and as method', async () => {
      const adapter = createYjsSyncAdapter({
        indexeddb: { name: 'when-loaded-test' },
      });

      // Await as property
      await adapter.whenLoaded;
      expect(adapter.persistence?.synced).toBe(true);

      // Await as method
      await adapter.whenLoaded();
      expect(adapter.persistence?.synced).toBe(true);

      adapter.disconnect();
    });

    it('transitions status through connecting -> synced -> offline', async () => {
      const adapter = createYjsSyncAdapter({
        indexeddb: { name: 'status-test' },
      });
      const board = createBoard();
      const statuses: string[] = [];
      adapter.on('status', (s) => statuses.push(s));

      expect(adapter.status).toBe('offline');

      const connectPromise = adapter.connect(board);
      expect(adapter.status).toBe('connecting');

      await connectPromise;
      expect(adapter.status).toBe('synced');

      adapter.disconnect();
      expect(adapter.status).toBe('offline');

      expect(statuses).toEqual(['connecting', 'synced', 'offline']);
    });

    it('transitions to synced immediately if whenLoaded was already awaited prior to connect', async () => {
      const adapter = createYjsSyncAdapter({
        indexeddb: { name: 'pre-loaded-test' },
      });
      const board = createBoard();

      // Wait until persistence has finished initial fetch
      await adapter.whenLoaded;

      const statuses: string[] = [];
      adapter.on('status', (s) => statuses.push(s));

      adapter.connect(board);
      expect(adapter.status).toBe('synced');
      expect(statuses).toEqual(['connecting', 'synced']);

      adapter.disconnect();
    });
  });

  describe('Offline persistence and document restoration', () => {
    beforeEach(() => {
      globalThis.indexedDB = new IDBFactory();
      (globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = IDBKeyRange;
    });

    afterEach(() => {
      delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
      delete (globalThis as unknown as { IDBKeyRange?: unknown }).IDBKeyRange;
    });

    it('persists offline modifications to IndexedDB and restores them in a fresh session', async () => {
      const dbName = 'offline-session-test';

      // --- Session 1: User creates board and adds elements while offline ---
      const board1 = createBoard();
      const adapter1 = createYjsSyncAdapter({ indexeddb: { name: dbName } });

      await adapter1.whenLoaded;
      adapter1.connect(board1);
      expect(adapter1.status).toBe('synced');

      // User creates sticky note offline
      board1.transact((tx) => {
        tx.put(
          makeElement('sticky-offline-1', {
            props: { text: 'Created offline', color: 'lime' },
          }),
        );
      });

      // Verify the element is stored in Y.Doc
      expect(adapter1.doc.getMap('records').has('sticky-offline-1')).toBe(true);

      // Verify pendingUpdates reflects stored state
      expect(adapter1.pendingUpdates).toBeGreaterThanOrEqual(1);

      // Clean disconnect (simulating closing the browser tab)
      adapter1.disconnect();
      expect(adapter1.status).toBe('offline');
      expect(adapter1.persistence).toBeNull();

      // --- Session 2: User re-opens the board in a fresh tab ---
      const board2 = createBoard();
      const adapter2 = createYjsSyncAdapter({ indexeddb: { name: dbName } });

      // Wait for persistence to load persisted updates from IndexedDB
      await adapter2.whenLoaded;
      adapter2.connect(board2);
      expect(adapter2.status).toBe('synced');

      // Verify the record was faithfully restored from IndexedDB
      const restored = board2.getElement('sticky-offline-1');
      expect(restored).toBeDefined();
      expect(restored?.props.text).toBe('Created offline');
      expect(restored?.props.color).toBe('lime');

      adapter2.disconnect();
    });

    it('persists record updates and deletions across sessions', async () => {
      const dbName = 'offline-crud-test';

      // --- Session 1: Add two elements ---
      const board1 = createBoard();
      const adapter1 = createYjsSyncAdapter({ indexeddb: { name: dbName } });
      await adapter1.whenLoaded;
      adapter1.connect(board1);

      board1.transact((tx) => {
        tx.put(makeElement('el-keep', { props: { text: 'To keep' } }));
        tx.put(makeElement('el-remove', { props: { text: 'To delete' } }));
      });
      adapter1.disconnect();

      // --- Session 2: Update one, delete one ---
      const board2 = createBoard();
      const adapter2 = createYjsSyncAdapter({ indexeddb: { name: dbName } });
      await adapter2.whenLoaded;
      adapter2.connect(board2);

      expect(board2.getElement('el-keep')).toBeDefined();
      expect(board2.getElement('el-remove')).toBeDefined();

      board2.transact((tx) => {
        const el = board2.getElement('el-keep');
        if (el) {
          tx.put({ ...el, props: { ...el.props, text: 'Updated text' } });
        }
        tx.remove('el-remove');
      });
      adapter2.disconnect();

      // --- Session 3: Verify updated and deleted state ---
      const board3 = createBoard();
      const adapter3 = createYjsSyncAdapter({ indexeddb: { name: dbName } });
      await adapter3.whenLoaded;
      adapter3.connect(board3);

      expect(board3.getElement('el-keep')?.props.text).toBe('Updated text');
      expect(board3.getElement('el-remove')).toBeUndefined();

      adapter3.disconnect();
    });

    it('automatically merges offline changes with remote updates upon reconnecting', async () => {
      const dbName = 'offline-reconnect-merge-test';

      // Client A (offline user)
      const boardA = createBoard();
      const adapterA = createYjsSyncAdapter({ indexeddb: { name: dbName } });
      await adapterA.whenLoaded;
      adapterA.connect(boardA);

      // Client B (online user collaborating on another client/doc)
      const boardB = createBoard();
      const adapterB = createYjsSyncAdapter({ indexeddb: false });
      adapterB.connect(boardB);

      // Client A makes local offline change
      boardA.transact((tx) => {
        tx.put(makeElement('note-client-a', { props: { text: 'Offline note from A' } }));
      });

      // Client B makes concurrent change
      boardB.transact((tx) => {
        tx.put(makeElement('note-client-b', { props: { text: 'Online note from B' } }));
      });

      // Reconnect: sync updates between Client A and Client B
      const updateFromA = Y.encodeStateAsUpdate(adapterA.doc);
      const updateFromB = Y.encodeStateAsUpdate(adapterB.doc);
      Y.applyUpdate(adapterB.doc, updateFromA);
      Y.applyUpdate(adapterA.doc, updateFromB);

      // Both boards merge state seamlessly via CRDT
      expect(boardA.getElement('note-client-a')?.props.text).toBe('Offline note from A');
      expect(boardA.getElement('note-client-b')?.props.text).toBe('Online note from B');
      expect(boardB.getElement('note-client-a')?.props.text).toBe('Offline note from A');
      expect(boardB.getElement('note-client-b')?.props.text).toBe('Online note from B');

      adapterA.disconnect();
      adapterB.disconnect();

      // Verify Client A's IndexedDB persists the merged state
      const boardA2 = createBoard();
      const adapterA2 = createYjsSyncAdapter({ indexeddb: { name: dbName } });
      await adapterA2.whenLoaded;
      adapterA2.connect(boardA2);

      expect(boardA2.getElement('note-client-a')).toBeDefined();
      expect(boardA2.getElement('note-client-b')).toBeDefined();

      adapterA2.disconnect();
    });
  });

  describe('Clean teardown and reconnection', () => {
    beforeEach(() => {
      globalThis.indexedDB = new IDBFactory();
      (globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = IDBKeyRange;
    });

    afterEach(() => {
      delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
      delete (globalThis as unknown as { IDBKeyRange?: unknown }).IDBKeyRange;
    });

    it('destroys persistence on adapter.disconnect()', async () => {
      const adapter = createYjsSyncAdapter({
        indexeddb: { name: 'teardown-test' },
      });
      const persistence = adapter.persistence!;
      expect(persistence).toBeInstanceOf(IndexeddbPersistence);

      const destroySpy = vi.spyOn(persistence, 'destroy');

      await adapter.whenLoaded;
      adapter.disconnect();

      expect(destroySpy).toHaveBeenCalled();
      expect(adapter.persistence).toBeNull();
      expect(adapter.status).toBe('offline');
    });

    it('destroys persistence on board.dispose()', async () => {
      const board = createBoard();
      const adapter = createYjsSyncAdapter({
        indexeddb: { name: 'dispose-test' },
      });
      const persistence = adapter.persistence!;
      const destroySpy = vi.spyOn(persistence, 'destroy');

      attachSync(board, adapter);
      await adapter.whenLoaded;

      board.dispose();

      expect(destroySpy).toHaveBeenCalled();
      expect(adapter.persistence).toBeNull();
      expect(adapter.status).toBe('offline');
    });

    it('recreates persistence cleanly when reconnecting after disconnect', async () => {
      const adapter = createYjsSyncAdapter({
        indexeddb: { name: 'reconnect-test' },
      });
      const board1 = createBoard();

      await adapter.whenLoaded;
      adapter.connect(board1);
      expect(adapter.status).toBe('synced');

      adapter.disconnect();
      expect(adapter.persistence).toBeNull();

      // Reconnect
      const board2 = createBoard();
      await adapter.connect(board2);
      expect(adapter.persistence).toBeInstanceOf(IndexeddbPersistence);
      expect(adapter.status).toBe('synced');

      adapter.disconnect();
    });
  });

  describe('isOnlineRequired hook', () => {
    it('returns false by default when hook is not configured', () => {
      const adapter = createYjsSyncAdapter();
      expect(adapter.isOnlineRequired?.('any-action')).toBe(false);
    });

    it('delegates to custom hook when specified in options', () => {
      const adapter = createYjsSyncAdapter({
        isOnlineRequired: (action) => action === 'convert-to-cloud' || action === 'ai-summary',
      });

      expect(adapter.isOnlineRequired?.('convert-to-cloud')).toBe(true);
      expect(adapter.isOnlineRequired?.('ai-summary')).toBe(true);
      expect(adapter.isOnlineRequired?.('create-sticky')).toBe(false);
    });
  });
});
