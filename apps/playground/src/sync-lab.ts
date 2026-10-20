/**
 * Simulated network and convergence helpers for the multi-peer sync lab (BOARD-2410).
 *
 * The in-memory transport connects every peer's `Y.Doc` and `Awareness` in a full mesh inside the
 * page, without a server. Per peer it can add latency, go offline, and hold incoming document
 * updates to release them later, optionally shuffled, so out-of-order delivery can be tried.
 */

import type { BoardDocument } from '@kujam/core';
import * as Y from 'yjs';
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from 'y-protocols/awareness.js';

/** Transaction origin of everything the lab network applies, so it is never sent again. */
export const LAB_NETWORK_ORIGIN = Symbol('kujam.playground.lab-network');

/** Timer functions, injectable for tests. */
export interface LabTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LabNetworkOptions {
  timers?: LabTimers;
  /** Random number source in `[0, 1)` used to shuffle released updates. Defaults to `Math.random`. */
  random?: () => number;
}

/** Network state of one peer. */
export interface LabPeerStats {
  readonly latencyMs: number;
  readonly online: boolean;
  /** Whether incoming document updates are held back instead of applied. */
  readonly held: boolean;
  /** Number of held document updates. */
  readonly heldCount: number;
  /** Messages on their way to this peer. */
  readonly inFlight: number;
}

export interface LabNetwork {
  /** Connects a peer. Its local updates and presence are sent to every other online peer. */
  join(id: string, doc: Y.Doc, awareness: Awareness): void;
  /** Disconnects a peer and forgets its queued messages. */
  leave(id: string): void;
  /** One-way delay added to every message from and to the peer. */
  setLatency(id: string, ms: number): void;
  /**
   * Takes the peer offline (other peers see it leave) or back online. Coming back online exchanges
   * missing updates with every online peer, like a reconnect.
   */
  setOnline(id: string, online: boolean): void;
  /** Holds incoming document updates of the peer. Turning it off releases them in order. */
  setHeld(id: string, held: boolean): void;
  /** Applies the held updates of the peer, shuffled when asked. Returns how many were applied. */
  release(id: string, options?: { shuffle?: boolean }): number;
  stats(id: string): LabPeerStats;
  /** `true` when no message is in flight or held. */
  readonly idle: boolean;
  /** Called after every network state change (delivery, toggle, queue change). */
  onChange(listener: () => void): () => void;
  destroy(): void;
}

interface Message {
  readonly kind: 'update' | 'awareness';
  readonly payload: Uint8Array;
}

interface Endpoint {
  readonly id: string;
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  latencyMs: number;
  online: boolean;
  held: boolean;
  readonly heldQueue: Uint8Array[];
  inFlight: number;
  readonly timers: Set<unknown>;
  readonly detach: () => void;
}

