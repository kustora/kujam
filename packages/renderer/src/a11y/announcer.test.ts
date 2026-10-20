// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachSync,
  createBoard,
  defineElement,
  definePlugin,
  object,
  string,
  type Board,
  type BoardLocale,
  type ElementRecord,
  type SyncAdapter,
  type SyncEventMap,
  type SyncStatus,
} from '@kujam/core';
import { ANNOUNCE_DELAY_MS, ANNOUNCE_INTERVAL_MS, Announcer } from './announcer.js';

const note = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
  a11y: (el) => ({ label: `Catatan ${el.props.text}` }),
});
const plugin = definePlugin({ id: 'announcer-test', elements: [note] });

/** Manual clock: timers run only when the test advances time. */
let time = 0;
let timers: { at: number; fn: () => void }[] = [];
function advance(ms: number): void {
  const until = time + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers[0];
    if (!next || next.at > until) break;
    timers.shift();
    time = next.at;
    next.fn();
  }
  time = until;
}

class FakeAdapter implements SyncAdapter {
  status: SyncStatus = 'connecting';
  private readonly listeners = new Map<string, Set<(data: never) => void>>();
  connect(): void {}
  disconnect(): void {}
  on<K extends keyof SyncEventMap>(event: K, listener: (data: SyncEventMap[K]) => void) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (data: never) => void);
    this.listeners.set(event, set);
    return () => set.delete(listener as (data: never) => void);
  }
  emit<K extends keyof SyncEventMap>(event: K, data: SyncEventMap[K]): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as (d: SyncEventMap[K]) => void)(data);
  }
  setStatus(status: SyncStatus): void {
    this.status = status;
    this.emit('status', status);
  }
  join(peerId: string, name: string): void {
    this.emit('peer-join', { peerId, user: { id: peerId, name, color: '#000' } });
  }
  leave(peerId: string): void {
    this.emit('peer-leave', { peerId });
  }
}

let board: Board;
let layer: HTMLDivElement;
let announcer: Announcer;

function setup(locale: BoardLocale = 'id', auto = true): void {
  board = createBoard({ plugins: [plugin], locale });
  layer = document.createElement('div');
  document.body.append(layer);
  announcer = new Announcer(board, layer, {
    auto,
    now: () => time,
    setTimeout: (fn, ms) => {
      const timer = { at: time + ms, fn };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((t) => t !== handle);
    },
  });
}

function record(id: string, text = id): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'note',
    pageId: board.pages.current,
    parentId: null,
    index: 'a1',
    x: 0,
    y: 0,
    rotation: 0,
    w: 10,
    h: 10,
    locked: false,
    opacity: 1,
    props: { text },
    meta: {},
  };
}

function add(...ids: string[]): void {
  board.transact((tx) => {
    for (const id of ids) tx.put(record(id));
  });
}

/** Text of the live region after pending announcements went out. */
function spoken(): string {
  advance(ANNOUNCE_INTERVAL_MS);
  return announcer.region.textContent ?? '';
}

beforeEach(() => {
  time = 0;
  timers = [];
});

afterEach(() => {
  announcer.dispose();
  board.dispose();
  layer.remove();
});

