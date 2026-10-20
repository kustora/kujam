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
  PresenceUser,
  SyncAdapter,
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

export { recordToYMap, yMapToRecord, isValidBoardRecord, syncRichTextToYText };
export { createYjsPresence, Awareness, type LiveStroke };
export type { SyncAdapter, SyncStatus, SyncEventMap, YjsPresence, YjsPresenceOptions };

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

    connect(board: Board): void {
      if (currentBoard === board && currentStatus === 'synced') {
        return;
      }
      if (currentStatus !== 'offline') {
        adapter.disconnect();
      }

      currentBoard = board;
      setStatus('connecting');

      const recordsMap = doc.getMap<Y.Map<unknown>>('records');

      // Initialize state between board and Y.Doc
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
        }, clientOrigin);
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

      // Remote -> Local: listen for Y.Doc CRDT changes
      const deepObserver = (events: Y.YEvent<Y.Map<unknown>>[], transaction: Y.Transaction) => {
        if (transaction.origin === clientOrigin) {
          return; // Skip echo
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

        currentBoard.transact(
          (tx) => {
            for (const record of validUpdates) {
              tx.put(record);
            }
            for (const id of validDeletes) {
              tx.remove(id);
            }
          },
          { origin: 'remote', label: 'sync.remote' },
        );
      };

      recordsMap.observeDeep(deepObserver);
      unobserveDeep = () => {
        recordsMap.unobserveDeep(deepObserver);
      };

      // Local -> Remote: listen for local board changes
      unlistenBoard = board.on('change', (event) => {
        if (event.origin === 'remote') {
          return; // Skip echo
        }
        const hasAdded = event.added && Object.keys(event.added).length > 0;
        const hasUpdated = event.updated && Object.keys(event.updated).length > 0;
        const hasRemoved = event.removed && Object.keys(event.removed).length > 0;

        if (!hasAdded && !hasUpdated && !hasRemoved) {
          return;
        }

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
      });

      unlistenDispose = board.on('dispose', () => {
        adapter.disconnect();
      });

      // Synchronize initial board state to presence awareness
      presence.setLocalState({
        ...(options.user ? { user: options.user } : {}),
        selection: board.selection,
        camera: board.getCamera(),
        tool: board.tool ?? undefined,
      });

      unlistenSelection = board.on('selection', (e) => {
        const selection =
          (e as unknown as { ids?: readonly string[] }).ids ?? (e as unknown as readonly string[]);
        presence.setLocalState({ selection });
      });

      unlistenCamera = board.on('camera', (e) => {
        const cam =
          (e as unknown as { camera?: { x: number; y: number; zoom: number } }).camera ??
          (e as unknown as { x: number; y: number; zoom: number });
        presence.setLocalState({ camera: cam });
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
        return result;
      };

      setStatus('synced');
    },

    disconnect(): void {
      if (currentStatus === 'offline') return;

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

    on<K extends keyof SyncEventMap>(
      event: K,
      listener: (data: SyncEventMap[K]) => void,
    ): () => void {
      return syncEmitter.on(event, listener);
    },
  };

  return adapter;
}
