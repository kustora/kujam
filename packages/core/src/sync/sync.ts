/**
 * Synchronization adapter contracts, presence APIs, and in-memory sync adapter (BOARD-1501).
 *
 * @packageDocumentation
 */

import type { Board } from '../index.js';
import { createEmitter, reportUnhandled, type Unsubscribe } from '../events/events.js';
import type { RecordsDiff } from '../document/store.js';
import type { HistoryStep } from '../history/history.js';
import { createId } from '../utils/ids.js';

/**
 * Connection status of a sync adapter.
 *
 * - `offline`: not connected to synchronization backend or bus.
 * - `connecting`: in the process of establishing connection and syncing initial state.
 * - `synced`: connection established and changes synchronized.
 * - `error`: encountered an unrecoverable synchronization error.
 *
 * @public
 */
export type SyncStatus = 'offline' | 'connecting' | 'synced' | 'error';

/**
 * User identity and presentation metadata for presence awareness.
 *
 * @public
 */
export interface PresenceUser {
  /** Unique user identifier. */
  id: string;
  /** Display name shown on collaborator labels and cursor tags. */
  name: string;
  /** Hex color or CSS color string for collaborator cursor, selection, and badges. */
  color: string;
  /** Optional URL or data URI for the collaborator's avatar. */
  avatar?: string;
}

/**
 * Ephemeral active freehand stroke data transmitted via presence awareness (BOARD-1505).
 *
 * @public
 */
export interface PresenceLiveStroke {
  /**
   * Unique stroke identifier or pre-allocated element ID.
   * Used for deduplication when transitioning to a permanent element.
   */
  readonly id?: string;
  /** Sequence of stroke points: `[x, y, pressure?]`. */
  readonly points: readonly (readonly number[])[];
  /** Stroke color (hex or CSS color string). */
  readonly color: string;
  /** Stroke thickness in board coordinates. */
  readonly thickness: number;
  /** Brush identifier (e.g. 'pen', 'highlighter'). Defaults to 'pen'. */
  readonly brush?: string;
}

/**
 * Real-time presence state of a remote peer.
 *
 * @public
 */
export interface PresencePeerState {
  /** User identity and presentation metadata. */
  user: PresenceUser;
  /** Current pointer/cursor coordinates in board space, or null when outside the canvas. */
  cursor?: { x: number; y: number } | null;
  /** IDs of elements currently selected by this collaborator. */
  selection?: readonly string[];
  /** Current camera position, zoom level, and optional viewport size of this collaborator. */
  camera?: { x: number; y: number; zoom: number; viewport?: { width: number; height: number } };
  /** Currently active tool ID used by this collaborator. */
  tool?: string;
  /** Ephemeral active freehand stroke being drawn by this collaborator (BOARD-1505). */
  activeStroke?: PresenceLiveStroke | null;
  /** Extensible peer metadata. */
  [key: string]: unknown;
}

/**
 * Presence awareness API exposed by a {@link SyncAdapter}.
 *
 * @public
 */
export interface PresenceApi {
  /** Map of active remote collaborator states keyed by peer ID. */
  readonly peers: ReadonlyMap<string, PresencePeerState>;

  /**
   * Updates local presence attributes (cursor, selection, camera, etc.) and broadcasts
   * the update to remote peers.
   *
   * @param patch - Partial presence state to merge with local state.
   */
  setLocalState(patch: Partial<PresencePeerState>): void;

  /**
   * Returns the current local presence state, or undefined if not set.
   */
  getLocalState(): Partial<PresencePeerState> | undefined;

  /**
   * Subscribes to presence changes.
   *
   * @param event - Event type: `'change'`, `'peer-join'`, or `'peer-leave'`.
   * @param listener - Callback receiving the peer ID and state.
   * @returns Unsubscribe function.
   */
  on(
    event: 'change' | 'peer-join' | 'peer-leave',
    listener: (peerId: string, state?: PresencePeerState) => void,
  ): () => void;
}

/**
 * External undo/redo history API contract (BOARD-1501).
 *
 * When an adapter provides a `history` implementation, the board delegates its
 * undo, redo, and canUndo/canRedo state to this instance.
 *
 * @public
 */