describe('BOARD-1903: live region', () => {
  it('is a polite, atomic status region in the layer', () => {
    setup();
    const { region } = announcer;
    expect(region.parentElement).toBe(layer);
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.dataset.kujamA11yLive).toBe('');
    announcer.dispose();
    expect(region.isConnected).toBe(false);
  });

  it('announces elements the user created or deleted, with their label', () => {
    setup();
    add('a');
    expect(spoken()).toBe('Catatan a dibuat');
    board.transact((tx) => tx.remove('a'));
    expect(spoken()).toBe('Catatan a dihapus');
  });

  it('announces undo and redo, but not remote changes or loads', () => {
    setup();
    add('a');
    spoken();
    board.undo();
    expect(spoken()).toBe('Catatan a dihapus');
    board.redo();
    expect(spoken()).toBe('Catatan a dibuat');

    board.transact((tx) => tx.put(record('remote')), { origin: 'remote' });
    board.transact((tx) => tx.put(record('loaded')), { origin: 'load' });
    advance(ANNOUNCE_INTERVAL_MS * 2);
    expect(timers).toHaveLength(0);
    expect(announcer.region.textContent).toBe('Catatan a dibuat');
  });

  it('merges a burst into one sentence and drops changes that cancel out', () => {
    setup();
    add('a', 'b');
    add('c');
    board.transact((tx) => tx.remove('c'));
    expect(spoken()).toBe('2 elemen dibuat');

    add('d');
    board.transact((tx) => {
      tx.remove('a');
      tx.remove('b');
    });
    expect(spoken()).toBe('Catatan d dibuat. 2 elemen dihapus');
  });

  it('writes at most once per interval', () => {
    setup();
    add('a');
    advance(ANNOUNCE_DELAY_MS);
    expect(announcer.region.textContent).toBe('Catatan a dibuat');

    add('b');
    advance(ANNOUNCE_DELAY_MS);
    expect(announcer.region.textContent).toBe('Catatan a dibuat');
    add('c');
    // The first announcement went out at ANNOUNCE_DELAY_MS; the next waits a full interval.
    advance(ANNOUNCE_INTERVAL_MS - ANNOUNCE_DELAY_MS - 1);
    expect(announcer.region.textContent).toBe('Catatan a dibuat');
    advance(1);
    expect(announcer.region.textContent).toBe('2 elemen dibuat');
  });

  it('makes a repeated message differ so it is read again', () => {
    setup();
    board.transact((tx) => tx.put(record('a', 'sama')));
    const first = spoken();
    board.transact((tx) => tx.put(record('b', 'sama')));
    const second = spoken();
    expect(first).toBe('Catatan sama dibuat');
    expect(second).not.toBe(first);
    expect(second.trim()).toBe(first);
  });

  it('announces collaborators joining and leaving while connected', () => {
    setup();
    const adapter = new FakeAdapter();
    attachSync(board, adapter);
    adapter.setStatus('synced');
    adapter.join('p1', 'Alice');
    expect(spoken()).toBe('Alice bergabung');

    adapter.join('p2', 'Budi');
    adapter.join('p3', '  ');
    expect(spoken()).toBe('Budi dan Seseorang bergabung');

    adapter.leave('p1');
    expect(spoken()).toBe('Alice keluar');

    for (const id of ['q1', 'q2', 'q3', 'q4']) adapter.join(id, id);
    expect(spoken()).toBe('4 orang bergabung');

    // Joining and leaving before anything was said is not news.
    adapter.join('r1', 'Rani');
    adapter.leave('r1');
    adapter.leave('unknown');
    advance(ANNOUNCE_INTERVAL_MS * 2);
    expect(announcer.region.textContent).toBe('4 orang bergabung');
  });

  it('announces the connection being lost and restored, without the peers it drops', () => {
    setup();
    const adapter = new FakeAdapter();
    attachSync(board, adapter);
    adapter.setStatus('synced');
    adapter.join('p1', 'Alice');
    spoken();

    // Our own disconnect makes every peer "leave": only the connection is announced.
    adapter.leave('p1');
    adapter.setStatus('connecting');
    expect(spoken()).toBe('Koneksi terputus');

    adapter.setStatus('synced');
    adapter.join('p1', 'Alice');
    expect(spoken()).toBe('Tersambung kembali');
  });

  it('stays silent when the connection drops and comes back before anything was said', () => {
    setup();
    const adapter = new FakeAdapter();
    attachSync(board, adapter);
    adapter.setStatus('synced');
    adapter.setStatus('connecting');
    adapter.setStatus('synced');
    advance(ANNOUNCE_INTERVAL_MS * 2);
    expect(announcer.region.textContent).toBe('');
  });

  it('announces a failing connection once per outage', () => {
    setup();
    const adapter = new FakeAdapter();
    attachSync(board, adapter);
    adapter.setStatus('error');
    expect(spoken()).toBe('Gagal tersambung');
    adapter.setStatus('connecting');
    adapter.setStatus('error');
    advance(ANNOUNCE_INTERVAL_MS * 2);
    expect(timers).toHaveLength(0);
    adapter.setStatus('synced');
    expect(spoken()).toBe('Tersambung kembali');
  });

  it('follows the adapter attached to the board, and stops after detach', () => {
    setup();
    const first = new FakeAdapter();
    const handle = attachSync(board, first);
    first.setStatus('synced');
    handle.disconnect();
    first.setStatus('connecting');
    first.join('p1', 'Alice');
    advance(ANNOUNCE_INTERVAL_MS * 2);
    expect(announcer.region.textContent).toBe('');

    const second = new FakeAdapter();
    second.status = 'synced';
    attachSync(board, second);
    second.join('p2', 'Budi');
    expect(spoken()).toBe('Budi bergabung');
  });

  it('speaks English for an English board', () => {
    setup('en');
    const adapter = new FakeAdapter();
    attachSync(board, adapter);
    adapter.setStatus('synced');
    add('a', 'b');
    adapter.join('p1', 'Alice');
    adapter.join('p2', 'Bob');
    expect(spoken()).toBe('Created 2 elements. Alice and Bob joined');
  });

  it('sends host messages through the same throttle', () => {
    setup('id', false);
    add('a');
    announcer.announce('  ');
    for (const text of ['satu', 'dua', 'tiga', 'empat.']) announcer.announce(text);
    expect(spoken()).toBe('dua. tiga. empat');

    announcer.dispose();
    announcer.announce('lima');
    expect(timers).toHaveLength(0);
  });
});
