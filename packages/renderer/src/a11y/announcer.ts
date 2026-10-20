/**
 * Live region for important changes (BOARD-1903).
 *
 * Screen readers do not notice what happens on the canvas, so the renderer keeps one hidden
 * `role="status"` region per view and writes short sentences to it:
 *
 * - elements the user created or deleted (local changes, undo, and redo; never remote ones),
 * - collaborators who joined or left,
 * - the connection being lost, restored, or failing.
 *
 * Announcements are throttled: changes are collected for {@link ANNOUNCE_DELAY_MS}, merged into one
 * sentence ("3 elemen dibuat"), and written at most once per {@link ANNOUNCE_INTERVAL_MS}. Changes
 * that cancel out before they are written (an element created and deleted again, a connection
 * that drops and comes back) are not announced at all.
 */

import type { Board, ChangeEvent, PresenceUser, SyncAdapter, SyncStatus } from '@kujam/core';
import { describeElement, hideVisually } from './a11y-tree.js';
import { a11yText } from './i18n.js';

/** Time in milliseconds the live region waits for more changes before announcing them together. */
export const ANNOUNCE_DELAY_MS = 150;

/** Minimum time in milliseconds between two announcements of the live region. */
export const ANNOUNCE_INTERVAL_MS = 1000;

/** Names listed in one announcement; more become a count ("4 orang bergabung"). */
const MAX_NAMES = 3;

/** Messages from `BoardView.announce` kept per announcement; older ones are dropped. */
const MAX_CUSTOM = 3;

type ConnectionChange = 'lost' | 'restored' | 'error';

/** Options for {@link Announcer}. */
export interface AnnouncerOptions {
  /** Whether board changes are announced; `false` keeps only {@link Announcer.announce}. */
  readonly auto?: boolean;
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly now?: () => number;
}

/**
 * Throttled live region of one board view.
 *
 * @internal
 */
export class Announcer {
  /** The `role="status"` element announcements are written to. */
  readonly region: HTMLDivElement;
  private readonly created = new Map<string, string>();
  private readonly removed = new Map<string, string>();
  /** Collaborators announced as present, by peer ID, with their display name. */
  private readonly known = new Map<string, string>();
  private readonly joined = new Map<string, string>();
  private readonly left = new Map<string, string>();
  private readonly custom: string[] = [];
  private connection: ConnectionChange | null = null;
  /** Connection as last seen; `initial` until the adapter first reaches `synced` or fails. */
  private state: 'initial' | 'synced' | 'lost' | 'failed' = 'initial';
  private adapter: SyncAdapter | null = null;
  private adapterOffs: (() => void)[] = [];
  private readonly offs: (() => void)[] = [];
  private timer: unknown = null;
  private lastFlush = Number.NEGATIVE_INFINITY;
  private lastText = '';
  private disposed = false;

  constructor(
    private readonly board: Board,
    layer: HTMLElement,
    private readonly options: AnnouncerOptions = {},
  ) {
    const doc = layer.ownerDocument;
    this.region = doc.createElement('div');
    this.region.dataset.kujamA11yLive = '';
    this.region.setAttribute('role', 'status');
    this.region.setAttribute('aria-live', 'polite');
    this.region.setAttribute('aria-atomic', 'true');
    hideVisually(this.region);
    layer.append(this.region);

    if (options.auto !== false) {
      this.offs.push(
        board.on('change', (event) => this.onChange(event)),
        board.on('sync', ({ adapter }) => this.bind(adapter)),
      );
      this.bind(board.sync ?? null);
    }
  }

  /** Queues a message of the host application; it goes out with the next announcement. */
  announce(message: string): void {
    if (this.disposed) return;
    const text = message.trim();
    if (!text) return;
    this.custom.push(text);
    if (this.custom.length > MAX_CUSTOM) this.custom.shift();
    this.schedule();
  }

  /** Writes pending announcements now, ignoring the throttle. */
  flush(): void {
    this.cancel();
    if (this.disposed || this.board.disposed) return;
    const text = this.compose();
    if (!text) return;
    this.lastFlush = this.now();
    // Some screen readers skip a region whose text did not change: make a repeat differ.
    const next = text === this.lastText ? `${text}\u00a0` : text;
    this.lastText = text;
    this.region.textContent = next;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.bind(null);
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.region.remove();
  }

  // ---------- Sources ----------

  private onChange(event: ChangeEvent): void {
    if (event.origin !== 'local' && event.origin !== 'undo' && event.origin !== 'redo') return;
    let changed = false;
    for (const [id, record] of Object.entries(event.removed)) {
      if (record.kind !== 'element') continue;
      changed = true;
      if (!this.created.delete(id)) this.removed.set(id, describeElement(this.board, record).label);
    }
    for (const [id, record] of Object.entries(event.added)) {
      if (record.kind !== 'element') continue;
      changed = true;
      if (!this.removed.delete(id)) this.created.set(id, describeElement(this.board, record).label);
    }
    if (changed) this.schedule();
  }