export interface HistoryApi {
  /** Whether there is a step that can be undone. */
  readonly canUndo: boolean;
  /** Whether there is a step that can be redone. */
  readonly canRedo: boolean;
  /** Reverses the most recent undo step. Returns true if changes were applied. */
  undo(): boolean;
  /** Reapplies the most recently undone step. Returns true if changes were applied. */
  redo(): boolean;
  /** Clears the history stacks. */
  clear(): void;
  /**
   * Optional batch execution to fold multiple local transactions into a single undo step.
   */
  batch?<T>(key: string, fn: () => T): T;
  /** Optional inspection view of the undo stack. */
  readonly undoStack?: readonly HistoryStep[];
  /** Optional inspection view of the redo stack. */
  readonly redoStack?: readonly HistoryStep[];
  /** Optional change listener notified when `canUndo` or `canRedo` changes. */
  on?(
    event: 'change',
    listener: (state: { canUndo: boolean; canRedo: boolean }) => void,
  ): () => void;
}

/**
 * Event map for events emitted by a {@link SyncAdapter}.
 *
 * @public
 */
export interface SyncEventMap {
  /** Emitted whenever the adapter connection status transitions. */
  status: SyncStatus;
  /** Emitted when a collaborator connects or announces presence. */
  'peer-join': { peerId: string; user: PresenceUser };
  /** Emitted when a collaborator disconnects. */
  'peer-leave': { peerId: string; user?: PresenceUser };
  /** Emitted when a synchronization error occurs. */
  error: Error | unknown;
}

/**
 * Whiteboard synchronization adapter interface (BOARD-1501).
 *
 * Connects a board to real-time sync providers (such as Yjs, Liveblocks, or in-memory bus).
 *
 * @public
 */
export interface SyncAdapter {
  /** Current connection status. */
  readonly status: SyncStatus;

  /**
   * Connects the adapter to the specified board.
   *
   * @param board - Board instance to synchronize.
   */
  connect(board: Board): Promise<void> | void;

  /**
   * Disconnects the adapter from the board and stops syncing.
   */
  disconnect(): void;

  /** Optional presence awareness API. */
  readonly presence?: PresenceApi;

  /** Optional history API for delegating undo/redo. */
  readonly history?: HistoryApi;

  /**
   * Subscribes to synchronization events.
   *
   * @param event - Event name from {@link SyncEventMap}.
   * @param listener - Callback receiving the event payload.
   * @returns Unsubscribe function.
   */
  on<K extends keyof SyncEventMap>(event: K, listener: (data: SyncEventMap[K]) => void): () => void;
}

/**
 * Handle returned by {@link attachSync}.
 *
 * @public
 */
export interface SyncAttachment {
  /** The attached synchronization adapter. */
  readonly adapter: SyncAdapter;

  /** Detaches and disconnects the adapter from the board. */
  disconnect(): void;
}

/**
 * Internal symbol used to register and detach external history delegates on a Board.
 *
 * @internal
 */
export const BOARD_SYNC_HISTORY_DELEGATE = Symbol.for('kujam.board.syncHistoryDelegate');

/**
 * Internal interface on Board for sync history delegation.
 *
 * @internal
 */
export interface BoardSyncHistoryDelegateHook {
  setHistoryDelegate(delegate: HistoryApi | null): () => void;
  getHistoryDelegate(): HistoryApi | null;
}

/**
 * Internal symbol used to register and detach external presence delegates on a Board.
 *
 * @internal
 */
export const BOARD_SYNC_PRESENCE_DELEGATE = Symbol.for('kujam.board.syncPresenceDelegate');

/**
 * Internal interface on Board for sync presence delegation.
 *
 * @internal
 */
export interface BoardSyncPresenceDelegateHook {
  setPresenceDelegate(delegate: PresenceApi | null): () => void;
  getPresenceDelegate(): PresenceApi | null;
}

/**
 * Attaches a sync adapter to a board, establishing synchronization and delegating history
 * if supported by the adapter.
 *
 * @param board - Board instance to attach.
 * @param adapter - Sync adapter to connect.
 * @returns Handle to disconnect and detach the sync adapter.
 *
 * @public
 */