const defaultTimers: LabTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Creates an in-page full-mesh network between `Y.Doc`s (BOARD-2410). */
export function createLabNetwork(options: LabNetworkOptions = {}): LabNetwork {
  const timers = options.timers ?? defaultTimers;
  const random = options.random ?? Math.random;
  const endpoints = new Map<string, Endpoint>();
  const listeners = new Set<() => void>();

  function changed(): void {
    for (const listener of [...listeners]) listener();
  }

  function endpoint(id: string): Endpoint {
    const ep = endpoints.get(id);
    if (!ep) throw new Error(`Peer "${id}" tidak ada di jaringan lab.`);
    return ep;
  }

  function apply(to: Endpoint, message: Message): void {
    if (message.kind === 'update') Y.applyUpdate(to.doc, message.payload, LAB_NETWORK_ORIGIN);
    else applyAwarenessUpdate(to.awareness, message.payload, LAB_NETWORK_ORIGIN);
  }

  function deliver(to: Endpoint, message: Message): void {
    // An offline peer misses the message; reconnecting exchanges the missing state.
    if (!to.online || endpoints.get(to.id) !== to) return;
    if (message.kind === 'update' && to.held) to.heldQueue.push(message.payload);
    else apply(to, message);
  }

  function send(from: Endpoint, to: Endpoint, message: Message): void {
    if (!from.online || !to.online) return;
    to.inFlight++;
    const handle = timers.setTimeout(() => {
      to.timers.delete(handle);
      to.inFlight--;
      deliver(to, message);
      changed();
    }, from.latencyMs + to.latencyMs);
    to.timers.add(handle);
  }

  function broadcast(from: Endpoint, message: Message): void {
    for (const to of endpoints.values()) if (to !== from) send(from, to, message);
    changed();
  }

  /**
   * Re-announces the peer's presence with a new clock. A plain resend is not enough: removing a
   * peer's state (on disconnect) raises its clock on the other side, so the old state would be
   * ignored. Real clients renew their state periodically for the same reason.
   */
  function renewPresence(ep: Endpoint): void {
    const state = ep.awareness.getLocalState();
    if (state !== null) ep.awareness.setLocalState(state);
  }

  /** Exchanges what each side is missing, as the Yjs sync protocol does on connect. */
  function resync(a: Endpoint, b: Endpoint): void {
    send(b, a, {
      kind: 'update',
      payload: Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)),
    });
    send(a, b, {
      kind: 'update',
      payload: Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)),
    });
    renewPresence(a);
    renewPresence(b);
  }

  function forgetPresence(a: Endpoint, b: Endpoint): void {
    removeAwarenessStates(a.awareness, [b.doc.clientID], LAB_NETWORK_ORIGIN);
    removeAwarenessStates(b.awareness, [a.doc.clientID], LAB_NETWORK_ORIGIN);
  }

  function clearQueues(ep: Endpoint): void {
    for (const handle of ep.timers) timers.clearTimeout(handle);
    ep.timers.clear();
    ep.inFlight = 0;
    ep.heldQueue.length = 0;
  }

  return {
    join(id, doc, awareness) {
      if (endpoints.has(id)) throw new Error(`Peer "${id}" sudah tergabung.`);
      const onUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === LAB_NETWORK_ORIGIN) return;
        broadcast(ep, { kind: 'update', payload: update });
      };
      const onAwareness = (
        change: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin === LAB_NETWORK_ORIGIN) return;
        const own = [...change.added, ...change.updated, ...change.removed].filter(
          (clientId) => clientId === doc.clientID,
        );
        if (own.length === 0) return;
        broadcast(ep, { kind: 'awareness', payload: encodeAwarenessUpdate(awareness, own) });
      };
      doc.on('update', onUpdate);
      awareness.on('update', onAwareness);
      const ep: Endpoint = {
        id,
        doc,
        awareness,
        latencyMs: 0,
        online: true,
        held: false,
        heldQueue: [],
        inFlight: 0,
        timers: new Set(),
        detach: () => {
          doc.off('update', onUpdate);
          awareness.off('update', onAwareness);
        },
      };
      endpoints.set(id, ep);
      for (const other of endpoints.values()) if (other !== ep) resync(ep, other);
      changed();
    },
    leave(id) {
      const ep = endpoints.get(id);
      if (!ep) return;
      ep.detach();
      clearQueues(ep);
      endpoints.delete(id);
      for (const other of endpoints.values()) forgetPresence(ep, other);
      changed();
    },
    setLatency(id, ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Latensi wajib berupa angka >= 0.');
      endpoint(id).latencyMs = ms;
      changed();
    },
    setOnline(id, online) {
      const ep = endpoint(id);
      if (ep.online === online) return;
      if (!online) {
        for (const other of endpoints.values()) if (other !== ep) forgetPresence(ep, other);
        ep.online = false;
      } else {
        ep.online = true;
        for (const other of endpoints.values()) if (other !== ep) resync(ep, other);
      }
      changed();
    },
    setHeld(id, held) {
      const ep = endpoint(id);
      ep.held = held;
      if (!held) this.release(id);
      changed();
    },
    release(id, releaseOptions = {}) {
      const ep = endpoint(id);
      const updates = ep.heldQueue.splice(0);
      if (releaseOptions.shuffle) {
        for (let i = updates.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [updates[i], updates[j]] = [updates[j]!, updates[i]!];
        }
      }
      for (const payload of updates) apply(ep, { kind: 'update', payload });
      changed();
      return updates.length;
    },
    stats(id) {
      const ep = endpoint(id);
      return {
        latencyMs: ep.latencyMs,
        online: ep.online,
        held: ep.held,
        heldCount: ep.heldQueue.length,
        inFlight: ep.inFlight,
      };
    },
    get idle() {
      for (const ep of endpoints.values())
        if (ep.inFlight > 0 || ep.heldQueue.length > 0) return false;
      return true;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      for (const id of [...endpoints.keys()]) this.leave(id);
      listeners.clear();
    },
  };
}

