import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import { attachSync, createBoard, type BoardRecord } from '@kujam/core';
import { createYjsSyncAdapter } from './index.js';

function recordFor(id: string, x = 0, y = 0): BoardRecord {
  return {
    id,
    kind: 'element',
    type: 'sticky',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x,
    y,
    rotation: 0,
    w: 100,
    h: 100,
    locked: false,
    opacity: 1,
    props: {
      color: 'yellow',
      text: [{ insert: `Hello ${id}\n` }],
    },
    meta: {},
  };
}

describe('BOARD-1507: Per-user Undo/Redo via Yjs UndoManager', () => {
  let doc1: Y.Doc;
  let doc2: Y.Doc;
  let awareness1: Awareness;
  let awareness2: Awareness;

  beforeEach(() => {
    doc1 = new Y.Doc();
    doc2 = new Y.Doc();
    awareness1 = new Awareness(doc1);
    awareness2 = new Awareness(doc2);

    // Bidirectional Y.Doc synchronization
    doc1.on('update', (update) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update) => {
      Y.applyUpdate(doc1, update);
    });
  });

  it('restricts undo tracking to local client origin so undo does not revert remote peers changes', () => {
    const board1 = createBoard();
    const board2 = createBoard();

    const adapter1 = createYjsSyncAdapter({
      doc: doc1,
      awareness: awareness1,
      user: { id: 'alice', name: 'Alice', color: '#ff0000' },
    });
    const adapter2 = createYjsSyncAdapter({
      doc: doc2,
      awareness: awareness2,
      user: { id: 'bob', name: 'Bob', color: '#00ff00' },
    });

    const att1 = attachSync(board1, adapter1);
    const att2 = attachSync(board2, adapter2);

    // 1. Alice creates sticky-A1
    board1.transact((tx) => {
      tx.put(recordFor('sticky-A1', 10, 10));
    });

    // 2. Bob creates sticky-B1
    board2.transact((tx) => {
      tx.put(recordFor('sticky-B1', 200, 200));
    });

    // 3. Alice creates sticky-A2
    board1.transact((tx) => {
      tx.put(recordFor('sticky-A2', 50, 50));
    });

    // 4. Bob creates sticky-B2
    board2.transact((tx) => {
      tx.put(recordFor('sticky-B2', 300, 300));
    });

    // Both boards should have all 4 records
    expect(Object.keys(board1.getDocument().records)).toEqual(
      expect.arrayContaining(['sticky-A1', 'sticky-B1', 'sticky-A2', 'sticky-B2']),
    );
    expect(Object.keys(board2.getDocument().records)).toEqual(
      expect.arrayContaining(['sticky-A1', 'sticky-B1', 'sticky-A2', 'sticky-B2']),
    );

    // 5. Alice calls undo -> only Alice's sticky-A2 should be undone!
    expect(board1.history.canUndo).toBe(true);
    expect(board1.undo()).toBe(true);

    expect(board1.getDocument().records['sticky-A2']).toBeUndefined();
    expect(board2.getDocument().records['sticky-A2']).toBeUndefined();

    // Bob's records MUST remain completely untouched!
    expect(board1.getDocument().records['sticky-B1']).toBeDefined();
    expect(board1.getDocument().records['sticky-B2']).toBeDefined();
    expect(board2.getDocument().records['sticky-B1']).toBeDefined();
    expect(board2.getDocument().records['sticky-B2']).toBeDefined();

    // 6. Alice calls undo again -> only sticky-A1 should be undone!
    expect(board1.undo()).toBe(true);
    expect(board1.getDocument().records['sticky-A1']).toBeUndefined();
    expect(board2.getDocument().records['sticky-A1']).toBeUndefined();

    // Bob's records still intact!
    expect(board1.getDocument().records['sticky-B1']).toBeDefined();
    expect(board1.getDocument().records['sticky-B2']).toBeDefined();

    // 7. Bob calls undo -> only Bob's sticky-B2 is undone
    expect(board2.undo()).toBe(true);
    expect(board1.getDocument().records['sticky-B2']).toBeUndefined();
    expect(board2.getDocument().records['sticky-B2']).toBeUndefined();
    expect(board1.getDocument().records['sticky-B1']).toBeDefined();
    expect(board2.getDocument().records['sticky-B1']).toBeDefined();

    // 8. Alice redoes -> sticky-A1 restored
    expect(board1.redo()).toBe(true);
    expect(board1.getDocument().records['sticky-A1']).toBeDefined();
    expect(board2.getDocument().records['sticky-A1']).toBeDefined();

    att1.disconnect();
    att2.disconnect();
  });

  it('preserves coalescing with mergeKey and transaction labels', () => {
    const board = createBoard();
    const adapter = createYjsSyncAdapter({
      doc: doc1,
      awareness: awareness1,
    });
    const att = attachSync(board, adapter);

    // Continuous typing with the same mergeKey should coalesce into one undo step
    board.transact(
      (tx) => {
        tx.put(recordFor('sticky-1', 10, 10));
      },
      { mergeKey: 'edit:sticky-1', label: 'type text' },
    );

    board.transact(
      (tx) => {
        tx.put(recordFor('sticky-1', 10, 20));
      },
      { mergeKey: 'edit:sticky-1', label: 'type text' },
    );

    // Only 1 undo step created due to coalescing
    expect(adapter.history?.undoStack).toHaveLength(1);
    expect(adapter.history?.undoStack?.[0].label).toBe('type text');

    // A transaction with a different mergeKey starts a new step
    board.transact(
      (tx) => {
        tx.put(recordFor('sticky-2', 50, 50));
      },
      { mergeKey: 'edit:sticky-2', label: 'create second' },
    );

    expect(adapter.history?.undoStack).toHaveLength(2);
    expect(adapter.history?.undoStack?.[1].label).toBe('create second');

    // Undo should undo sticky-2 first
    expect(board.undo()).toBe(true);
    expect(board.getDocument().records['sticky-2']).toBeUndefined();
    expect(board.getDocument().records['sticky-1']).toBeDefined();

    // Next undo undoes all coalesced sticky-1 edits in one go
    expect(board.undo()).toBe(true);
    expect(board.getDocument().records['sticky-1']).toBeUndefined();

    att.disconnect();
  });

  it('supports board.history.batch(key, fn) to fold multiple transactions into one step', () => {
    const board = createBoard();
    const adapter = createYjsSyncAdapter({ doc: doc1, awareness: awareness1 });
    const att = attachSync(board, adapter);

    board.history.batch('batch-create', () => {
      board.transact((tx) => tx.put(recordFor('item-1', 0, 0)));
      board.transact((tx) => tx.put(recordFor('item-2', 10, 10)));
      board.transact((tx) => tx.put(recordFor('item-3', 20, 20)));
    });

    expect(board.getDocument().records['item-1']).toBeDefined();
    expect(board.getDocument().records['item-2']).toBeDefined();
    expect(board.getDocument().records['item-3']).toBeDefined();

    // Should undo all three in a single step
    expect(board.undo()).toBe(true);
    expect(board.getDocument().records['item-1']).toBeUndefined();
    expect(board.getDocument().records['item-2']).toBeUndefined();
    expect(board.getDocument().records['item-3']).toBeUndefined();

    // Redo restores all three
    expect(board.redo()).toBe(true);
    expect(board.getDocument().records['item-1']).toBeDefined();
    expect(board.getDocument().records['item-2']).toBeDefined();
    expect(board.getDocument().records['item-3']).toBeDefined();

    att.disconnect();
  });

  it('invokes tx.onUndo and tx.onRedo hooks (BOARD-303) when steps are reversed or reapplied', () => {
    const board = createBoard();
    const adapter = createYjsSyncAdapter({ doc: doc1, awareness: awareness1 });
    const att = attachSync(board, adapter);

    const undoCalls: { label?: string }[] = [];
    const redoCalls: { label?: string }[] = [];

    board.transact(
      (tx) => {
        tx.put(recordFor('plugin-record', 100, 100));
        tx.onUndo((ctx) => {
          undoCalls.push(ctx);
        });
        tx.onRedo((ctx) => {
          redoCalls.push(ctx);
        });
      },
      { label: 'create-plugin-record' },
    );

    expect(undoCalls).toHaveLength(0);
    expect(redoCalls).toHaveLength(0);

    // Trigger undo
    expect(board.undo()).toBe(true);
    expect(undoCalls).toEqual([{ label: 'create-plugin-record' }]);
    expect(redoCalls).toHaveLength(0);

    // Trigger redo
    expect(board.redo()).toBe(true);
    expect(redoCalls).toEqual([{ label: 'create-plugin-record' }]);

    att.disconnect();
  });

  it('restores element selection after undo if elements still exist', () => {
    const board = createBoard();
    const adapter = createYjsSyncAdapter({ doc: doc1, awareness: awareness1 });
    const att = attachSync(board, adapter);

    // Create two elements
    board.transact((tx) => {
      tx.put(recordFor('elem-A', 0, 0));
      tx.put(recordFor('elem-B', 100, 100));
    });

    // Select elem-A and elem-B
    board.select(['elem-A', 'elem-B']);
    expect(board.selection).toEqual(['elem-A', 'elem-B']);

    // Perform an edit while selected (e.g. moving them)
    board.transact(
      (tx) => {
        tx.put(recordFor('elem-A', 50, 50));
        tx.put(recordFor('elem-B', 150, 150));
      },
      { label: 'move elements' },
    );

    // Deselect
    board.select([]);
    expect(board.selection).toEqual([]);

    // Undo should restore selection to elem-A and elem-B
    expect(board.undo()).toBe(true);
    expect(board.selection).toEqual(expect.arrayContaining(['elem-A', 'elem-B']));

    att.disconnect();
  });

  it('notifies board.on("history") when canUndo and canRedo change value', () => {
    const board = createBoard();
    const adapter = createYjsSyncAdapter({ doc: doc1, awareness: awareness1 });
    const att = attachSync(board, adapter);

    const historyEvents: { canUndo: boolean; canRedo: boolean }[] = [];
    board.on('history', (e) => {
      historyEvents.push(e);
    });

    expect(board.history.canUndo).toBe(false);
    expect(board.history.canRedo).toBe(false);

    board.transact((tx) => {
      tx.put(recordFor('item-1', 10, 10));
    });

    expect(board.history.canUndo).toBe(true);
    expect(historyEvents).toEqual([{ canUndo: true, canRedo: false }]);

    board.undo();
    expect(board.history.canUndo).toBe(false);
    expect(board.history.canRedo).toBe(true);
    expect(historyEvents[historyEvents.length - 1]).toEqual({ canUndo: false, canRedo: true });

    board.redo();
    expect(board.history.canUndo).toBe(true);
    expect(board.history.canRedo).toBe(false);

    att.disconnect();
  });

  it('allows disabling history delegation by passing history: false', () => {
    const board = createBoard();
    const adapter = createYjsSyncAdapter({
      doc: doc1,
      awareness: awareness1,
      history: false,
    });
    const att = attachSync(board, adapter);

    expect(adapter.history).toBeUndefined();

    // Board uses its own local history fallback
    board.transact((tx) => {
      tx.put(recordFor('item-local', 10, 10));
    });

    expect(board.history.canUndo).toBe(true);
    expect(board.undo()).toBe(true);
    expect(board.getDocument().records['item-local']).toBeUndefined();

    att.disconnect();
  });
});