export function attachSync(board: Board, adapter: SyncAdapter): SyncAttachment {
  let detached = false;

  const hook = (
    board as unknown as { [BOARD_SYNC_HISTORY_DELEGATE]?: BoardSyncHistoryDelegateHook }
  )[BOARD_SYNC_HISTORY_DELEGATE];

  let unregisterDelegate: (() => void) | undefined;
  if (adapter.history && hook) {
    unregisterDelegate = hook.setHistoryDelegate(adapter.history);
  }

  const presenceHook = (
    board as unknown as { [BOARD_SYNC_PRESENCE_DELEGATE]?: BoardSyncPresenceDelegateHook }
  )[BOARD_SYNC_PRESENCE_DELEGATE];

  let unregisterPresenceDelegate: (() => void) | undefined;
  if (adapter.presence && presenceHook) {
    unregisterPresenceDelegate = presenceHook.setPresenceDelegate(adapter.presence);
  }

  const connectResult = adapter.connect(board);
  if (connectResult && typeof (connectResult as Promise<void>).then === 'function') {
    (connectResult as Promise<void>).catch((err) => {
      reportUnhandled('[kujam/sync] Error in adapter.connect()', err);
    });
  }

  const unlistenDispose = board.on('dispose', () => {
    disconnect();
  });

  function disconnect(): void {
    if (detached) return;
    detached = true;
    unlistenDispose();
    if (unregisterDelegate) {
      unregisterDelegate();
      unregisterDelegate = undefined;
    } else if (adapter.history && hook) {
      hook.setHistoryDelegate(null);
    }
    if (unregisterPresenceDelegate) {
      unregisterPresenceDelegate();
      unregisterPresenceDelegate = undefined;
    } else if (adapter.presence && presenceHook) {
      presenceHook.setPresenceDelegate(null);
    }
    adapter.disconnect();
  }

  return {
    adapter,
    disconnect,
  };
}

/**
 * In-memory message bus for exchanging sync updates and presence events across adapters.
 *
 * @public
 */
export interface MemorySyncBus {
  /**
   * Publishes a message to all subscribers of the specified channel.
   *
   * @param channel - Target channel identifier.
   * @param message - Message payload to broadcast.
   */
  publish(channel: string, message: unknown): void;

  /**
   * Subscribes a listener to messages broadcast on the specified channel.
   *
   * @param channel - Target channel identifier.
   * @param listener - Callback receiving published messages.
   * @returns Unsubscribe function to remove the listener.
   */
  subscribe(channel: string, listener: (message: unknown) => void): () => void;
}

/**
 * Creates a new in-memory sync bus.
 *
 * @returns A fresh {@link MemorySyncBus} instance.
 * @public
 */
export function createMemorySyncBus(): MemorySyncBus {
  const channels = new Map<string, Set<(message: unknown) => void>>();

  return {
    publish(channel: string, message: unknown): void {
      const subs = channels.get(channel);
      if (!subs || subs.size === 0) return;
      for (const listener of [...subs]) {
        try {
          listener(message);
        } catch (error) {
          reportUnhandled(`[kujam/sync] Error in bus subscriber for channel "${channel}"`, error);
        }
      }
    },
    subscribe(channel: string, listener: (message: unknown) => void): () => void {
      if (typeof listener !== 'function') {
        throw new TypeError('Subscriber listener must be a function.');
      }
      let subs = channels.get(channel);
      if (!subs) {
        subs = new Set();
        channels.set(channel, subs);
      }
      subs.add(listener);
      return () => {
        subs?.delete(listener);
        if (subs && subs.size === 0) {
          channels.delete(channel);
        }
      };
    },
  };
}

/** Global default memory sync bus for adapters that do not configure a custom bus. */
const defaultGlobalMemoryBus = createMemorySyncBus();

/**
 * Options for configuring an in-memory sync adapter.
 *
 * @public
 */
export interface MemorySyncAdapterOptions {
  /**
   * Shared memory bus. Defaults to an internal shared bus when omitted.
   */
  bus?: MemorySyncBus;
  /**
   * Channel name for isolating message delivery between board groups. Defaults to `'default'`.
   */
  channel?: string;
  /**
   * Optional custom history implementation to expose via `adapter.history`.
   */
  history?: HistoryApi;
  /**
   * Optional local user metadata for presence.
   */
  user?: PresenceUser;
}

interface MemoryChangeMessage {
  type: 'change';
  senderId: string;
  diff: RecordsDiff;
}

