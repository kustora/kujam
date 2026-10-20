/**
 * Real-time presence awareness implementation via Yjs Awareness (BOARD-1504).
 *
 * @packageDocumentation
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import type { PresenceApi, PresencePeerState, PresenceUser, Unsubscribe } from '@kujam/core';

/**
 * Configuration options for Yjs awareness presence (BOARD-1504).
 *
 * @public
 */
export interface YjsPresenceOptions {
  /**
   * Existing Awareness instance. If omitted, a fresh Awareness instance will be created.
   */
  awareness?: Awareness;

  /**
   * Initial local user identity and appearance metadata.
   */
  user?: PresenceUser;

  /**
   * Cursor position throttling duration in milliseconds (default ~30 Hz / 33ms).
   *
   * @defaultValue 33
   */
  cursorThrottleMs?: number;
}

/**
 * Yjs presence awareness API contract (BOARD-1504).
 *
 * Extends {@link PresenceApi} with direct Awareness access, throttled cursor updates, and cleanup.
 *
 * @public
 */
export interface YjsPresence extends PresenceApi {
  /** Underlying Yjs Awareness instance. */
  readonly awareness: Awareness;

  /**
   * Updates the local cursor coordinate in board coordinates with throttling (default ~30 Hz / 33ms).
   * Pass null when pointer leaves the canvas or is deactivated.
   *
   * @param cursor - Board coordinates { x, y } or null.
   */
  setCursor(cursor: { x: number; y: number } | null): void;

  /**
   * Cleans up awareness event listeners and cancels pending cursor throttling timers.
   */
  destroy(): void;
}

type PresenceEventType = 'change' | 'peer-join' | 'peer-leave';
type PresenceListener = (peerId: string, state?: PresencePeerState) => void;

/**
 * Creates a Yjs-based presence awareness manager (BOARD-1504).
 *
 * Tracks remote collaborator states (cursors, selections, cameras, users) and throttles local cursor broadcasts.
 *
 * @param options - Configuration options for Yjs presence awareness.
 * @returns YjsPresence instance.
 *
 * @public
 */
