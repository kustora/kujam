/**
 * Tests for the server-side guards against hostile clients (BOARD-2009, BOARD-2010).
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { ElementRecord } from '@kujam/core';
import { createCollaborationServer, type CollaborationServer } from './server.js';
import { createGuards, GuardError } from './guards.js';

beforeAll(() => {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
});

function record(id: string, x = 10): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'note',
    pageId: 'page:default',
    parentId: null,
    index: 'a0',
    x,
    y: 20,
    w: 100,
    h: 80,
    rotation: 0,
    locked: false,
    opacity: 1,
    props: { text: id },
    meta: {},
  };
}

function put(doc: Y.Doc, rec: object): void {
  const map = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(rec)) map.set(k, v);
  doc.getMap<Y.Map<unknown>>('records').set((rec as { id: string }).id, map);
}

function waitForSync(provider: HocuspocusProvider): Promise<void> {
  if (provider.isSynced) return Promise.resolve();
  return new Promise((resolve) => provider.on('synced', () => resolve()));
}

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

let port = 19880;
let server: CollaborationServer | null = null;
const providers: HocuspocusProvider[] = [];

async function start(options: Parameters<typeof createCollaborationServer>[0] = {}) {
  server = createCollaborationServer({ port: ++port, quiet: true, ...options });
  await server.listen();
  return server;
}

async function connect(name: string, token: string) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: server!.webSocketURL,
    name,
    document: doc,
    token,
  });
  providers.push(provider);
  await waitForSync(provider);
  return { doc, provider };
}

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await server?.destroy();
  server = null;
});

describe('BOARD-2010: the server keeps documents valid', () => {
  it('puts an invalid edit back to the last valid value for every client', async () => {
    await start();
    const a = await connect('repair-1', 'editor');
    const b = await connect('repair-1', 'editor');
    put(a.doc, record('el1'));
    const xOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('records').get('el1')?.get('x');
    await waitFor(() => xOf(b.doc) === 10);

    // A hostile or buggy client writes a non-number coordinate.
    a.doc.getMap<Y.Map<unknown>>('records').get('el1')!.set('x', 'oops');
    await waitFor(() => xOf(a.doc) === 10 && xOf(b.doc) === 10);
  });

  it('removes a new invalid record and elements past maxElements', async () => {
    await start({ validationLimits: { limits: { maxElements: 2 } } });
    const a = await connect('repair-2', 'editor');
    const b = await connect('repair-2', 'editor');
    const ids = (doc: Y.Doc) => [...doc.getMap('records').keys()].sort();

    put(a.doc, { id: 'broken', kind: 'element', type: 'note' });
    put(a.doc, record('el1'));
    put(a.doc, record('el2'));
    await waitFor(() => ids(b.doc).join() === 'el1,el2' && ids(a.doc).join() === 'el1,el2');

    put(a.doc, record('el3'));
    await waitFor(() => ids(b.doc).join() === 'el1,el2' && ids(a.doc).join() === 'el1,el2');
  });
});

describe('BOARD-2009: awareness carries the authenticated identity', () => {
  it('replaces a spoofed user with the identity from onAuthenticate', async () => {
    await start();
    const alice = await connect('presence-1', 'mock:alice:editor:Alice');
    const bob = await connect('presence-1', 'mock:bob:editor:Bob');

    alice.provider.awareness!.setLocalState({
      user: { id: 'bob', name: 'Bob (CEO)', color: '#e11d48' },
      cursor: { x: 1, y: 2 },
    });
    const seen = () =>
      bob.provider.awareness!.getStates().get(alice.doc.clientID) as
        { user?: { id: string; name: string; color: string }; cursor?: unknown } | undefined;
    await waitFor(() => seen()?.cursor !== undefined);
    expect(seen()?.user).toEqual({ id: 'alice', name: 'Alice', color: '#e11d48' });
  });

  it('drops awareness states and removals for client IDs owned by another connection', () => {
    const guards = createGuards();
    const ctx = (id: string) => ({ user: { id, name: id }, readOnly: false });
    guards.guardAwareness(
      'doc',
      'socket-a',
      ctx('alice'),
      new Map([[1, { cursor: null }]]),
      new Set(),
    );

    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { id: 'alice' }, cursor: { x: 9, y: 9 } }],
      [2, { cursor: null }],
    ]);
    const removed = new Set([1]);
    guards.guardAwareness('doc', 'socket-b', ctx('mallory'), states, removed);
    expect([...states.keys()]).toEqual([2]);
    expect(states.get(2)!.user).toEqual({ id: 'mallory', name: 'mallory', color: '#888888' });
    expect(removed.size).toBe(0);

    // Once socket A leaves, its client ID is free again.
    guards.releaseSocket('socket-a');
    const again = new Map<number, Record<string, unknown>>([[1, { cursor: null }]]);
    guards.guardAwareness('doc', 'socket-b', ctx('mallory'), again, new Set());
    expect(again.has(1)).toBe(true);
  });
});

describe('BOARD-2010: message limits', () => {
  it('rejects oversized messages and too many messages per window', () => {
    let t = 0;
    const guards = createGuards({
      limits: { maxMessageBytes: 100, maxMessagesPerWindow: 3, rateWindowMs: 1000 },
      now: () => t,
    });
    expect(() => guards.checkMessage('s', 101)).toThrow(GuardError);
    for (let i = 0; i < 3; i++) guards.checkMessage('s', 10);
    expect(() => guards.checkMessage('s', 10)).toThrow(/messages in 1000 ms/);
    // Other connections and the next window are unaffected.
    guards.checkMessage('other', 10);
    t = 1000;
    guards.checkMessage('s', 10);
  });

  it('refuses mock authentication in production', () => {
    expect(() =>
      createCollaborationServer({ port: ++port, quiet: true, allowMockTokens: false }),
    ).toThrow(/Mock authentication is disabled/);
    expect(() =>
      createCollaborationServer({
        port: ++port,
        quiet: true,
        allowMockTokens: false,
        auth: { authEndpointUrl: 'https://auth.example/verify' },
      }).destroy(),
    ).not.toThrow();
  });
});
