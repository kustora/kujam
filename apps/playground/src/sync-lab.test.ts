import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import { attachSync, createBoard, type Board, type ElementRecord } from '@kujam/core';
import { createYjsSyncAdapter } from '@kujam/sync-yjs';
import {
  convergence,
  createLabNetwork,
  documentHash,
  stableStringify,
  type LabNetwork,
} from './sync-lab.js';

function note(id: string, overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'note',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 0,
    y: 0,
    rotation: 0,
    w: 10,
    h: 10,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...overrides,
  };
}

interface Peer {
  id: string;
  board: Board;
  doc: Y.Doc;
  awareness: Awareness;
}

let network: LabNetwork;
let peers: Peer[];

function addPeer(id: string): Peer {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  network.join(id, doc, awareness);
  const board = createBoard();
  attachSync(
    board,
    createYjsSyncAdapter({
      doc,
      awareness,
      user: { id, name: id, color: '#000' },
      indexeddb: false,
      reconnect: false,
    }),
  );
  const peer = { id, board, doc, awareness };
  peers.push(peer);
  return peer;
}

function put(peer: Peer, record: ElementRecord): void {
  peer.board.transact((tx) => tx.put(record));
}

/** Lets in-flight messages arrive. `runAllTimers` never ends: `Awareness` runs an interval. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(2000);
}

function hashes(): string[] {
  return peers.map((p) => documentHash(p.board.getDocument()));
}

beforeEach(() => {
  vi.useFakeTimers();
  network = createLabNetwork({ random: () => 0 });
  peers = [];
});

afterEach(() => {
  network.destroy();
  for (const p of peers) p.board.dispose();
  vi.useRealTimers();
});

describe('BOARD-2410: lab network', () => {
  it('syncs boards through the in-memory transport', async () => {
    const a = addPeer('a');
    const b = addPeer('b');
    const c = addPeer('c');
    await settle();
    put(a, note('n1', { x: 5 }));
    await settle();

    expect(b.board.getElement('n1')?.x).toBe(5);
    expect(c.board.getElement('n1')?.x).toBe(5);
    expect(new Set(hashes()).size).toBe(1);
    expect(network.idle).toBe(true);
  });

  it('delays messages by the latency of both peers', async () => {
    const a = addPeer('a');
    const b = addPeer('b');
    await settle();
    network.setLatency('a', 100);
    network.setLatency('b', 50);

    put(a, note('n1'));
    expect(network.stats('b').inFlight).toBe(1);
    expect(network.idle).toBe(false);
    await vi.advanceTimersByTimeAsync(149);
    expect(b.board.getElement('n1')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(b.board.getElement('n1')).toBeDefined();
    expect(network.idle).toBe(true);
  });

  it('catches an offline peer up when it comes back online', async () => {
    const a = addPeer('a');
    const b = addPeer('b');
    await settle();
    network.setOnline('b', false);

    put(a, note('from-a'));
    put(b, note('from-b'));
    await settle();
    expect(b.board.getElement('from-a')).toBeUndefined();
    expect(a.board.getElement('from-b')).toBeUndefined();
    expect(network.stats('b').online).toBe(false);

    network.setOnline('b', true);
    await settle();
    expect(b.board.getElement('from-a')).toBeDefined();
    expect(a.board.getElement('from-b')).toBeDefined();
    expect(new Set(hashes()).size).toBe(1);
  });

  it('removes the presence of an offline peer and restores it on reconnect', async () => {
    const a = addPeer('a');
    const b = addPeer('b');
    a.awareness.setLocalStateField('user', { name: 'a' });
    b.awareness.setLocalStateField('user', { name: 'b' });
    await settle();
    expect(a.awareness.getStates().has(b.doc.clientID)).toBe(true);

    network.setOnline('b', false);
    expect(a.awareness.getStates().has(b.doc.clientID)).toBe(false);
    expect(b.awareness.getStates().has(a.doc.clientID)).toBe(false);

    network.setOnline('b', true);
    await settle();
    expect(a.awareness.getStates().has(b.doc.clientID)).toBe(true);
    expect(b.awareness.getStates().has(a.doc.clientID)).toBe(true);
  });

  it('holds updates and converges after a shuffled release', async () => {
    const a = addPeer('a');
    const b = addPeer('b');
    await settle();
    network.setHeld('b', true);

    // Dependent updates: create, then move twice, each its own Yjs update.
    put(a, note('n1', { x: 1 }));
    a.board.update('n1', { x: 2 });
    a.board.update('n1', { x: 3 });
    await settle();
    expect(b.board.getElement('n1')).toBeUndefined();
    expect(network.stats('b').heldCount).toBe(3);
    expect(network.idle).toBe(false);
    expect(convergence(hashes(), network.idle, true)).toBe('pending');

    // random() = 0 reverses the order.
    expect(network.release('b', { shuffle: true })).toBe(3);
    expect(b.board.getElement('n1')?.x).toBe(3);
    expect(convergence(hashes(), network.idle, true)).toBe('converged');
  });

  it('releases held updates in order when holding is turned off', async () => {
    const a = addPeer('a');
    const b = addPeer('b');
    await settle();
    network.setHeld('b', true);
    put(a, note('n1'));
    await settle();
    network.setHeld('b', false);
    expect(b.board.getElement('n1')).toBeDefined();
    expect(network.stats('b')).toMatchObject({ held: false, heldCount: 0 });
  });

  it('keeps undo per person', async () => {
    const a = addPeer('a');
    const b = addPeer('b');
    await settle();
    put(a, note('from-a'));
    put(b, note('from-b'));
    await settle();

    b.board.undo();
    await settle();
    expect(a.board.getElement('from-a')).toBeDefined();
    expect(a.board.getElement('from-b')).toBeUndefined();
    expect(b.board.getElement('from-a')).toBeDefined();
  });

  it('forgets a peer that leaves', async () => {
    const a = addPeer('a');
    addPeer('b');
    a.awareness.setLocalStateField('user', { name: 'a' });
    await settle();
    network.setLatency('a', 1000);
    put(a, note('n1'));
    network.leave('b');
    expect(network.idle).toBe(true);
    expect(() => network.stats('b')).toThrow();
    expect(() => network.setLatency('a', -1)).toThrow(RangeError);
  });

  it('notifies listeners on changes', async () => {
    addPeer('a');
    const listener = vi.fn();
    const off = network.onChange(listener);
    network.setLatency('a', 10);
    expect(listener).toHaveBeenCalled();
    off();
    listener.mockClear();
    network.setLatency('a', 20);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('BOARD-2410: convergence helpers', () => {
  it('hashes documents independently of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    );
    const doc = createBoard().getDocument();
    const reordered = { records: doc.records, meta: doc.meta, schemaVersion: doc.schemaVersion };
    expect(documentHash(reordered as typeof doc)).toBe(documentHash(doc));
    expect(documentHash({ ...doc, meta: { title: 'x' } })).not.toBe(documentHash(doc));
    expect(documentHash(doc)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('classifies the convergence state', () => {
    expect(convergence(['a', 'a'], true, true)).toBe('converged');
    expect(convergence(['a', 'b'], true, true)).toBe('diverged');
    expect(convergence(['a', 'b'], false, true)).toBe('pending');
    expect(convergence(['a', 'a'], true, false)).toBe('offline');
  });
});