  private bind(adapter: SyncAdapter | null): void {
    if (adapter === this.adapter) return;
    for (const off of this.adapterOffs) off();
    this.adapterOffs = [];
    this.adapter = adapter;
    // A new (or no) adapter starts over: attaching and detaching are not announced.
    this.known.clear();
    this.joined.clear();
    this.left.clear();
    this.connection = null;
    this.state = adapter?.status === 'synced' ? 'synced' : 'initial';
    if (!adapter || typeof adapter.on !== 'function') return;
    this.adapterOffs.push(
      adapter.on('status', (status) => this.onStatus(status)),
      adapter.on('peer-join', ({ peerId, user }) => this.onJoin(peerId, user)),
      adapter.on('peer-leave', ({ peerId }) => this.onLeave(peerId)),
    );
  }

  private onStatus(status: SyncStatus): void {
    let change: ConnectionChange | null = null;
    if (status === 'synced') {
      if (this.state === 'lost' || this.state === 'failed') change = 'restored';
      this.state = 'synced';
    } else if (status === 'error') {
      // A retry loop fails again and again: say it once until the connection is back.
      if (this.state !== 'failed') change = 'error';
      this.state = 'failed';
    } else if (this.state === 'synced') {
      change = 'lost';
      this.state = 'lost';
    }
    if (!change) return;
    if (
      (change === 'restored' && (this.connection === 'lost' || this.connection === 'error')) ||
      (change === 'lost' && this.connection === 'restored')
    ) {
      // Dropped and back (or the other way) before anything was said: nothing to announce.
      this.connection = null;
      return;
    }
    this.connection = change;
    this.schedule();
  }

  private onJoin(peerId: string, user: PresenceUser | undefined): void {
    // Peers reappearing after our own reconnect are not news.
    if (this.left.delete(peerId) || this.known.has(peerId)) return;
    const name = this.nameOf(user);
    this.known.set(peerId, name);
    this.joined.set(peerId, name);
    this.schedule();
  }

  private onLeave(peerId: string): void {
    if (this.joined.delete(peerId)) {
      this.known.delete(peerId);
      return;
    }
    const name = this.known.get(peerId);
    if (name === undefined) return;
    // Kept in `known` until announced: when our own connection is the cause, the leave is dropped.
    this.left.set(peerId, name);
    this.schedule();
  }

  // ---------- Output ----------

  private compose(): string {
    const { board } = this;
    const parts: string[] = [];

    const connection = this.connection;
    this.connection = null;
    if (connection === 'lost') parts.push(a11yText('connectionLost', board));
    else if (connection === 'restored') parts.push(a11yText('connectionRestored', board));
    else if (connection === 'error') parts.push(a11yText('connectionError', board));

    parts.push(
      ...this.elements(this.created, 'elementCreated', 'elementsCreated'),
      ...this.elements(this.removed, 'elementDeletedOne', 'elementDeleted'),
    );

    // Peers "leaving" because our own connection dropped stay known, so their return is silent.
    if (this.state === 'synced') {
      parts.push(...this.people(this.joined, 'peerJoined', 'peersJoined'));
      for (const id of this.left.keys()) this.known.delete(id);
      parts.push(...this.people(this.left, 'peerLeft', 'peersLeft'));
    }
    this.joined.clear();
    this.left.clear();

    parts.push(...this.custom);
    this.custom.length = 0;
    return parts.map((part) => part.replace(/[.\s]+$/, '')).join('. ');
  }

  private elements(
    pending: Map<string, string>,
    one: 'elementCreated' | 'elementDeletedOne',
    many: 'elementsCreated' | 'elementDeleted',
  ): string[] {
    const labels = [...pending.values()];
    pending.clear();
    if (labels.length === 0) return [];
    if (labels.length === 1) return [a11yText(one, this.board, { label: labels[0]! })];
    return [a11yText(many, this.board, { count: labels.length })];
  }

  private people(
    pending: Map<string, string>,
    names: 'peerJoined' | 'peerLeft',
    count: 'peersJoined' | 'peersLeft',
  ): string[] {
    const list = [...pending.values()];
    if (list.length === 0) return [];
    if (list.length > MAX_NAMES) return [a11yText(count, this.board, { count: list.length })];
    return [a11yText(names, this.board, { names: this.formatList(list) })];
  }

  private formatList(items: readonly string[]): string {
    try {
      return new Intl.ListFormat(this.board.locale, { type: 'conjunction' }).format(items);
    } catch {
      return items.join(', ');
    }
  }

  private nameOf(user: PresenceUser | undefined): string {
    const name = typeof user?.name === 'string' ? user.name.trim() : '';
    return name || a11yText('someone', this.board);
  }

  // ---------- Timing ----------

  private schedule(): void {
    if (this.disposed || this.timer !== null) return;
    const wait = Math.max(ANNOUNCE_DELAY_MS, this.lastFlush + ANNOUNCE_INTERVAL_MS - this.now());
    const win = this.region.ownerDocument.defaultView;
    const set = this.options.setTimeout ?? ((fn, ms) => win?.setTimeout(fn, ms));
    this.timer =
      set(() => {
        this.timer = null;
        this.flush();
      }, wait) ?? null;
  }

  private cancel(): void {
    if (this.timer === null) return;
    const win = this.region.ownerDocument.defaultView;
    const clear =
      this.options.clearTimeout ?? ((handle: unknown) => win?.clearTimeout(handle as number));
    clear(this.timer);
    this.timer = null;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
