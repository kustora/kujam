/**
 * `@kujam/sync-yjs` — Yjs sync adapter and awareness presence for `@kujam/core` (BOARD-1502).
 *
 * @packageDocumentation
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import type {
  Board,
  BoardInputEvent,
  BoardRecord,
  ChangeOrigin,
  PresenceUser,
  SyncAdapter,
  SyncErrorDetail,
  SyncStatus,
  SyncEventMap,
} from '@kujam/core';
import { recordToYMap, yMapToRecord, isValidBoardRecord, syncRichTextToYText } from './binding.js';
import {
  createYjsPresence,
  type LiveStroke,
  type YjsPresence,
  type YjsPresenceOptions,
} from './presence.js';
import { createYjsHistory, type YjsHistory, type YjsHistoryOptions } from './history.js';
import {
  createWhenLoaded,
  createYjsPersistence,
  isIndexedDbSupported,
  resolveIndexedDbEnabled,
  resolveIndexedDbName,
  IndexeddbPersistence,
  type WhenLoadedPromise,
  type YjsIndexedDbOptions,
} from './persistence.js';
import {
  calculateBackoffDelay,
  createReconnectController,
  isAuthError,
  ReconnectController,
  SyncAuthError,
  type ReconnectControllerOptions,
  type ReconnectOptions,
} from './reconnect.js';

export {
  recordToYMap,
  yMapToRecord,
  isValidBoardRecord,
  syncRichTextToYText,
  createYjsPresence,
  createYjsHistory,
  createWhenLoaded,
  createYjsPersistence,
  isIndexedDbSupported,
  IndexeddbPersistence,
  Awareness,
  calculateBackoffDelay,
  createReconnectController,
  isAuthError,
  ReconnectController,
  SyncAuthError,
  type LiveStroke,
  type WhenLoadedPromise,
  type YjsIndexedDbOptions,
  type ReconnectOptions,
  type ReconnectControllerOptions,
};
export type {
  SyncAdapter,
  SyncErrorDetail,
  SyncStatus,
  SyncEventMap,
  YjsPresence,
  YjsPresenceOptions,
  YjsHistory,
  YjsHistoryOptions,
};

type SyncListener<T> = (data: T) => void;

class SyncEventEmitter {
  private readonly listeners = new Map<keyof SyncEventMap, Set<SyncListener<unknown>>>();

  on<K extends keyof SyncEventMap>(
    event: K,
    listener: (data: SyncEventMap[K]) => void,
  ): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function.');
    }
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as SyncListener<unknown>);
    return () => {
      set?.delete(listener as SyncListener<unknown>);
      if (set && set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit<K extends keyof SyncEventMap>(event: K, data: SyncEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        listener(data);
      } catch {
        // Catch listener errors to prevent breaking execution
      }
    }
  }
}

/**
 * Options for configuring a Yjs sync adapter.
 *
 * @public
 */
export interface YjsSyncOptions {
  /**
   * Existing Y.Doc instance. If omitted, a fresh Y.Doc is created.
   */
  doc?: Y.Doc;

  /**
   * Existing Awareness instance. If omitted, a fresh Awareness instance is created on `doc`.
   */
  awareness?: Awareness;

  /**
   * Initial local user identity and appearance for presence.
   */
  user?: PresenceUser;

  /**
   * Cursor position throttling duration in milliseconds (default ~30 Hz / 33ms).
   */
  cursorThrottleMs?: number;

  /**
   * Active live stroke throttling duration in milliseconds (default ~30 Hz / 33ms) (BOARD-1505).
   */
  strokeThrottleMs?: number;

  /**
   * Origin token passed to `doc.transact` to distinguish local transactions from remote changes.
   * Defaults to a unique Symbol.
   */
  clientOrigin?: unknown;

  /**
   * Optional custom validator for incoming records. Return false to reject and drop malformed records.
   */
  validateRecord?: (record: unknown) => record is BoardRecord;

  /**
   * History options for per-user UndoManager tracking (BOARD-1507).
   * Set to `false` to disable Yjs history delegation.
   */
  history?: boolean | Omit<YjsHistoryOptions, 'doc' | 'clientOrigin'>;

