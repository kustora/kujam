import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  attachSync,
  createBoard,
  type AssetRecord,
  type BindingRecord,
  type ElementRecord,
  type PageRecord,
} from '@kujam/core';
import {
  createYjsSyncAdapter,
  isValidBoardRecord,
  recordToYMap,
  yMapToRecord,
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

function syncDocs(docA: Y.Doc, docB: Y.Doc): void {
  const updateA = Y.encodeStateAsUpdate(docA);
  const updateB = Y.encodeStateAsUpdate(docB);
  Y.applyUpdate(docB, updateA);
  Y.applyUpdate(docA, updateB);
}

describe('BOARD-1502a: Record to Y.Map mapping and bi-directional conversion', () => {
  it('converts ElementRecord to Y.Map and back faithfully', () => {
    const doc = new Y.Doc();
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    const yMap = new Y.Map<unknown>();
    recordsMap.set('el-1', yMap);

    const original: ElementRecord = {
      id: 'el-1',
      kind: 'element',
      type: 'sticky',
      pageId: 'page:main',
      parentId: 'frame-1',
      index: 'a0',
      x: 50.5,
      y: 120.25,
      rotation: 45,
      w: 200,
      h: 150,
      locked: true,
      opacity: 0.8,
      props: { text: 'Note content', color: 'orange', fontSize: 16 },
      meta: { author: 'Alice' },
      typeVersion: 2,
    };

    recordToYMap(original, yMap);

    // Verify props stored as nested Y.Map for property-level CRDT merging
    expect(yMap.get('props')).toBeInstanceOf(Y.Map);

    const restored = yMapToRecord(yMap);
    expect(restored).toEqual(original);
  });

  it('converts PageRecord to Y.Map and back faithfully', () => {
    const doc = new Y.Doc();
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    const yMap = new Y.Map<unknown>();
    recordsMap.set('page:main', yMap);

    const page: PageRecord = {
      id: 'page:main',
      kind: 'page',
      name: 'Main Page',
      index: 'a0',
      meta: { grid: true },
    };

    recordToYMap(page, yMap);
    const restored = yMapToRecord(yMap);
    expect(restored).toEqual(page);
  });

  it('converts BindingRecord to Y.Map and back faithfully', () => {
    const doc = new Y.Doc();
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    const yMap = new Y.Map<unknown>();
    recordsMap.set('binding-1', yMap);

    const binding: BindingRecord = {
      id: 'binding-1',
      kind: 'binding',
      fromId: 'el-1',
      toId: 'el-2',
      anchor: { x: 0.5, y: 1.0 },
    };

    recordToYMap(binding, yMap);
    const restored = yMapToRecord(yMap);
    expect(restored).toEqual(binding);
  });

  it('converts AssetRecord to Y.Map and back faithfully', () => {
    const doc = new Y.Doc();
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    const yMap = new Y.Map<unknown>();
    recordsMap.set('asset-1', yMap);

    const asset: AssetRecord = {
      id: 'asset-1',
      kind: 'asset',
      mimeType: 'image/png',
      w: 800,
      h: 600,
      meta: { originalName: 'diagram.png' },
    };

    recordToYMap(asset, yMap);
    const restored = yMapToRecord(yMap);
    expect(restored).toEqual(asset);
  });

  it('removes deleted keys from Y.Map on update', () => {
    const doc = new Y.Doc();
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    const yMap = new Y.Map<unknown>();
    recordsMap.set('el-1', yMap);

    const el1 = makeElement('el-1', {
      typeVersion: 3,
      props: { fill: 'red', stroke: 'black' },
    });
    recordToYMap(el1, yMap);
    expect(yMap.get('typeVersion')).toBe(3);
    expect((yMap.get('props') as Y.Map<unknown>).get('fill')).toBe('red');

    // Update with typeVersion omitted and props.stroke omitted
    const el2 = makeElement('el-1', {
      typeVersion: undefined,
      props: { fill: 'blue' },
    });
    recordToYMap(el2, yMap);
    expect(yMap.has('typeVersion')).toBe(false);
    const propsMap = yMap.get('props') as Y.Map<unknown>;
    expect(propsMap.has('stroke')).toBe(false);
    expect(propsMap.get('fill')).toBe('blue');

    const restored = yMapToRecord(yMap);
    expect(restored?.props).toEqual({ fill: 'blue' });
  });

  it('validates records strictly with isValidBoardRecord', () => {
    expect(isValidBoardRecord(null)).toBe(false);
    expect(isValidBoardRecord(undefined)).toBe(false);
    expect(isValidBoardRecord([])).toBe(false);
    expect(isValidBoardRecord({ id: '', kind: 'element' })).toBe(false);

    // Non-finite coordinates
    const elWithNaN = makeElement('el-bad', { x: NaN });
    expect(isValidBoardRecord(elWithNaN)).toBe(false);
    const elWithInfinity = makeElement('el-bad', { w: Infinity });
    expect(isValidBoardRecord(elWithInfinity)).toBe(false);

    // Missing required fields
    const elMissingType = { ...makeElement('el-bad'), type: '' };
    expect(isValidBoardRecord(elMissingType)).toBe(false);

    // Non-object props
    const elInvalidProps = { ...makeElement('el-bad'), props: 'invalid' };
    expect(isValidBoardRecord(elInvalidProps)).toBe(false);

    // Invalid binding anchor
    const invalidBinding = {
      id: 'b-bad',
      kind: 'binding',
      fromId: 'a',
      toId: 'b',
      anchor: { x: NaN, y: 0.5 },
    };
    expect(isValidBoardRecord(invalidBinding)).toBe(false);

    // yMapToRecord returns null for invalid data
    const doc = new Y.Doc();
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    const yMap = new Y.Map<unknown>();
    recordsMap.set('bad-rec', yMap);
    yMap.set('id', 'bad-rec');
    yMap.set('kind', 'element');
    yMap.set('x', NaN);
    expect(yMapToRecord(yMap)).toBeNull();
  });
});

describe('BOARD-1502b: Echo prevention and transaction isolation', () => {
  it('does not re-trigger board transactions from local changes', () => {
    const board = createBoard();
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });
    attachSync(board, adapter);

    const originsSeen: string[] = [];
    board.on('change', (e) => {
      originsSeen.push(e.origin);
    });

    board.transact((tx) => {
      tx.put(makeElement('el-local-1'));
    });

    // Only the initial local transaction should have occurred on the board
    expect(originsSeen).toEqual(['local']);
    expect(doc.getMap('records').has('el-local-1')).toBe(true);
  });

  it('does not re-trigger Y.Doc transactions when applying remote changes', () => {
    const board = createBoard();
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });
    attachSync(board, adapter);

    const docTransactions: unknown[] = [];
    doc.on('afterTransaction', (tx: Y.Transaction) => {
      docTransactions.push(tx.origin);
    });

    // Simulate remote peer inserting a record directly into doc
    const remoteOrigin = 'peer-origin-token';
    doc.transact(() => {
      const recordsMap = doc.getMap<Y.Map<unknown>>('records');
      const elMap = new Y.Map<unknown>();
      recordsMap.set('el-remote-1', elMap);
      recordToYMap(makeElement('el-remote-1', { x: 300 }), elMap);
    }, remoteOrigin);

    // Board applies it with origin 'remote'
    expect(board.getElement('el-remote-1')).toBeDefined();
    expect(board.getElement('el-remote-1')?.x).toBe(300);

    // Verify Y.Doc received ONLY the remote transaction, no echoing transaction from local board
    expect(docTransactions).toEqual([remoteOrigin]);
  });
});

