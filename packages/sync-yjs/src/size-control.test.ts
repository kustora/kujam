import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { attachSync, createBoard, type BoardRecord } from '@kujam/core';
import {
  compactUpdate,
  createYjsSyncAdapter,
  InvalidUpdateError,
  yDocToDocument,
} from './index.js';

function sticky(id: string, x: number, text: string): BoardRecord {
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

const ELEMENTS = 200;
const EDITS = 10_000;

/** A board with `EDITS` edit operations (moves and text edits) made through the sync adapter. */
function editedBoardState(): { state: Uint8Array; log: Uint8Array[]; doc: Y.Doc } {
  const doc = new Y.Doc();
  const log: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => log.push(update));
  const board = createBoard({ freezeSnapshots: false });
  const adapter = createYjsSyncAdapter({ doc, indexeddb: false });
  const attachment = attachSync(board, adapter);
  board.transact((tx) => {
    for (let i = 0; i < ELEMENTS; i++) tx.put(sticky(`s${i}`, i * 10, `note ${i}`));
  });
  for (let n = 0; n < EDITS; n++) {
    const i = n % ELEMENTS;
    board.transact((tx) =>
      tx.put(sticky(`s${i}`, i * 10 + n, n % 2 === 0 ? `note ${i} rev ${n}` : `note ${i}`)),
    );
  }
  attachment.disconnect();
  board.dispose();
  return { state: Y.encodeStateAsUpdate(doc), log, doc };
}

describe('BOARD-1515: Yjs document size control', () => {
  it('keeps Yjs garbage collection on, so deleted content is not stored on the server', () => {
    const adapter = createYjsSyncAdapter({ indexeddb: false });
    expect(adapter.doc.gc).toBe(true);
    // Stands in for the server document, which receives every client update.
    const server = new Y.Doc();
    adapter.doc.on('update', (update: Uint8Array) => Y.applyUpdate(server, update));

    const board = createBoard();
    const attachment = attachSync(board, adapter);
    const marker = 'deleted-content-marker';
    board.transact((tx) => tx.put(sticky('s1', 0, marker.repeat(20))));
    board.transact((tx) => tx.remove('s1'));
    const decode = (doc: Y.Doc) => new TextDecoder().decode(Y.encodeStateAsUpdate(doc));
    expect(decode(server)).not.toContain(marker);
    // The client only keeps what its own undo history may still bring back.
    expect(adapter.history!.canUndo).toBe(true);
    attachment.disconnect();
    board.dispose();

    const noHistory = createYjsSyncAdapter({ indexeddb: false, history: false });
    const board2 = createBoard();
    const attachment2 = attachSync(board2, noHistory);
    board2.transact((tx) => tx.put(sticky('s1', 0, marker.repeat(20))));
    board2.transact((tx) => tx.remove('s1'));
    expect(decode(noHistory.doc)).not.toContain(marker);
    attachment2.disconnect();
    board2.dispose();
  });

  it('compactUpdate merges an update log into one smaller update with the same identity', () => {
    const { state, log, doc } = editedBoardState();
    const compacted = compactUpdate(log);
    const merged = Y.mergeUpdates(log);
    expect(compacted.byteLength).toBeLessThan(merged.byteLength);
    expect(compacted.byteLength).toBeLessThanOrEqual(state.byteLength);

    // Same content.
    const restored = new Y.Doc();
    Y.applyUpdate(restored, compacted);
    expect(yDocToDocument(restored)).toEqual(yDocToDocument(doc));

    // Same CRDT identity: a client that still has the old state merges without changes.
    expect(Y.encodeStateVector(restored)).toEqual(Y.encodeStateVector(doc));
    const client = new Y.Doc();
    Y.applyUpdate(client, state);
    Y.applyUpdate(client, compacted);
    expect(yDocToDocument(client)).toEqual(yDocToDocument(doc));
  });

  it('compactUpdate rejects oversized and corrupt input', () => {
    expect(() => compactUpdate(new Uint8Array(20), { maxUpdateBytes: 10 })).toThrow(
      InvalidUpdateError,
    );
    expect(() => compactUpdate([new Uint8Array([1, 2, 3, 250])])).toThrow(InvalidUpdateError);
    expect(() => compactUpdate(new Uint8Array(1), { maxUpdateBytes: 0 })).toThrow(RangeError);
  });

  it(`benchmark: a board with ${EDITS} edit operations loads in under 1 second`, () => {
    const { state, log } = editedBoardState();
    const compacted = compactUpdate(log);

    for (const [name, bytes] of [
      ['state', state],
      ['compacted log', compacted],
    ] as const) {
      const start = performance.now();
      const doc = new Y.Doc();
      Y.applyUpdate(doc, bytes);
      const board = createBoard();
      const adapter = createYjsSyncAdapter({ doc, indexeddb: false });
      const attachment = attachSync(board, adapter);
      const elapsed = performance.now() - start;

      expect(
        Object.values(board.getDocument().records).filter((r) => r.kind === 'element'),
      ).toHaveLength(ELEMENTS);
      console.info(
        `[BOARD-1515] ${name}: ${bytes.byteLength} bytes loaded in ${elapsed.toFixed(1)} ms`,
      );
      expect(elapsed).toBeLessThan(1000);
      attachment.disconnect();
      board.dispose();
    }
  }, 60_000);
});