  /**
   * IndexedDB persistence options (BOARD-1508).
   *
   * Enabled by default if `indexedDB` is available in the environment (`typeof indexedDB !== 'undefined'`).
   * Set to `false` to disable IndexedDB persistence.
   */
  indexeddb?: boolean | YjsIndexedDbOptions;

  /**
   * Optional action validator hook indicating whether an action requires an active online server connection (BOARD-1508).
   * Used by plugins to disable server-only actions when offline.
   */
  isOnlineRequired?: (action: string) => boolean;

  /**
   * Reconnection options with exponential backoff (BOARD-1509).
   * Pass `false` to disable automatic reconnection attempts.
   */
  reconnect?: boolean | ReconnectOptions;

  /**
   * Optional connection handler invoked when connecting or reconnecting (BOARD-1509).
   */
  connect?: (board: Board) => Promise<void> | void;
}

/**
 * Yjs-based synchronization adapter contract.
 *
 * Extends {@link SyncAdapter} with direct access to the underlying `Y.Doc`, `Awareness`, and `YjsPresence`.
 *
 * @public
 */
export interface YjsSyncAdapter extends SyncAdapter {
  /** Underlying Y.Doc instance synchronized with the board. */
  readonly doc: Y.Doc;

  /** Underlying Awareness instance used for presence and collaboration. */
  readonly awareness: Awareness;

  /** Presence awareness API for collaborator cursors, selection, and camera. */
  readonly presence: YjsPresence;

  /** History API backed by Yjs UndoManager for per-user undo/redo (BOARD-1507). */
  readonly history?: YjsHistory;

  /**
   * IndexedDB persistence provider for local offline caching and restoration (BOARD-1508).
   * `null` when running in environments without IndexedDB (e.g. Node/SSR) or when disabled.
   */
  readonly persistence?: IndexeddbPersistence | null;

  /**
   * Property and method returning a promise that resolves once the initial IndexedDB state has been loaded into Y.Doc (BOARD-1508).
   *
   * Can be awaited directly (`await adapter.whenLoaded`) or called (`await adapter.whenLoaded()`).
   */
  readonly whenLoaded: WhenLoadedPromise;

  /**
   * Number of pending updates stored in IndexedDB (BOARD-1508).
   */
  readonly pendingUpdates?: number;

  /**
   * Number of consecutive failed reconnection attempts since last successful synchronization (BOARD-1509).
   */
  readonly reconnectAttempts: number;

  /**
   * Manually triggers or forces a reconnection attempt (BOARD-1509).
   */
  reconnect(): Promise<void> | void;

  /**
   * Cancels any pending scheduled reconnection (BOARD-1509).
   */
  cancelReconnect(): void;

  /**
   * Handles an external synchronization error, classifying it into auth vs network (BOARD-1509).
   */
  handleError?(error: unknown): void;

  /**
   * Checks if a particular action requires an active online connection (BOARD-1508).
   */
  isOnlineRequired?(action: string): boolean;

  /**
   * Destroys adapter resources including persistence, history, and listeners.
   */
  destroy?(): void;
}

/**
 * Creates a Yjs-based sync adapter for `@kujam/core` (BOARD-1502).
 *
 * Binds a board's records to a `Y.Doc` with `Y.Map` per record under the `records` map.
 * Nested properties on elements are stored as child `Y.Map` instances for property-level CRDT merging.
 *
 * @param options - Configuration options for Yjs synchronization.
 * @returns YjsSyncAdapter instance.
 * @public
 */