export function createYjsPresence(options: YjsPresenceOptions = {}): YjsPresence {
  const awareness = options.awareness ?? new Awareness(new Y.Doc());
  const cursorThrottleMs = options.cursorThrottleMs ?? 33;
  let destroyed = false;

  const peers = new Map<string, PresencePeerState>();
  const clientToPeerId = new Map<number, string>();
  const clientToState = new Map<number, PresencePeerState>();

  const listeners = new Map<PresenceEventType, Set<PresenceListener>>();

  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCursorFlush = 0;
  let pendingCursor: { x: number; y: number } | null | undefined = undefined;

  function emitPresence(
    event: PresenceEventType,
    peerId: string,
    state?: PresencePeerState,
  ): void {
    const set = listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        listener(peerId, state);
      } catch {
        // Suppress listener exceptions to preserve event propagation
      }
    }
  }

  function resolvePeerId(raw: Record<string, unknown>, clientId: number): string {
    const user = raw.user as PresenceUser | undefined;
    if (user?.id != null && String(user.id).trim().length > 0) {
      return String(user.id);
    }
    return String(clientId);
  }

  function toPresencePeerState(
    raw: Record<string, unknown>,
    peerId: string,
    clientId: number,
  ): PresencePeerState {
    const user = (raw.user as PresenceUser | undefined) ?? {
      id: peerId,
      name: `User ${clientId}`,
      color: '#888888',
    };
    return {
      ...raw,
      user,
    } as PresencePeerState;
  }

  // Populate initial peers from existing awareness state if any
  for (const [clientId, raw] of awareness.getStates().entries()) {
    if (clientId === awareness.clientID) continue;
    if (raw && Object.keys(raw).length > 0) {
      const peerId = resolvePeerId(raw, clientId);
      const peerState = toPresencePeerState(raw, peerId, clientId);
      peers.set(peerId, peerState);
      clientToPeerId.set(clientId, peerId);
      clientToState.set(clientId, peerState);
    }
  }

  // Handle awareness state updates
  const changeHandler = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    if (destroyed) return;

    for (const clientId of added) {
      if (clientId === awareness.clientID) continue;
      const raw = awareness.getStates().get(clientId);
      if (!raw || Object.keys(raw).length === 0) {
        continue;
      }
      const peerId = resolvePeerId(raw, clientId);
      const peerState = toPresencePeerState(raw, peerId, clientId);
      peers.set(peerId, peerState);
      clientToPeerId.set(clientId, peerId);
      clientToState.set(clientId, peerState);
      emitPresence('peer-join', peerId, peerState);
    }

    for (const clientId of updated) {
      if (clientId === awareness.clientID) continue;
      const raw = awareness.getStates().get(clientId);
      if (!raw || Object.keys(raw).length === 0) {
        if (clientToState.has(clientId)) {
          const oldState = clientToState.get(clientId);
          const peerId = clientToPeerId.get(clientId) ?? String(clientId);
          peers.delete(peerId);
          clientToState.delete(clientId);
          clientToPeerId.delete(clientId);
          emitPresence('peer-leave', peerId, oldState);
        }
        continue;
      }

      const peerId = resolvePeerId(raw, clientId);
      const peerState = toPresencePeerState(raw, peerId, clientId);
      const prevPeerId = clientToPeerId.get(clientId);
      const isNew = !clientToState.has(clientId);

      if (prevPeerId && prevPeerId !== peerId) {
        peers.delete(prevPeerId);
      }
      peers.set(peerId, peerState);
      clientToPeerId.set(clientId, peerId);
      clientToState.set(clientId, peerState);

      if (isNew) {
        emitPresence('peer-join', peerId, peerState);
      } else {
        emitPresence('change', peerId, peerState);
      }
    }

    for (const clientId of removed) {
      if (clientId === awareness.clientID) continue;
      const peerId = clientToPeerId.get(clientId) ?? String(clientId);
      const oldState = clientToState.get(clientId);
      clientToPeerId.delete(clientId);
      clientToState.delete(clientId);
      peers.delete(peerId);
      emitPresence('peer-leave', peerId, oldState);
    }
  };

  awareness.on('change', changeHandler);

  function flushCursor(): void {
    if (destroyed || pendingCursor === undefined) return;
    const cursorToSet = pendingCursor;
    pendingCursor = undefined;
    lastCursorFlush = Date.now();
    const current = (awareness.getLocalState() as Partial<PresencePeerState> | null) ?? {};
    awareness.setLocalState({
      ...current,
      cursor: cursorToSet,
    });
  }

  function setCursor(cursor: { x: number; y: number } | null): void {
    if (destroyed) return;
    pendingCursor = cursor;
    const now = Date.now();
    const elapsed = now - lastCursorFlush;

    if (cursorThrottleMs <= 0 || (elapsed >= cursorThrottleMs && !throttleTimer)) {
      flushCursor();
    } else if (!throttleTimer) {
      const remaining = Math.max(0, cursorThrottleMs - elapsed);
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        flushCursor();
      }, remaining);
    }
  }

  // Initialize local user if provided
  if (options.user) {
    const current = (awareness.getLocalState() as Partial<PresencePeerState> | null) ?? {};
    awareness.setLocalState({
      ...current,
      user: options.user,
    });
  }

  const presence: YjsPresence = {
    get awareness(): Awareness {
      return awareness;
    },

    get peers(): ReadonlyMap<string, PresencePeerState> {
      return peers;
    },

    setLocalState(patch: Partial<PresencePeerState>): void {
      if (destroyed) return;
      const current = (awareness.getLocalState() as Partial<PresencePeerState> | null) ?? {};
      const { cursor, ...rest } = patch;

      if (cursor !== undefined) {
        setCursor(cursor);
      }

      if (Object.keys(rest).length > 0) {
        const next: Partial<PresencePeerState> = {
          ...current,
          ...(pendingCursor !== undefined ? { cursor: pendingCursor } : {}),
          ...rest,
          ...(rest.user && current.user ? { user: { ...current.user, ...rest.user } } : {}),
        };
        awareness.setLocalState(next);
      }
    },

    getLocalState(): Partial<PresencePeerState> | undefined {
      const state = awareness.getLocalState() as Partial<PresencePeerState> | null;
      if (!state) return undefined;
      if (pendingCursor !== undefined) {
        return { ...state, cursor: pendingCursor };
      }
      return { ...state };
    },

    setCursor,

    on(
      event: PresenceEventType,
      listener: (peerId: string, state?: PresencePeerState) => void,
    ): Unsubscribe {
      if (typeof listener !== 'function') {
        throw new TypeError('Presence listener must be a function.');
      }
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
        if (set && set.size === 0) {
          listeners.delete(event);
        }
      };
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      pendingCursor = undefined;
      awareness.off('change', changeHandler);
      listeners.clear();
      peers.clear();
      clientToPeerId.clear();
      clientToState.clear();
    },
  };

  return presence;
}