interface MemoryPresenceJoinMessage {
  type: 'presence:join';
  senderId: string;
  state: PresencePeerState;
}

interface MemoryPresenceSyncMessage {
  type: 'presence:sync';
  senderId: string;
  targetId: string;
  state: PresencePeerState;
}

interface MemoryPresenceUpdateMessage {
  type: 'presence:update';
  senderId: string;
  state: PresencePeerState;
}

interface MemoryPresenceLeaveMessage {
  type: 'presence:leave';
  senderId: string;
}

type MemorySyncBusMessage =
  | MemoryChangeMessage
  | MemoryPresenceJoinMessage
  | MemoryPresenceSyncMessage
  | MemoryPresenceUpdateMessage
  | MemoryPresenceLeaveMessage;

function isMemorySyncBusMessage(value: unknown): value is MemorySyncBusMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Record<string, unknown>;
  return typeof msg.type === 'string' && typeof msg.senderId === 'string';
}

/**
 * Creates an in-memory sync adapter allowing two or more boards to synchronize changes
 * in-memory across the same bus and channel.
 *
 * @param options - Configuration options for the in-memory adapter.
 * @returns SyncAdapter instance.
 *
 * @public
 */
export function createMemorySyncAdapter(options: MemorySyncAdapterOptions = {}): SyncAdapter {
  const bus = options.bus ?? defaultGlobalMemoryBus;
  const channel = options.channel ?? 'default';
  const adapterId = createId();

  let status: SyncStatus = 'offline';
  let currentBoard: Board | null = null;
  let unlistenBoard: Unsubscribe | null = null;
  let unsubscribeBus: Unsubscribe | null = null;

  const peers = new Map<string, PresencePeerState>();
  let localState: Partial<PresencePeerState> | undefined = options.user
    ? { user: options.user }
    : undefined;

  const presenceListeners = new Map<
    'change' | 'peer-join' | 'peer-leave',
    Set<(peerId: string, state?: PresencePeerState) => void>
  >();

  function emitPresence(
    event: 'change' | 'peer-join' | 'peer-leave',
    peerId: string,
    state?: PresencePeerState,
  ): void {
    const set = presenceListeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        listener(peerId, state);
      } catch (err) {
        reportUnhandled(`[kujam/presence] Listener error for ${event}`, err);
      }
    }
  }

  function onPresence(
    event: 'change' | 'peer-join' | 'peer-leave',
    listener: (peerId: string, state?: PresencePeerState) => void,
  ): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('Presence listener must be a function.');
    }
    let set = presenceListeners.get(event);
    if (!set) {
      set = new Set();
      presenceListeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  const syncEmitter = createEmitter<SyncEventMap>((type, error) => {
    reportUnhandled(`[kujam/sync] Error in listener for "${String(type)}"`, error);
  });

  function setStatus(next: SyncStatus): void {
    if (status === next) return;
    status = next;
    syncEmitter.emit('status', next);
  }

  function handleBusMessage(raw: unknown): void {
    if (!isMemorySyncBusMessage(raw) || raw.senderId === adapterId) {
      return;
    }

    switch (raw.type) {
      case 'change': {
        if (!currentBoard) return;
        const diff = raw.diff;
        if (!diff) return;

        const hasAdded = diff.added && Object.keys(diff.added).length > 0;
        const hasUpdated = diff.updated && Object.keys(diff.updated).length > 0;
        const hasRemoved = diff.removed && Object.keys(diff.removed).length > 0;

        if (!hasAdded && !hasUpdated && !hasRemoved) return;

        currentBoard.transact(
          (tx) => {
            if (diff.added) {
              for (const record of Object.values(diff.added)) {
                tx.put(record);
              }
            }
            if (diff.updated) {
              for (const update of Object.values(diff.updated)) {
                tx.put(update.after);
              }
            }
            if (diff.removed) {
              for (const id of Object.keys(diff.removed)) {
                tx.remove(id);
              }
            }
          },
          { origin: 'remote', label: 'sync.remote' },
        );
        break;
      }

      case 'presence:join': {
        const peerId = raw.senderId;
        const state = raw.state;
        if (state?.user) {
          peers.set(peerId, state);
          emitPresence('peer-join', peerId, state);
          syncEmitter.emit('peer-join', { peerId, user: state.user });

          if (localState && (localState as PresencePeerState).user) {
            bus.publish(channel, {
              type: 'presence:sync',
              senderId: adapterId,
              targetId: peerId,
              state: localState as PresencePeerState,
            });
          }
        }
        break;
      }

      case 'presence:sync': {
        if (raw.targetId !== adapterId) return;
        const peerId = raw.senderId;
        const state = raw.state;
        if (state?.user) {
          const isNew = !peers.has(peerId);
          peers.set(peerId, state);
          if (isNew) {
            emitPresence('peer-join', peerId, state);
            syncEmitter.emit('peer-join', { peerId, user: state.user });
          } else {
            emitPresence('change', peerId, state);
          }
        }
        break;
      }

      case 'presence:update': {
        const peerId = raw.senderId;
        const state = raw.state;
        if (state?.user) {
          const isNew = !peers.has(peerId);
          peers.set(peerId, state);
          if (isNew) {
            emitPresence('peer-join', peerId, state);
            syncEmitter.emit('peer-join', { peerId, user: state.user });
          } else {
            emitPresence('change', peerId, state);
          }
        }
        break;
      }

      case 'presence:leave': {
        const peerId = raw.senderId;
        const oldState = peers.get(peerId);
        if (oldState) {
          peers.delete(peerId);
          emitPresence('peer-leave', peerId, oldState);
          syncEmitter.emit('peer-leave', { peerId, user: oldState.user });
        }
        break;
      }
    }
  }

  const presenceApi: PresenceApi = {
    get peers(): ReadonlyMap<string, PresencePeerState> {
      return peers;
    },
    setLocalState(patch: Partial<PresencePeerState>): void {
      const current = localState ?? ({} as Partial<PresencePeerState>);
      const next: Partial<PresencePeerState> = {
        ...current,
        ...patch,
        ...(patch.user && current.user ? { user: { ...current.user, ...patch.user } } : {}),
      };
      localState = next;

      if (status === 'synced' && next.user) {
        bus.publish(channel, {
          type: 'presence:update',
          senderId: adapterId,
          state: next as PresencePeerState,
        });
      }
    },
    getLocalState(): Partial<PresencePeerState> | undefined {
      return localState ? { ...localState } : undefined;
    },
    on: onPresence,
  };

  const adapter: SyncAdapter = {
    get status(): SyncStatus {
      return status;
    },
    connect(board: Board): void {
      if (currentBoard === board && status === 'synced') {
        return;
      }
      if (status !== 'offline') {
        adapter.disconnect();
      }

      currentBoard = board;
      setStatus('connecting');

      unsubscribeBus = bus.subscribe(channel, (msg: unknown) => {
        handleBusMessage(msg);
      });

      unlistenBoard = board.on('change', (event) => {
        if (event.origin === 'remote') {
          return;
        }
        const hasAdded = event.added && Object.keys(event.added).length > 0;
        const hasUpdated = event.updated && Object.keys(event.updated).length > 0;
        const hasRemoved = event.removed && Object.keys(event.removed).length > 0;
        if (!hasAdded && !hasUpdated && !hasRemoved) {
          return;
        }
        bus.publish(channel, {
          type: 'change',
          senderId: adapterId,
          diff: {
            added: event.added,
            updated: event.updated,
            removed: event.removed,
          },
        });
      });

      setStatus('synced');

      if (localState && (localState as PresencePeerState).user) {
        bus.publish(channel, {
          type: 'presence:join',
          senderId: adapterId,
          state: localState as PresencePeerState,
        });
      }
    },
    disconnect(): void {
      if (status === 'offline') return;

      if (localState && (localState as PresencePeerState).user) {
        bus.publish(channel, {
          type: 'presence:leave',
          senderId: adapterId,
        });
      }

      if (unlistenBoard) {
        unlistenBoard();
        unlistenBoard = null;
      }
      if (unsubscribeBus) {
        unsubscribeBus();
        unsubscribeBus = null;
      }

      currentBoard = null;
      peers.clear();
      setStatus('offline');
    },
    presence: presenceApi,
    history: options.history,
    on<K extends keyof SyncEventMap>(
      event: K,
      listener: (data: SyncEventMap[K]) => void,
    ): () => void {
      return syncEmitter.on(event, listener);
    },
  };

  return adapter;
}
