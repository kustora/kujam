import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  attachSync,
  createBoard,
  ReadOnlyBoardError,
  type Board,
  type BoardRecord,
} from '@kujam/core';
import {
  createYjsSyncAdapter,
  decodeSnapshot,
  encodeSnapshot,
  InvalidUpdateError,
  RESTORE_SNAPSHOT_LABEL,
  type YjsSyncAdapter,
} from './index.js';

function sticky(id: string, x = 0, text = `Hello ${id}`): BoardRecord {
  return {
    id,
    kind: 'element',
    type: 'sticky',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x,
    y: 0,
    rotation: 0,
    w: 100,
    h: 100,
    locked: false,
    opacity: 1,
    props: { color: 'yellow', text: [{ insert: `${text}\n` }] },
    meta: {},
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function peer(
  doc: Y.Doc,
  options: { readOnly?: boolean } = {},
): { board: Board; adapter: YjsSyncAdapter } {
  const board = createBoard();
  const adapter = createYjsSyncAdapter({ doc, indexeddb: false, ...options });
  const attachment = attachSync(board, adapter);
  cleanups.push(() => {
    attachment.disconnect();
    board.dispose();
  });
  return { board, adapter };
}

/** Two Y.Docs connected both ways, like two clients through a server. */
function connectedDocs(): [Y.Doc, Y.Doc] {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'net') Y.applyUpdate(b, u, 'net');
  });
  b.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'net') Y.applyUpdate(a, u, 'net');
  });
  return [a, b];
}

function elementIds(board: Board): string[] {
  return Object.values(board.getDocument().records)
    .filter((r) => r.kind === 'element')
    .map((r) => r.id)
    .sort();
}