describe('Empty vs populated initialization scenarios', () => {
  it('initializes an empty Y.Doc from an existing board', () => {
    const board = createBoard();
    board.transact((tx) => {
      tx.put(makeElement('el-init-1', { x: 99 }));
    });

    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });
    expect(doc.getMap('records').size).toBe(0);

    attachSync(board, adapter);

    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    expect(recordsMap.has('el-init-1')).toBe(true);
    const restored = yMapToRecord(recordsMap.get('el-init-1')!);
    expect(restored?.id).toBe('el-init-1');
    expect((restored as ElementRecord).x).toBe(99);
  });

  it('initializes a board from an already populated Y.Doc', () => {
    const doc = new Y.Doc();
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');

    doc.transact(() => {
      const p = new Y.Map<unknown>();
      recordsMap.set('page:main', p);
      recordToYMap(
        { id: 'page:main', kind: 'page', name: 'Shared Page', index: 'a0', meta: {} },
        p,
      );

      const el = new Y.Map<unknown>();
      recordsMap.set('el-shared-1', el);
      recordToYMap(makeElement('el-shared-1', { y: 250 }), el);
    });

    const board = createBoard();
    const adapter = createYjsSyncAdapter({ doc });
    attachSync(board, adapter);

    expect(board.getElement('el-shared-1')).toBeDefined();
    expect(board.getElement('el-shared-1')?.y).toBe(250);
  });

  it('two boards connecting to empty Y.Doc simultaneously do not duplicate records', () => {
    const doc = new Y.Doc();
    const board1 = createBoard();
    const board2 = createBoard();

    const adapter1 = createYjsSyncAdapter({ doc });
    const adapter2 = createYjsSyncAdapter({ doc });

    attachSync(board1, adapter1);
    attachSync(board2, adapter2);

    const recordsMap = doc.getMap('records');
    // Default page record 'page:main' should exist exactly once in recordsMap
    expect(recordsMap.has('page:main')).toBe(true);
    expect(recordsMap.size).toBe(1);
    expect(Object.keys(board1.getDocument().records)).toEqual(['page:main']);
    expect(Object.keys(board2.getDocument().records)).toEqual(['page:main']);
  });
});