/** JSON with object keys sorted, so equal documents always serialize the same way. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val === null || typeof val !== 'object' || Array.isArray(val)) return val;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(val).sort()) sorted[key] = (val as Record<string, unknown>)[key];
    return sorted;
  });
}

/** Short FNV-1a hash of a board document, used as the convergence indicator. */
export function documentHash(doc: BoardDocument): string {
  const text = stableStringify(doc);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Convergence state of the peers.
 *
 * - `pending`: updates are still in flight or held, so differences are expected.
 * - `offline`: a peer is offline; it cannot converge until it reconnects.
 * - `converged`: everything was delivered and every document hash is the same.
 * - `diverged`: everything was delivered but the hashes differ (a bug).
 */
export type Convergence = 'pending' | 'offline' | 'converged' | 'diverged';

export function convergence(
  hashes: readonly string[],
  settled: boolean,
  allOnline: boolean,
): Convergence {
  if (!allOnline) return 'offline';
  if (!settled) return 'pending';
  return new Set(hashes).size <= 1 ? 'converged' : 'diverged';
}

/** Latency control shared by the sockets of one peer in the Hocuspocus transport. */
export interface DelayedSocketControl {
  /** One-way delay for messages in both directions. */
  latencyMs: number;
  /** Messages waiting for their delay, in both directions. */
  readonly inFlight: number;
  /** Called whenever `inFlight` changes. */
  onChange?: () => void;
}

/**
 * `WebSocket` subclass that delays every sent and received message by `control.latencyMs`, for
 * the provider's `WebSocketPolyfill` option. Messages keep their order even when the latency
 * changes, because each one waits at least until the previous one in the same direction.
 */
export function createDelayedWebSocket(
  control: DelayedSocketControl,
  timers: LabTimers = defaultTimers,
): typeof WebSocket {
  let inFlight = 0;
  Object.defineProperty(control, 'inFlight', { get: () => inFlight, configurable: true });

  function schedule(last: { at: number }, run: () => void): void {
    const at = Math.max(Date.now() + control.latencyMs, last.at);
    last.at = at;
    inFlight++;
    control.onChange?.();
    timers.setTimeout(() => {
      inFlight--;
      run();
      control.onChange?.();
    }, at - Date.now());
  }

  return class DelayedWebSocket extends WebSocket {
    private readonly lastSend = { at: 0 };
    private readonly lastReceive = { at: 0 };
    private readonly wrapped = new Map<unknown, EventListener>();

    override send(data: Parameters<WebSocket['send']>[0]): void {
      schedule(this.lastSend, () => {
        if (this.readyState === WebSocket.OPEN) super.send(data);
      });
    }

    override addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (!listener) return;
      if (type !== 'message') {
        super.addEventListener(type, listener, options);
        return;
      }
      const handle =
        typeof listener === 'function' ? listener : listener.handleEvent.bind(listener);
      const delayed: EventListener = (event) =>
        schedule(this.lastReceive, () => handle.call(this, event));
      this.wrapped.set(listener, delayed);
      super.addEventListener(type, delayed, options);
    }

    override removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ): void {
      if (!listener) return;
      const delayed = type === 'message' ? this.wrapped.get(listener) : undefined;
      if (delayed) this.wrapped.delete(listener);
      super.removeEventListener(type, delayed ?? listener, options);
    }
  };
}