export function createYjsSyncAdapter(options: YjsSyncOptions = {}): YjsSyncAdapter {
  const doc = options.doc ?? new Y.Doc();
  const awareness = options.awareness ?? new Awareness(doc);
  const clientOrigin = options.clientOrigin ?? Symbol('kujam.sync.yjs.origin');
  const customValidate = options.validateRecord;

  const presence = createYjsPresence({
    awareness,
    user: options.user,
    cursorThrottleMs: options.cursorThrottleMs,
    strokeThrottleMs: options.strokeThrottleMs,
  });

  const syncEmitter = new SyncEventEmitter();

  presence.on('peer-join', (peerId, state) => {
    if (state?.user) {
      syncEmitter.emit('peer-join', { peerId, user: state.user });
    }
  });

  presence.on('peer-leave', (peerId, state) => {
    syncEmitter.emit('peer-leave', { peerId, user: state?.user });
  });

  let currentStatus: SyncStatus = 'offline';
  let currentBoard: Board | null = null;
  let unlistenBoard: (() => void) | null = null;
  let unlistenDispose: (() => void) | null = null;
  let unobserveDeep: (() => void) | null = null;
  let unlistenSelection: (() => void) | null = null;
  let unlistenCamera: (() => void) | null = null;
  let unlistenTool: (() => void) | null = null;
  let origDispatch: ((event: BoardInputEvent) => boolean) | null = null;
  let isApplyingUndoRedo = false;

  let history: YjsHistory | undefined;
  if (options.history !== false) {
    const historyOpts = typeof options.history === 'object' ? options.history : {};
    history = createYjsHistory({
      doc,
      clientOrigin,
      captureTimeout: historyOpts.captureTimeout,
      limit: historyOpts.limit,
      getBoard: () => currentBoard,
    });
  }

  const shouldEnableIdb = resolveIndexedDbEnabled(options.indexeddb);
  const idbName = resolveIndexedDbName(options.indexeddb);
  let persistence: IndexeddbPersistence | null = shouldEnableIdb
    ? new IndexeddbPersistence(idbName, doc)
    : null;
  let syncPromise: Promise<void> | null = null;

  function syncActiveStroke(): void {
    if (!currentBoard) return;
    const toolData = currentBoard.toolData as {
      activeStroke?: {
        id?: string;
        points: readonly (readonly number[])[];
        color: string;
        thickness: number;
        brush?: string;
      } | null;
    } | null;

    if (
      toolData?.activeStroke &&
      toolData.activeStroke.points &&
      toolData.activeStroke.points.length > 0
    ) {
      presence.setLiveStroke({
        id: toolData.activeStroke.id,
        points: toolData.activeStroke.points,
        color: toolData.activeStroke.color,
        thickness: toolData.activeStroke.thickness,
        brush: toolData.activeStroke.brush,
      });
    } else {
      presence.setLiveStroke(null);
    }
  }

  function setStatus(next: SyncStatus): void {
    if (currentStatus === next) return;
    currentStatus = next;
    reconnectController?.setStatus(next);
    syncEmitter.emit('status', next);
  }

  function isRecordValid(record: unknown): record is BoardRecord {
    if (!isValidBoardRecord(record)) {
      return false;
    }
    if (customValidate && !customValidate(record)) {
      return false;
    }
    return true;
  }

  function reportInvalidRecord(id: string, raw: unknown): void {
    const error = new Error(`Malformed record dropped during sync: "${id}"`);
    if (currentBoard && typeof currentBoard.reportError === 'function') {
      currentBoard.reportError('invalid-record', `Record "${id}" is malformed and was dropped.`, {
        id,
        raw,
      });
    }
    syncEmitter.emit('error', error);
  }

  function initSyncState(board: Board): void {
    if (!currentBoard || currentBoard !== board) return;
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');

    if (recordsMap.size === 0) {
      const docRecords = board.getDocument().records;
      doc.transact(() => {
        for (const record of Object.values(docRecords)) {
          let yMap = recordsMap.get(record.id);
          if (!(yMap instanceof Y.Map)) {
            yMap = new Y.Map<unknown>();
            recordsMap.set(record.id, yMap);
          }
          recordToYMap(record, yMap);
        }
      }, Symbol.for('kujam.sync.yjs.init'));
    } else {
      board.transact(
        (tx) => {
          const remoteIds = new Set<string>();
          for (const [id, yRecordMap] of recordsMap.entries()) {
            if (yRecordMap instanceof Y.Map) {
              const record = yMapToRecord(yRecordMap);
              if (record && isRecordValid(record)) {
                remoteIds.add(id);
                tx.put(record);
              } else {
                reportInvalidRecord(id, yRecordMap);
              }
            } else {
              reportInvalidRecord(id, yRecordMap);
            }
          }
          if (remoteIds.size > 0) {
            const localRecords = board.getDocument().records;
            for (const localId of Object.keys(localRecords)) {
              if (!remoteIds.has(localId)) {
                tx.remove(localId);
              }
            }
          }
        },
        { origin: 'remote', label: 'sync.init' },
      );
    }
  }

  const reconnectOpts =
    typeof options.reconnect === 'object' ? options.reconnect : undefined;
  const autoReconnect = options.reconnect !== false;

  const reconnectController = new ReconnectController({
    initialDelayMs: reconnectOpts?.initialDelayMs,
    maxDelayMs: reconnectOpts?.maxDelayMs,
    backoffFactor: reconnectOpts?.backoffFactor,
    jitter: reconnectOpts?.jitter,
    maxAttempts: autoReconnect ? reconnectOpts?.maxAttempts : 0,
    randomFn: reconnectOpts?.randomFn,
    jitterRatio: reconnectOpts?.jitterRatio,
    connect: async () => {
      if (!currentBoard) return;
      if (options.connect) {
        await options.connect(currentBoard);
      }
      initSyncState(currentBoard);
    },
    onStatusChange: (status) => {
      setStatus(status);
    },
    onError: (detail) => {
      syncEmitter.emit('error', detail);
      if (detail.reason === 'auth') {
        syncEmitter.emit('auth-error', detail);
      }
    },
  });

  if (persistence) {
    persistence.whenSynced.catch((err: unknown) => {
      reconnectController.handleError(err);
    });
  }

  const adapter: YjsSyncAdapter = {
    get status(): SyncStatus {
      return currentStatus;
    },

    get doc(): Y.Doc {
      return doc;
    },

    get awareness(): Awareness {
      return awareness;
    },

    get presence(): YjsPresence {
      return presence;
    },

    get history(): YjsHistory | undefined {
      return history;
    },

    connect(board: Board): Promise<void> | void {
      if (currentBoard === board && currentStatus === 'synced') {
        return;
      }
      if (currentStatus !== 'offline') {
        adapter.disconnect();
      }

      if (shouldEnableIdb && !persistence) {
        persistence = new IndexeddbPersistence(idbName, doc);
        persistence.whenSynced.catch((err: unknown) => {
          reconnectController.handleError(err);
        });
      }

      currentBoard = board;
      setStatus('connecting');

      const recordsMap = doc.getMap<Y.Map<unknown>>('records');

      // Remote -> Local: listen for Y.Doc CRDT changes
      const deepObserver = (events: Y.YEvent<Y.Map<unknown>>[], transaction: Y.Transaction) => {
        if (
          transaction.origin === clientOrigin ||
          transaction.origin === Symbol.for('kujam.sync.yjs.init') ||
          (persistence && transaction.origin === persistence)
        ) {
          return; // Skip echo, init transaction, or initial persistence load
        }
        if (!currentBoard) return;

        const deletedIds = new Set<string>();
        const changedIds = new Set<string>();

        for (const event of events) {
          if (event.path.length === 0) {
            for (const [key, change] of event.keys) {
              if (change.action === 'delete') {
                deletedIds.add(key);
                changedIds.delete(key);
              } else {
                deletedIds.delete(key);
                changedIds.add(key);
              }
            }
          } else {
            const recordId = String(event.path[0]);
            if (!deletedIds.has(recordId)) {
              changedIds.add(recordId);
            }
          }
        }

        const validUpdates: BoardRecord[] = [];
        const validDeletes: string[] = [];

        for (const id of changedIds) {
          if (!recordsMap.has(id)) {
            validDeletes.push(id);
            continue;
          }
          const yRecord = recordsMap.get(id);
          if (!(yRecord instanceof Y.Map)) {
            reportInvalidRecord(id, yRecord);
            continue;
          }
          const record = yMapToRecord(yRecord);
          if (!record || !isRecordValid(record)) {
            reportInvalidRecord(id, yRecord);
            continue;
          }
          validUpdates.push(record);
        }

        for (const id of deletedIds) {
          validDeletes.push(id);
        }

        if (validUpdates.length === 0 && validDeletes.length === 0) {
          return;
        }

        const isFromUndoManager =
          history !== undefined &&
          (transaction.origin === history.undoManager ||
            history.undoManager.undoing ||
            history.undoManager.redoing);

        let targetOrigin: ChangeOrigin = 'remote';
        let targetLabel: string | undefined = 'sync.remote';

        if (isFromUndoManager && history) {
          targetOrigin = history.undoManager.undoing ? 'undo' : 'redo';
          targetLabel = undefined;
        } else {
          history?.stopCapturing();
        }

        isApplyingUndoRedo = Boolean(isFromUndoManager);
        try {
          currentBoard.transact(
            (tx) => {
              for (const record of validUpdates) {
                tx.put(record);
              }
              for (const id of validDeletes) {
                tx.remove(id);
              }
            },
            { origin: targetOrigin, label: targetLabel },
          );
        } finally {
          isApplyingUndoRedo = false;
        }
      };

      recordsMap.observeDeep(deepObserver);
      unobserveDeep = () => {
        recordsMap.unobserveDeep(deepObserver);
      };

      let lastSelection = board.selection;

      // Local -> Remote: listen for local board changes
      unlistenBoard = board.on('change', (event) => {
        if (event.origin === 'remote' || isApplyingUndoRedo) {
          return; // Skip echo
        }
        const hasAdded = event.added && Object.keys(event.added).length > 0;
        const hasUpdated = event.updated && Object.keys(event.updated).length > 0;
        const hasRemoved = event.removed && Object.keys(event.removed).length > 0;

        if (!hasAdded && !hasUpdated && !hasRemoved) {
          return;
        }

        if (history) {
          history.prepareTransaction({
            label: event.label,
            mergeKey: event.mergeKey,
            selectionBefore: lastSelection,
            selectionAfter: board.selection,
            undoHooks: event.onUndoHooks,
            redoHooks: event.onRedoHooks,
          });
        }

        try {
          doc.transact(() => {
            if (event.added) {
              for (const record of Object.values(event.added)) {
                let yMap = recordsMap.get(record.id);
                if (!(yMap instanceof Y.Map)) {
                  yMap = new Y.Map<unknown>();
                  recordsMap.set(record.id, yMap);
                }
                recordToYMap(record, yMap);
              }
            }
            if (event.updated) {
              for (const update of Object.values(event.updated)) {
                const record = update.after;
                let yMap = recordsMap.get(record.id);
                if (!(yMap instanceof Y.Map)) {
                  yMap = new Y.Map<unknown>();
                  recordsMap.set(record.id, yMap);
                }
                recordToYMap(record, yMap);
              }
            }
            if (event.removed) {
              for (const id of Object.keys(event.removed)) {
                recordsMap.delete(id);
              }
            }
          }, clientOrigin);
        } finally {
          if (history) {
            history.finalizeTransaction();
          }
          lastSelection = board.selection;
        }
      });

      unlistenDispose = board.on('dispose', () => {
        adapter.disconnect();
      });

      // Synchronize initial board state to presence awareness
      presence.setLocalState({
        ...(options.user ? { user: options.user } : {}),
        selection: board.selection,
        camera: {
          ...board.getCamera(),
          viewport: board.camera.viewport,
        },
        tool: board.tool ?? undefined,
      });

      unlistenSelection = board.on('selection', (e) => {
        const selection =
          (e as unknown as { ids?: readonly string[] }).ids ?? (e as unknown as readonly string[]);
        lastSelection = selection;
        presence.setLocalState({ selection });
      });

      unlistenCamera = board.on('camera', (e) => {
        const cam =
          (e as unknown as { camera?: { x: number; y: number; zoom: number } }).camera ??
          (e as unknown as { x: number; y: number; zoom: number });
        presence.setLocalState({
          camera: {
            ...cam,
            ...(board.camera.viewport &&
            board.camera.viewport.width > 0 &&
            board.camera.viewport.height > 0
              ? { viewport: board.camera.viewport }
              : {}),
          },
        });
      });

      unlistenTool = board.on('tool', (e) => {
        const tool =
          (e as unknown as { tool?: string; id?: string | null }).tool ??
          (e as unknown as { id?: string | null }).id ??
          undefined;
        presence.setLocalState({ tool: tool ?? undefined });
        syncActiveStroke();
      });

      origDispatch = board.dispatch.bind(board);
      board.dispatch = (event: BoardInputEvent): boolean => {
        const result = origDispatch!(event);
        if (
          event.type === 'pointer-move' ||
          event.type === 'pointer-down' ||
          event.type === 'pointer-up' ||
          event.type === 'pointer-cancel' ||
          (event.type === 'key-down' && event.key === 'Escape')
        ) {
          syncActiveStroke();
        }
        if (
          event.type === 'pointer-up' ||
          event.type === 'pointer-cancel' ||
          (event.type === 'key-down' && event.key === 'Escape')
        ) {
          history?.stopCapturing();
        }
        return result;
      };

      if (persistence && !persistence.synced) {
        syncPromise = persistence.whenSynced
          .then(async () => {
            if (options.connect) {
              await options.connect(board);
            }
            initSyncState(board);
            reconnectController.handleSuccess();
            syncPromise = null;
          })
          .catch((err: unknown) => {
            syncPromise = null;
            reconnectController.handleError(err);
          });
        return syncPromise;
      }

      if (options.connect) {
        const connResult = options.connect(board);
        if (connResult && typeof (connResult as Promise<void>).then === 'function') {
          syncPromise = (connResult as Promise<void>)
            .then(() => {
              initSyncState(board);
              reconnectController.handleSuccess();
              syncPromise = null;
            })
            .catch((err: unknown) => {
              syncPromise = null;
              reconnectController.handleError(err);
            });
          return syncPromise;
        }
      }

      try {
        initSyncState(board);
        reconnectController.handleSuccess();
      } catch (err) {
        reconnectController.handleError(err);
      }
    },

    disconnect(): void {
      if (persistence) {
        void persistence.destroy();
        persistence = null;
      }
      syncPromise = null;

      reconnectController.cancelReconnect();
      reconnectController.reset();

      if (currentStatus === 'offline') return;

      if (history) {
        history.destroy();
      }

      if (origDispatch && currentBoard) {
        currentBoard.dispatch = origDispatch;
        origDispatch = null;
      }
      presence.setLiveStroke(null);

      if (unlistenBoard) {
        unlistenBoard();
        unlistenBoard = null;
      }
      if (unlistenDispose) {
        unlistenDispose();
        unlistenDispose = null;
      }
      if (unobserveDeep) {
        unobserveDeep();
        unobserveDeep = null;
      }
      if (unlistenSelection) {
        unlistenSelection();
        unlistenSelection = null;
      }
      if (unlistenCamera) {
        unlistenCamera();
        unlistenCamera = null;
      }
      if (unlistenTool) {
        unlistenTool();
        unlistenTool = null;
      }

      awareness.setLocalState(null);

      currentBoard = null;
      setStatus('offline');
    },

    get persistence(): IndexeddbPersistence | null {
      return persistence;
    },

    get whenLoaded(): WhenLoadedPromise {
      return createWhenLoaded(
        () => persistence,
        () => syncPromise,
      );
    },

    get pendingUpdates(): number {
      return persistence ? persistence._dbsize : 0;
    },

    get reconnectAttempts(): number {
      return reconnectController.reconnectAttempts;
    },

    reconnect(): Promise<void> | void {
      return reconnectController.reconnect();
    },

    cancelReconnect(): void {
      reconnectController.cancelReconnect();
    },

    handleError(error: unknown): void {
      reconnectController.handleError(error);
    },

    isOnlineRequired(action: string): boolean {
      return options.isOnlineRequired ? options.isOnlineRequired(action) : false;
    },

    destroy(): void {
      reconnectController.destroy();
      adapter.disconnect();
    },

    on<K extends keyof SyncEventMap>(
      event: K,
      listener: (data: SyncEventMap[K]) => void,
    ): () => void {
      return syncEmitter.on(event, listener);
    },
  };

  return adapter;
}
