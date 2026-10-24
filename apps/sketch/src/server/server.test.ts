/**
 * The sketch server end to end: the room API over HTTP, and Hocuspocus clients joining a room
 * with its edit and view tokens.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import {
  encodeConnectionToken,
  parseConnectionToken,
  parseRoomHash,
  roomHash,
  type CreatedRoomResponse,
} from '../shared/protocol.js';
import { createSketchServer, type SketchServer } from './app.js';
import { RoomStore } from './rooms.js';

beforeAll(() => {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
});

let server: SketchServer | null = null;
const cleanups: (() => void)[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) fn();
  await server?.destroy();
  server = null;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function start(options: Parameters<typeof createSketchServer>[0] = {}): Promise<string> {
  server = createSketchServer({ port: 0, quiet: true, ...options });
  await server.listen();
  return server.httpURL;
}

async function createRoom(base: string, name = 'Retro'): Promise<CreatedRoomResponse> {
  const response = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedRoomResponse;
}

const alice = { id: 'alice-1', name: 'Alice', color: '#e11d48' };
const bob = { id: 'bob-1', name: 'Bob', color: '#2563eb' };

function join(base: string, room: string, token: string, user = alice) {
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: base.replace(/^http/, 'ws') + '/collab' });
  let failed: string | null = null;
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: room,
    document: doc,
    token: encodeConnectionToken({ token, user }),
    onAuthenticationFailed: ({ reason }) => {
      failed = reason;
    },
  });
  provider.attach();
  cleanups.push(() => {
    provider.destroy();
    socket.destroy();
    doc.destroy();
  });
  const synced = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(failed ?? 'sync timeout')), 5000);
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
    provider.on('authenticationFailed', () => {
      clearTimeout(timer);
      reject(new Error('auth'));
    });
  });
  return { doc, provider, synced };
}

/** Writes a structurally valid element record, like `@kujam/sync-yjs` does. */
function putRecord(doc: Y.Doc, id: string): void {
  const record = {
    id,
    kind: 'element',
    type: 'geo',
    pageId: 'page:main',
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rotation: 0,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
  };
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(record)) map.set(key, value);
  doc.getMap<Y.Map<unknown>>('records').set(id, map);
}

const has = (doc: Y.Doc, id: string): boolean => doc.getMap('records').has(id);