describe('BOARD-1502c: Multi-client convergence tests', () => {
  it('converges concurrent edits to different elements between two clients', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const board1 = createBoard();
    const board2 = createBoard();

    const adapter1 = createYjsSyncAdapter({ doc: doc1 });
    const adapter2 = createYjsSyncAdapter({ doc: doc2 });

    attachSync(board1, adapter1);
    attachSync(board2, adapter2);

    // Initial sync
    syncDocs(doc1, doc2);

    // Client 1 adds Element A
    board1.transact((tx) => {
      tx.put(makeElement('el-a', { x: 100 }));
    });

    // Client 2 concurrently adds Element B
    board2.transact((tx) => {
      tx.put(makeElement('el-b', { x: 200 }));
    });

    // Exchange updates
    syncDocs(doc1, doc2);

    // Both boards should have both elements
    expect(board1.getElement('el-a')?.x).toBe(100);
    expect(board1.getElement('el-b')?.x).toBe(200);

    expect(board2.getElement('el-a')?.x).toBe(100);
    expect(board2.getElement('el-b')?.x).toBe(200);

    expect(board1.getDocument().records).toEqual(board2.getDocument().records);
  });

  it('converges concurrent edits to different properties of the same element', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const board1 = createBoard();
    const board2 = createBoard();

    const adapter1 = createYjsSyncAdapter({ doc: doc1 });
    const adapter2 = createYjsSyncAdapter({ doc: doc2 });

    attachSync(board1, adapter1);
    attachSync(board2, adapter2);

    // Create shared element on board1
    board1.transact((tx) => {
      tx.put(
        makeElement('el-shared', {
          x: 10,
          y: 20,
          props: { fill: 'red', stroke: 'blue' },
        }),
      );
    });

    // Sync so both have it
    syncDocs(doc1, doc2);
    expect(board2.getElement('el-shared')?.props).toEqual({ fill: 'red', stroke: 'blue' });

    // Client 1 updates coordinates x/y
    board1.transact((tx) => {
      const el = tx.get('el-shared') as ElementRecord;
      tx.put({ ...el, x: 500, y: 600 });
    });

    // Client 2 concurrently updates props.fill
    board2.transact((tx) => {
      const el = tx.get('el-shared') as ElementRecord;
      tx.put({ ...el, props: { ...el.props, fill: 'green' } });
    });

    // Exchange updates
    syncDocs(doc1, doc2);

    // Both clients should converge to coordinates (500, 600) AND fill: 'green', stroke: 'blue'
    const final1 = board1.getElement('el-shared')!;
    const final2 = board2.getElement('el-shared')!;

    expect(final1.x).toBe(500);
    expect(final1.y).toBe(600);
    expect(final1.props).toEqual({ fill: 'green', stroke: 'blue' });

    expect(final2.x).toBe(500);
    expect(final2.y).toBe(600);
    expect(final2.props).toEqual({ fill: 'green', stroke: 'blue' });
  });

  it('converges concurrent edits to different keys inside element props', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const board1 = createBoard();
    const board2 = createBoard();

    attachSync(board1, createYjsSyncAdapter({ doc: doc1 }));
    attachSync(board2, createYjsSyncAdapter({ doc: doc2 }));

    board1.transact((tx) => {
      tx.put(
        makeElement('el-props', {
          props: { fill: 'white', stroke: 'black', strokeWidth: 1 },
        }),
      );
    });

    syncDocs(doc1, doc2);

    // Client 1 updates fill
    board1.transact((tx) => {
      const el = tx.get('el-props') as ElementRecord;
      tx.put({ ...el, props: { ...el.props, fill: 'purple' } });
    });

    // Client 2 updates strokeWidth
    board2.transact((tx) => {
      const el = tx.get('el-props') as ElementRecord;
      tx.put({ ...el, props: { ...el.props, strokeWidth: 5 } });
    });

    syncDocs(doc1, doc2);

    expect(board1.getElement('el-props')?.props).toEqual({
      fill: 'purple',
      stroke: 'black',
      strokeWidth: 5,
    });
    expect(board2.getElement('el-props')?.props).toEqual({
      fill: 'purple',
      stroke: 'black',
      strokeWidth: 5,
    });
  });

  it('converges concurrent addition and deletion', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const board1 = createBoard();
    const board2 = createBoard();

    attachSync(board1, createYjsSyncAdapter({ doc: doc1 }));
    attachSync(board2, createYjsSyncAdapter({ doc: doc2 }));

    board1.transact((tx) => {
      tx.put(makeElement('el-target', { x: 10 }));
    });

    syncDocs(doc1, doc2);

    // Client 1 updates target
    board1.transact((tx) => {
      const el = tx.get('el-target') as ElementRecord;
      tx.put({ ...el, x: 999 });
    });

    // Client 2 deletes target
    board2.transact((tx) => {
      tx.remove('el-target');
    });

    syncDocs(doc1, doc2);

    // State converges identically on both boards
    expect(board1.getDocument().records).toEqual(board2.getDocument().records);
  });

  it('converges across 3 clients concurrently editing different records', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const doc3 = new Y.Doc();

    const board1 = createBoard();
    const board2 = createBoard();
    const board3 = createBoard();

    attachSync(board1, createYjsSyncAdapter({ doc: doc1 }));
    attachSync(board2, createYjsSyncAdapter({ doc: doc2 }));
    attachSync(board3, createYjsSyncAdapter({ doc: doc3 }));

    syncDocs(doc1, doc2);
    syncDocs(doc2, doc3);
    syncDocs(doc1, doc3);

    // 3 clients edit concurrently
    board1.transact((tx) => tx.put(makeElement('el-c1', { x: 111 })));
    board2.transact((tx) => tx.put(makeElement('el-c2', { x: 222 })));
    board3.transact((tx) => tx.put(makeElement('el-c3', { x: 333 })));

    // Synchronize full ring
    syncDocs(doc1, doc2);
    syncDocs(doc2, doc3);
    syncDocs(doc1, doc3);
    syncDocs(doc1, doc2);

    expect(board1.getElement('el-c1')?.x).toBe(111);
    expect(board1.getElement('el-c2')?.x).toBe(222);
    expect(board1.getElement('el-c3')?.x).toBe(333);

    expect(board1.getDocument().records).toEqual(board2.getDocument().records);
    expect(board2.getDocument().records).toEqual(board3.getDocument().records);
  });
});