describe('BOARD-1511: version snapshots', () => {
  it('encodeSnapshot produces storable bytes that decode to the same content', () => {
    const [docA] = connectedDocs();
    const { board, adapter } = peer(docA);
    board.transact((tx) => {
      tx.put(sticky('s1', 10));
      tx.put(sticky('s2', 20));
    });

    const bytes = adapter.encodeSnapshot();
    expect(bytes).toBeInstanceOf(Uint8Array);
    // Bytes survive a storage round trip (for example a database blob).
    const stored = Uint8Array.from(Array.from(bytes));
    const decoded = decodeSnapshot(stored);
    expect(decoded.records).toEqual(board.getDocument().records);

    // Standalone helpers accept a Y.Doc or a board document.
    expect(decodeSnapshot(encodeSnapshot(docA)).records).toEqual(decoded.records);
    expect(decodeSnapshot(encodeSnapshot(board.getDocument())).records).toEqual(decoded.records);
  });

  it('a snapshot holds content only, so it stays small after many edits', () => {
    const { board, adapter } = peer(new Y.Doc());
    board.transact((tx) => tx.put(sticky('s1')));
    for (let i = 0; i < 300; i++) {
      board.transact((tx) => tx.put(sticky('s1', i, `edit ${i}`)));
    }
    const full = Y.encodeStateAsUpdate(adapter.doc).byteLength;
    expect(adapter.encodeSnapshot().byteLength).toBeLessThan(full);
  });

  it('previewSnapshot decodes without touching the board or the shared document', () => {
    const { board, adapter } = peer(new Y.Doc());
    board.transact((tx) => tx.put(sticky('s1')));
    const bytes = adapter.encodeSnapshot();
    board.transact((tx) => {
      tx.remove('s1');
      tx.put(sticky('s2'));
    });
    const before = Y.encodeStateVector(adapter.doc);

    const preview = adapter.previewSnapshot(bytes);
    expect(Object.keys(preview.records)).toContain('s1');
    expect(elementIds(board)).toEqual(['s2']);
    expect(Y.encodeStateVector(adapter.doc)).toEqual(before);

    // The preview can be shown on its own read-only board.
    const previewBoard = createBoard({ document: preview, readOnly: true });
    cleanups.push(() => previewBoard.dispose());
    expect(elementIds(previewBoard)).toEqual(['s1']);
    expect(() => previewBoard.transact((tx) => tx.remove('s1'))).toThrow(ReadOnlyBoardError);

    expect(() => adapter.previewSnapshot(new Uint8Array([1, 2, 3, 250]))).toThrow(
      InvalidUpdateError,
    );
  });

  it('restoreSnapshot is a new synced change and one undo step', () => {
    const [docA, docB] = connectedDocs();
    const alice = peer(docA);
    const bob = peer(docB);

    alice.board.transact((tx) => tx.put(sticky('a1', 0, 'version 1')));
    const v1 = alice.adapter.encodeSnapshot();

    alice.board.transact((tx) => tx.put(sticky('a1', 50, 'version 2')));
    alice.board.transact((tx) => tx.put(sticky('a2', 80)));
    bob.board.transact((tx) => tx.put(sticky('b1', 120)));
    const before = alice.board.getDocument().records;

    const result = alice.adapter.restoreSnapshot(v1);
    expect([...result.updated]).toEqual(['a1']);
    expect([...result.removed].sort()).toEqual(['a2', 'b1']);
    const undoStack = alice.adapter.history!.undoStack!;
    expect(undoStack.at(-1)?.label).toBe(RESTORE_SNAPSHOT_LABEL);
    const stepsAfterRestore = undoStack.length;

    // Synced to every peer.
    for (const { board } of [alice, bob]) {
      expect(elementIds(board)).toEqual(['a1']);
      expect(board.getDocument().records['a1']).toEqual(sticky('a1', 0, 'version 1'));
    }

    // One undo step brings back the state before the restore, everywhere.
    expect(alice.board.undo()).toBe(true);
    expect(alice.adapter.history!.undoStack!.length).toBe(stepsAfterRestore - 1);
    for (const { board } of [alice, bob]) {
      expect(board.getDocument().records).toEqual(before);
    }
    expect(alice.board.redo()).toBe(true);
    expect(elementIds(bob.board)).toEqual(['a1']);
  });

  it("restoreSnapshot keeps other people's history", () => {
    const [docA, docB] = connectedDocs();
    const alice = peer(docA);
    const bob = peer(docB);
    const empty = alice.adapter.encodeSnapshot();

    bob.board.transact((tx) => tx.put(sticky('b1')));
    expect(bob.board.history.canUndo).toBe(true);

    alice.adapter.restoreSnapshot(empty);
    expect(elementIds(bob.board)).toEqual([]);
    // Bob still has his own step; Alice's restore is in Alice's history only.
    expect(bob.board.history.canUndo).toBe(true);
    expect(alice.board.history.canUndo).toBe(true);

    alice.board.undo();
    expect(elementIds(bob.board)).toEqual(['b1']);
    expect(bob.board.history.canUndo).toBe(true);
  });

  it('restoring the current state changes nothing', () => {
    const { board, adapter } = peer(new Y.Doc());
    board.transact((tx) => tx.put(sticky('s1')));
    const bytes = adapter.encodeSnapshot();
    const vector = Y.encodeStateVector(adapter.doc);
    const result = adapter.restoreSnapshot(bytes);
    expect(result.updated).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(Y.encodeStateVector(adapter.doc)).toEqual(vector);
  });

  it('read-only clients can preview but not restore (BOARD-1512)', () => {
    const [docA, docB] = connectedDocs();
    const editor = peer(docA);
    editor.board.transact((tx) => tx.put(sticky('s1')));
    const bytes = editor.adapter.encodeSnapshot();
    editor.board.transact((tx) => tx.put(sticky('s2')));

    const viewer = peer(docB, { readOnly: true });
    expect(Object.keys(viewer.adapter.previewSnapshot(bytes).records)).toContain('s1');
    expect(() => viewer.adapter.restoreSnapshot(bytes)).toThrow(ReadOnlyBoardError);
    expect(elementIds(editor.board)).toEqual(['s1', 's2']);
    expect(elementIds(viewer.board)).toEqual(['s1', 's2']);

    // Read-only receives a restore made by an editor.
    editor.adapter.restoreSnapshot(bytes);
    expect(elementIds(viewer.board)).toEqual(['s1']);
  });

  it('restoreSnapshot needs a connected board and rejects bad bytes', () => {
    const adapter = createYjsSyncAdapter({ indexeddb: false });
    expect(() => adapter.restoreSnapshot(adapter.encodeSnapshot())).toThrow(/terhubung/);
    const { adapter: connected } = peer(new Y.Doc());
    expect(() => connected.restoreSnapshot(new Uint8Array([9, 9, 9]))).toThrow(InvalidUpdateError);
  });
});