const until = async (check: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('room API', () => {
  it('creates a room and returns two different tokens once', async () => {
    const base = await start();
    const room = await createRoom(base, '  Retro\u0007 sprint  ');
    expect(room.id).toMatch(/^[a-z0-9]{12}$/);
    expect(room.name).toBe('Retro sprint');
    expect(room.editToken).not.toBe(room.viewToken);
    expect(room.editToken.length).toBeGreaterThanOrEqual(32);
  });

  it('tells the role of a token, and 404s for wrong tokens and unknown rooms alike', async () => {
    const base = await start();
    const room = await createRoom(base);
    const get = (id: string, token: string) =>
      fetch(`${base}/api/rooms/${id}`, { headers: { authorization: `Bearer ${token}` } });

    expect(await (await get(room.id, room.editToken)).json()).toEqual({
      id: room.id,
      name: 'Retro',
      role: 'edit',
    });
    expect(await (await get(room.id, room.viewToken)).json()).toMatchObject({ role: 'view' });
    expect((await get(room.id, 'nope-nope-nope-nope')).status).toBe(404);
    expect((await get('aaaaaaaaaaaa', room.editToken)).status).toBe(404);
  });

  it('rejects bad requests and limits room creation per address', async () => {
    const base = await start({ createLimit: { max: 3, windowMs: 60_000 } });
    const post = (body: string, type = 'application/json') =>
      fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': type }, body });
    expect((await post('{}', 'text/plain')).status).toBe(415);
    expect((await post('{oops')).status).toBe(400);
    expect((await post(JSON.stringify({ name: 'x'.repeat(5000) }))).status).toBe(413);
    // The limit counts every attempt, including the three rejected above.
    expect((await post('{}')).status).toBe(429);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/unknown`)).status).toBe(404);
  });

  it('answers other paths through the client handler, or 404', async () => {
    const base = await start({
      client: async (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html>page');
        return true;
      },
    });
    expect(await (await fetch(`${base}/anything`)).text()).toBe('<!doctype html>page');
    await server!.destroy();
    const plain = await start();
    expect((await fetch(`${plain}/`)).status).toBe(404);
  });
});

describe('collaboration', () => {
  it('editors share changes; viewers receive them but cannot write', async () => {
    const base = await start();
    const room = await createRoom(base);
    const a = join(base, room.id, room.editToken, alice);
    const b = join(base, room.id, room.viewToken, bob);
    await Promise.all([a.synced, b.synced]);

    putRecord(a.doc, 'x');
    await until(() => has(b.doc, 'x'));

    // The server drops updates from the read-only connection.
    putRecord(b.doc, 'y');
    const c = join(base, room.id, room.editToken, { ...alice, id: 'alice-2' });
    await c.synced;
    await new Promise((r) => setTimeout(r, 200));
    expect(has(c.doc, 'x')).toBe(true);
    expect(has(c.doc, 'y')).toBe(false);
  });

  it('refuses a wrong token, a token of another room, and a forged identity', async () => {
    const base = await start();
    const one = await createRoom(base);
    const two = await createRoom(base);
    await expect(join(base, one.id, 'wrong-token-wrong-token').synced).rejects.toThrow();
    await expect(join(base, one.id, two.editToken).synced).rejects.toThrow();
    await expect(
      join(base, one.id, one.editToken, { id: 'BAD ID', name: 'x', color: '#000000' }).synced,
    ).rejects.toThrow();
  });

  it('keeps the drawing after everyone leaves', async () => {
    const dir = mkdtempSync(joinPath(tmpdir(), 'kujam-sketch-'));
    tempDirs.push(dir);
    const path = joinPath(dir, 'sketch.sqlite');
    const base = await start({ databasePath: path });
    const room = await createRoom(base);
    const a = join(base, room.id, room.editToken);
    await a.synced;
    putRecord(a.doc, 'kept');
    await new Promise((r) => setTimeout(r, 100));
    await server!.collaboration.server.hocuspocus.flushPendingStores();
    for (const fn of cleanups.splice(0)) fn();
    await server!.destroy();

    const again = await start({ databasePath: path });
    const b = join(again, room.id, room.editToken);
    await b.synced;
    await until(() => has(b.doc, 'kept'));
  });
});

describe('protocol and storage', () => {
  it('round-trips the share fragment and the connection token', () => {
    expect(parseRoomHash(roomHash('abcdefghjkmn', 'tok_en-123456789012'))).toEqual({
      id: 'abcdefghjkmn',
      token: 'tok_en-123456789012',
    });
    expect(parseRoomHash('#room=short,token')).toBeNull();
    expect(parseRoomHash('#other')).toBeNull();
    const raw = encodeConnectionToken({ token: 't', user: { ...alice, name: ' A\u0000lice ' } });
    expect(parseConnectionToken(raw)).toEqual({ token: 't', user: alice });
    expect(
      parseConnectionToken('{"token":"t","user":{"id":"a","name":"","color":"#000000"}}'),
    ).toBeNull();
    expect(parseConnectionToken('x'.repeat(3000))).toBeNull();
  });

  it('stores only token hashes', () => {
    const store = new RoomStore();
    const room = store.create('A');
    const row = (store as unknown as { db: { prepare(s: string): { get(): unknown } } }).db
      .prepare('SELECT * FROM sketch_rooms')
      .get();
    expect(JSON.stringify(row)).not.toContain(room.editToken);
    expect(store.verify(room.id, room.viewToken)?.role).toBe('view');
    expect(store.verify(room.id, `${room.viewToken}x`)).toBeNull();
    store.close();
  });
});