describe('Validation and error handling', () => {
  it('drops malformed peer records and reports them via board.reportError and adapter error', () => {
    const board = createBoard();
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });
    attachSync(board, adapter);

    const boardErrors: unknown[] = [];
    board.on('error', (err) => {
      boardErrors.push(err);
    });

    const adapterErrors: unknown[] = [];
    adapter.on('error', (err) => {
      adapterErrors.push(err);
    });

    // Remote peer inserts one valid and one malformed record
    doc.transact(() => {
      const recordsMap = doc.getMap<Y.Map<unknown>>('records');

      // Valid
      const validMap = new Y.Map<unknown>();
      recordsMap.set('el-valid', validMap);
      recordToYMap(makeElement('el-valid', { x: 77 }), validMap);

      // Malformed: non-finite number and invalid kind
      const malformedMap = new Y.Map<unknown>();
      recordsMap.set('el-bad', malformedMap);
      malformedMap.set('id', 'el-bad');
      malformedMap.set('kind', 'bogus-kind');
      malformedMap.set('x', NaN);
    }, 'remote-origin');

    // Valid record is applied
    expect(board.getElement('el-valid')?.x).toBe(77);

    // Malformed record is NOT applied to the board
    expect(board.getElement('el-bad')).toBeUndefined();

    // Errors reported
    expect(boardErrors.length).toBeGreaterThan(0);
    expect((boardErrors[0] as { code: string }).code).toBe('invalid-record');
    expect(adapterErrors.length).toBeGreaterThan(0);
  });

  it('respects custom validateRecord option', () => {
    const board = createBoard();
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({
      doc,
      validateRecord: (record): record is ElementRecord => {
        // Reject elements with type 'forbidden'
        if ((record as ElementRecord).type === 'forbidden') {
          return false;
        }
        return true;
      },
    });
    attachSync(board, adapter);

    doc.transact(() => {
      const recordsMap = doc.getMap<Y.Map<unknown>>('records');
      const elMap = new Y.Map<unknown>();
      recordsMap.set('el-forbidden', elMap);
      recordToYMap(makeElement('el-forbidden', { type: 'forbidden' }), elMap);
    }, 'remote-origin');

    expect(board.getElement('el-forbidden')).toBeUndefined();
  });
});

