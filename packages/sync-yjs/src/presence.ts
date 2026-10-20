/**
 * Real-time presence awareness implementation via Yjs Awareness (BOARD-1504).
 *
 * @packageDocumentation
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import type {
  PresenceApi,
  PresenceLiveStroke,
  PresencePeerState,
  PresenceUser,
  Unsubscribe,
} from '@kujam/core';
import {
  DEFAULT_PRESENCE_LIMITS,
  sanitizePresenceState,
  type PresenceLimits,
} from './presence-validation.js';

/**
 * Ephemeral active freehand stroke data transmitted via Yjs Awareness (BOARD-1505).
 *
 * @public
 */
export type LiveStroke = PresenceLiveStroke;

/**
 * Configuration options for Yjs awareness presence (BOARD-1504, BOARD-1505).
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

  /**
   * Active live stroke throttling duration in milliseconds (default ~30 Hz / 33ms) (BOARD-1505).
   *
   * @defaultValue 33
   */
  strokeThrottleMs?: number;

  /**
   * Bounds for presence states received from peers (BOARD-2009). Every peer state is validated
   * per field; see {@link DEFAULT_PRESENCE_LIMITS} for the defaults.
   */
  limits?: Partial<PresenceLimits>;
}

/**
 * Yjs presence awareness API contract (BOARD-1504, BOARD-1505).
 *
 * Extends {@link PresenceApi} with direct Awareness access, throttled cursor updates,
 * ephemeral live freehand stroke broadcasting, and cleanup.
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
   * Updates the local active live stroke in awareness with throttling (default ~30 Hz / 33ms) (BOARD-1505).
   * When null is provided (stroke finished or cancelled), awareness is updated immediately without throttling.
   *
   * @param stroke - Ephemeral live stroke or null to clear.
   */
  setLiveStroke(stroke: PresenceLiveStroke | null): void;

  /**
   * Returns active live strokes of all remote peers (BOARD-1505).
   * Optionally accepts a predicate to suppress strokes that have already transitioned
   * to permanent elements (deduplication).
   *
   * @param isElementCommitted - Function returning true if element with given ID already exists in the local board.
   */
  getLiveStrokes(
    isElementCommitted?: (id: string) => boolean,
  ): ReadonlyMap<string, PresenceLiveStroke>;

  /**
   * Cleans up awareness event listeners and cancels pending throttling timers.
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
  const strokeThrottleMs = options.strokeThrottleMs ?? 33;
  let destroyed = false;

  const peers = new Map<string, PresencePeerState>();
  const clientToPeerId = new Map<number, string>();
  const clientToState = new Map<number, PresencePeerState>();

  const listeners = new Map<PresenceEventType, Set<PresenceListener>>();

  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCursorFlush = 0;
  let pendingCursor: { x: number; y: number } | null | undefined = undefined;

  let strokeThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastStrokeFlush = 0;
  let pendingStroke: PresenceLiveStroke | null | undefined = undefined;

  function emitPresence(event: PresenceEventType, peerId: string, state?: PresencePeerState): void {
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

  // Peer states are validated and capped before anything reads them (BOARD-2009).
  const limits: PresenceLimits = { ...DEFAULT_PRESENCE_LIMITS, ...options.limits };
  const sanitized = new WeakMap<Record<string, unknown>, PresencePeerState>();

  function peerStateOf(raw: Record<string, unknown>, clientId: number): PresencePeerState {
    let state = sanitized.get(raw);
    if (!state) {
      state = sanitizePresenceState(raw, String(clientId), limits);
      sanitized.set(raw, state);
    }
    return state;
  }

  function resolvePeerId(raw: Record<string, unknown>, clientId: number): string {
    return peerStateOf(raw, clientId).user.id;
  }

  function toPresencePeerState(
    raw: Record<string, unknown>,
    _peerId: string,
    clientId: number,
  ): PresencePeerState {
    return peerStateOf(raw, clientId);
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

  function flushLiveStroke(): void {
    if (destroyed || pendingStroke === undefined) return;
    const strokeToSet = pendingStroke;
    pendingStroke = undefined;
    lastStrokeFlush = Date.now();
    const current = (awareness.getLocalState() as Partial<PresencePeerState> | null) ?? {};
    awareness.setLocalState({
      ...current,
      activeStroke: strokeToSet,
    });
  }

  function setLiveStroke(stroke: PresenceLiveStroke | null): void {
    if (destroyed) return;

    if (stroke === null) {
      if (strokeThrottleTimer) {
        clearTimeout(strokeThrottleTimer);
        strokeThrottleTimer = null;
      }
      pendingStroke = null;
      flushLiveStroke();
      return;
    }

    pendingStroke = stroke;
    const now = Date.now();
    const elapsed = now - lastStrokeFlush;

    if (strokeThrottleMs <= 0 || (elapsed >= strokeThrottleMs && !strokeThrottleTimer)) {
      flushLiveStroke();
    } else if (!strokeThrottleTimer) {
      const remaining = Math.max(0, strokeThrottleMs - elapsed);
      strokeThrottleTimer = setTimeout(() => {
        strokeThrottleTimer = null;
        flushLiveStroke();
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
      const { cursor, activeStroke, ...rest } = patch;

      if (cursor !== undefined) {
        setCursor(cursor);
      }

      if (activeStroke !== undefined) {
        setLiveStroke(activeStroke);
      }

      if (Object.keys(rest).length > 0) {
        const next: Partial<PresencePeerState> = {
          ...current,
          ...(pendingCursor !== undefined ? { cursor: pendingCursor } : {}),
          ...(pendingStroke !== undefined ? { activeStroke: pendingStroke } : {}),
          ...rest,
          ...(rest.user && current.user ? { user: { ...current.user, ...rest.user } } : {}),
        };
        awareness.setLocalState(next);
      }
    },

    getLocalState(): Partial<PresencePeerState> | undefined {
      const state = awareness.getLocalState() as Partial<PresencePeerState> | null;
      if (!state) return undefined;
      const result: Partial<PresencePeerState> = { ...state };
      if (pendingCursor !== undefined) {
        result.cursor = pendingCursor;
      }
      if (pendingStroke !== undefined) {
        result.activeStroke = pendingStroke;
      }
      return result;
    },

    setCursor,
    setLiveStroke,

    getLiveStrokes(
      isElementCommitted?: (id: string) => boolean,
    ): ReadonlyMap<string, PresenceLiveStroke> {
      const liveStrokes = new Map<string, PresenceLiveStroke>();
      for (const [peerId, peerState] of peers.entries()) {
        const stroke = peerState.activeStroke;
        if (!stroke || !stroke.points || stroke.points.length === 0) continue;
        if (stroke.id && isElementCommitted && isElementCommitted(stroke.id)) {
          // Suppress stroke that has already transitioned to a permanent document element
          continue;
        }
        liveStrokes.set(peerId, stroke);
      }
      return liveStrokes;
    },

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
      if (strokeThrottleTimer) {
        clearTimeout(strokeThrottleTimer);
        strokeThrottleTimer = null;
      }
      pendingCursor = undefined;
      pendingStroke = undefined;
      awareness.off('change', changeHandler);
      listeners.clear();
      peers.clear();
      clientToPeerId.clear();
      clientToState.clear();
    },
  };

  return presence;
}