describe('Lifecycle and disconnect behavior', () => {
  it('stops synchronization after disconnect', () => {
    const board = createBoard();
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });
    const attachment = attachSync(board, adapter);

    expect(adapter.status).toBe('synced');

    // Disconnect
    attachment.disconnect();
    expect(adapter.status).toBe('offline');

    // Local board changes do not sync to doc
    board.transact((tx) => {
      tx.put(makeElement('el-offline-1'));
    });
    expect(doc.getMap('records').has('el-offline-1')).toBe(false);

    // Doc changes do not sync to board
    doc.transact(() => {
      const recordsMap = doc.getMap<Y.Map<unknown>>('records');
      const elMap = new Y.Map<unknown>();
      recordsMap.set('el-offline-2', elMap);
      recordToYMap(makeElement('el-offline-2'), elMap);
    }, 'remote-origin');
    expect(board.getElement('el-offline-2')).toBeUndefined();
  });

  it('disconnects automatically when board is disposed', () => {
    const board = createBoard();
    const adapter = createYjsSyncAdapter();
    attachSync(board, adapter);

    expect(adapter.status).toBe('synced');

    board.dispose();
    expect(adapter.status).toBe('offline');
  });

  it('manages status event emissions properly', () => {
    const board = createBoard();
    const adapter = createYjsSyncAdapter();
    const statuses: string[] = [];
    adapter.on('status', (s) => statuses.push(s));

    adapter.connect(board);
    expect(statuses).toEqual(['connecting', 'synced']);

    adapter.disconnect();
    expect(statuses).toEqual(['connecting', 'synced', 'offline']);
  });

  it('handles re-connect to a different board properly', () => {
    const board1 = createBoard();
    const board2 = createBoard();
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });

    adapter.connect(board1);
    expect(adapter.status).toBe('synced');

    // Calling connect on same board does nothing
    adapter.connect(board1);
    expect(adapter.status).toBe('synced');

    // Connect to board2 automatically disconnects from board1
    adapter.connect(board2);
    expect(adapter.status).toBe('synced');

    // Changes on board1 no longer sync to doc
    board1.transact((tx) => tx.put(makeElement('el-b1')));
    expect(doc.getMap('records').has('el-b1')).toBe(false);

    // Changes on board2 sync to doc
    board2.transact((tx) => tx.put(makeElement('el-b2')));
    expect(doc.getMap('records').has('el-b2')).toBe(true);
  });

  it('handles corrupted non-YMap values in recordsMap gracefully', () => {
    const board = createBoard();
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });
    attachSync(board, adapter);

    const adapterErrors: unknown[] = [];
    adapter.on('error', (err) => adapterErrors.push(err));

    doc.transact(() => {
      const recordsMap = doc.getMap('records');
      // Buggy peer sets primitive string instead of Y.Map
      recordsMap.set('corrupted-key', 'primitive-string' as unknown as Y.Map<unknown>);
    }, 'remote');

    expect(adapterErrors.length).toBeGreaterThan(0);
    expect(board.getElement('corrupted-key')).toBeUndefined();
  });

  it('handles direct nested property mutations in Y.Doc', () => {
    const board = createBoard();
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });
    attachSync(board, adapter);

    board.transact((tx) => {
      tx.put(makeElement('el-prop-test', { props: { fill: 'yellow' } }));
    });

    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    const elMap = recordsMap.get('el-prop-test')!;
    const propsMap = elMap.get('props') as Y.Map<unknown>;

    // Direct remote mutation of nested prop
    doc.transact(() => {
      propsMap.set('fill', 'chartreuse');
    }, 'remote-user');

    expect(board.getElement('el-prop-test')?.props).toEqual({ fill: 'chartreuse' });
  });

  it('handles add and immediate delete in the same remote transaction', () => {
    const board = createBoard();
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });
    attachSync(board, adapter);

    doc.transact(() => {
      const recordsMap = doc.getMap<Y.Map<unknown>>('records');
      const tempMap = new Y.Map<unknown>();
      recordsMap.set('el-flash', tempMap);
      recordToYMap(makeElement('el-flash'), tempMap);
      recordsMap.delete('el-flash');
    }, 'remote');

    expect(board.getElement('el-flash')).toBeUndefined();
  });
});
