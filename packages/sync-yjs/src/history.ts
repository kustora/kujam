/**
 * Per-user undo/redo history using Yjs UndoManager (BOARD-1507).
 *
 * Implements {@link HistoryApi} by binding to a Y.Doc records map with tracked origins
 * restricted to the local client. This ensures each collaborator's undo/redo actions
 * only reverse their own edits without undoing changes made by others.
 *
 * Supports coalescing via mergeKey and captureTimeout, transaction labels,
 * tx.onUndo/tx.onRedo hooks (BOARD-303), and element selection restoration.
 */

import * as Y from 'yjs';
import type { Board, HistoryApi, HistoryStep, UndoHook } from '@kujam/core';

function reportUnhandled(message: string, error: unknown): void {
  console.error(message, error);
}

/**
 * Options for configuring a Yjs-based history manager.
 *
 * @public
 */
export interface YjsHistoryOptions {
  /**
   * The Y.Doc instance containing the board's synchronized data.
   */
  doc: Y.Doc;

  /**
   * Scope of Y.AbstractType tracked by the undo manager.
   * Defaults to `doc.getMap('records')`.
   */
  scope?: Y.AbstractType<unknown> | Y.AbstractType<unknown>[];

  /**
   * Client origin to track. Only transactions tagged with this origin will be tracked.
   */
  clientOrigin: unknown;

  /**
   * Maximum pause between continuous transactions with the same mergeKey to merge into one step (in ms).
   * Defaults to 1000ms.
   */
  captureTimeout?: number;

  /**
   * Maximum number of undo steps stored in the undo stack.
   * Defaults to 200.
   */
  limit?: number;

  /**
   * Function returning the active Board instance for selection restoration and error reporting.
   */
  getBoard?: () => Board | null;
}

/**
 * Transaction metadata recorded during a local board change.
 *
 * @internal
 */
export interface LocalTransactionMeta {
  label?: string;
  mergeKey?: string;
  selectionBefore?: readonly string[];
  selectionAfter?: readonly string[];
  undoHooks?: readonly UndoHook[];
  redoHooks?: readonly UndoHook[];
}

/**
 * Yjs UndoManager-based History API interface.
 *
 * @public
 */
export interface YjsHistory extends HistoryApi {
  /** Underlying Y.UndoManager instance. */
  readonly undoManager: Y.UndoManager;

  /** Inspection view of the undo stack (labels and metadata). */
  readonly undoStack?: readonly HistoryStep[];

  /** Inspection view of the redo stack. */
  readonly redoStack?: readonly HistoryStep[];

  /** Seals the current coalesced undo step immediately. */
  stopCapturing(): void;

  /**
   * Executes `fn` and folds all local transactions into a single coalesced undo step
   * associated with `key`.
   */
  batch<T>(key: string, fn: () => T): T;

  /**
   * Records metadata for an upcoming or active local transaction.
   *
   * @internal
   */
  prepareTransaction(meta: LocalTransactionMeta): void;

  /**
   * Completes the current local transaction metadata recording.
   *
   * @internal
   */
  finalizeTransaction(): void;

  /** Disposes the undo manager and all associated event listeners. */
  destroy(): void;
}

/**
 * Creates a per-user Yjs UndoManager history manager (BOARD-1507).
 *
 * @param options - Configuration options for the history manager.
 * @returns YjsHistory instance implementing {@link HistoryApi}.
 * @public
 */
export function createYjsHistory(options: YjsHistoryOptions): YjsHistory {
  const { doc, clientOrigin, getBoard } = options;
  const scope = options.scope ?? doc.getMap('records');
  const captureTimeout = options.captureTimeout ?? 1000;
  const limit = options.limit ?? 200;

  const undoManager = new Y.UndoManager(scope, {
    trackedOrigins: new Set([clientOrigin]),
    captureTimeout,
  });

  const listeners = new Set<(state: { canUndo: boolean; canRedo: boolean }) => void>();
  let lastCanUndo = false;
  let lastCanRedo = false;

  let pendingMeta: LocalTransactionMeta | null = null;
  let lastMergeKey: string | undefined = undefined;
  let runningBatchKey: string | undefined = undefined;
  let lastPoppedMeta: Map<string, unknown> | null = null;
  let pendingRestoration: { type: 'undo' | 'redo'; meta: Map<string, unknown> } | null = null;

  function notifyChange(): void {
    const canUndo = undoManager.canUndo();
    const canRedo = undoManager.canRedo();
    if (canUndo !== lastCanUndo || canRedo !== lastCanRedo) {
      lastCanUndo = canUndo;
      lastCanRedo = canRedo;
      const state = { canUndo, canRedo };
      for (const listener of [...listeners]) {
        try {
          listener(state);
        } catch (err) {
          reportUnhandled('[kujam/sync-yjs] Error in history change listener', err);
        }
      }
    }
  }

  function enforceLimit(): void {
    while (undoManager.undoStack.length > limit) {
      undoManager.undoStack.shift();
    }
  }

  function applyRestoration(restoration: {
    type: 'undo' | 'redo';
    meta: Map<string, unknown>;
  }): void {
    const board = getBoard ? getBoard() : null;
    const meta = restoration.meta;
    const label = meta.get('label') as string | undefined;

    if (restoration.type === 'undo') {
      const selectionBefore = meta.get('selectionBefore') as readonly string[] | undefined;
      if (selectionBefore && board) {
        const records = board.getDocument().records;
        const validIds = selectionBefore.filter((id) => id in records);
        board.select(validIds);
      }

      const undoHooks = meta.get('undoHooks') as readonly UndoHook[] | undefined;
      if (undoHooks && undoHooks.length > 0) {
        const ctx = { label };
        for (const hook of undoHooks) {
          try {
            const res = hook(ctx);
            if (
              res !== null &&
              typeof res === 'object' &&
              typeof (res as { then?: unknown }).then === 'function'
            ) {
              (res as Promise<void>).catch((err) => {
                reportUnhandled('[kujam/sync-yjs] Error in tx.onUndo hook', err);
              });
            }
          } catch (err) {
            reportUnhandled('[kujam/sync-yjs] Error in tx.onUndo hook', err);
          }
        }
      }
    } else if (restoration.type === 'redo') {
      const selectionAfter = meta.get('selectionAfter') as readonly string[] | undefined;
      if (selectionAfter && board) {
        const records = board.getDocument().records;
        const validIds = selectionAfter.filter((id) => id in records);
        board.select(validIds);
      }

      const redoHooks = meta.get('redoHooks') as readonly UndoHook[] | undefined;
      if (redoHooks && redoHooks.length > 0) {
        const ctx = { label };
        for (const hook of redoHooks) {
          try {
            const res = hook(ctx);
            if (
              res !== null &&
              typeof res === 'object' &&
              typeof (res as { then?: unknown }).then === 'function'
            ) {
              (res as Promise<void>).catch((err) => {
                reportUnhandled('[kujam/sync-yjs] Error in tx.onRedo hook', err);
              });
            }
          } catch (err) {
            reportUnhandled('[kujam/sync-yjs] Error in tx.onRedo hook', err);
          }
        }
      }
    }
  }

  // Handle new stack item added
  undoManager.on(
    'stack-item-added',
    (event: {
      stackItem: { meta: Map<string, unknown> };
      origin: unknown;
      type: 'undo' | 'redo';
    }) => {
      enforceLimit();

      const sourceItem = (
        undoManager as unknown as { currStackItem?: { meta: Map<string, unknown> } }
      ).currStackItem;
      if (sourceItem?.meta && (undoManager.undoing || undoManager.redoing)) {
        for (const [k, v] of sourceItem.meta.entries()) {
          event.stackItem.meta.set(k, v);
        }
      } else if (lastPoppedMeta && (undoManager.undoing || undoManager.redoing)) {
        for (const [k, v] of lastPoppedMeta.entries()) {
          event.stackItem.meta.set(k, v);
        }
        lastPoppedMeta = null;
      } else if (event.type === 'undo' && pendingMeta) {
        if (pendingMeta.label !== undefined) {
          event.stackItem.meta.set('label', pendingMeta.label);
        }
        if (pendingMeta.mergeKey !== undefined) {
          event.stackItem.meta.set('mergeKey', pendingMeta.mergeKey);
        }
        if (pendingMeta.selectionBefore !== undefined) {
          event.stackItem.meta.set('selectionBefore', pendingMeta.selectionBefore);
        }
        if (pendingMeta.selectionAfter !== undefined) {
          event.stackItem.meta.set('selectionAfter', pendingMeta.selectionAfter);
        }
        if (pendingMeta.undoHooks && pendingMeta.undoHooks.length > 0) {
          const existing = (event.stackItem.meta.get('undoHooks') as UndoHook[] | undefined) ?? [];
          event.stackItem.meta.set('undoHooks', [...existing, ...pendingMeta.undoHooks]);
        }
        if (pendingMeta.redoHooks && pendingMeta.redoHooks.length > 0) {
          const existing = (event.stackItem.meta.get('redoHooks') as UndoHook[] | undefined) ?? [];
          event.stackItem.meta.set('redoHooks', [...existing, ...pendingMeta.redoHooks]);
        }
      }
      notifyChange();
    },
  );

  // Handle stack item updated (continuous coalesced edits within captureTimeout)
  undoManager.on(
    'stack-item-updated',
    (event: {
      stackItem: { meta: Map<string, unknown> };
      origin: unknown;
      type: 'undo' | 'redo';
    }) => {
      if (event.type === 'undo' && pendingMeta) {
        if (pendingMeta.label !== undefined) {
          event.stackItem.meta.set('label', pendingMeta.label);
        }
        if (pendingMeta.selectionAfter !== undefined) {
          event.stackItem.meta.set('selectionAfter', pendingMeta.selectionAfter);
        }
        if (pendingMeta.undoHooks && pendingMeta.undoHooks.length > 0) {
          const existing = (event.stackItem.meta.get('undoHooks') as UndoHook[] | undefined) ?? [];
          event.stackItem.meta.set('undoHooks', [...existing, ...pendingMeta.undoHooks]);
        }
        if (pendingMeta.redoHooks && pendingMeta.redoHooks.length > 0) {
          const existing = (event.stackItem.meta.get('redoHooks') as UndoHook[] | undefined) ?? [];
          event.stackItem.meta.set('redoHooks', [...existing, ...pendingMeta.redoHooks]);
        }
      }
      notifyChange();
    },
  );

  // Handle stack item popped during undo or redo
  undoManager.on(
    'stack-item-popped',
    (event: { stackItem: { meta: Map<string, unknown> }; type: 'undo' | 'redo' }) => {
      lastPoppedMeta = new Map(event.stackItem.meta);
      pendingRestoration = { type: event.type, meta: lastPoppedMeta };
      notifyChange();
    },
  );

  undoManager.on('stack-cleared', () => {
    notifyChange();
  });

  const history: YjsHistory = {
    get canUndo(): boolean {
      return undoManager.canUndo();
    },

    get canRedo(): boolean {
      return undoManager.canRedo();
    },

    get undoManager(): Y.UndoManager {
      return undoManager;
    },

    get undoStack(): readonly HistoryStep[] {
      return (undoManager.undoStack as unknown as { meta: Map<string, unknown> }[]).map((item) => ({
        label: item.meta?.get('label') as string | undefined,
      }));
    },

    get redoStack(): readonly HistoryStep[] {
      return (undoManager.redoStack as unknown as { meta: Map<string, unknown> }[]).map((item) => ({
        label: item.meta?.get('label') as string | undefined,
      }));
    },

    undo(): boolean {
      pendingRestoration = null;
      const result = undoManager.undo();
      if (pendingRestoration) {
        applyRestoration(pendingRestoration);
        pendingRestoration = null;
      }
      notifyChange();
      return result !== null;
    },

    redo(): boolean {
      pendingRestoration = null;
      const result = undoManager.redo();
      if (pendingRestoration) {
        applyRestoration(pendingRestoration);
        pendingRestoration = null;
      }
      notifyChange();
      return result !== null;
    },

    clear(): void {
      undoManager.clear();
      lastMergeKey = undefined;
      runningBatchKey = undefined;
      notifyChange();
    },

    stopCapturing(): void {
      undoManager.stopCapturing();
      lastMergeKey = undefined;
    },

    batch<T>(key: string, fn: () => T): T {
      if (typeof key !== 'string') {
        throw new TypeError('Kunci history.batch wajib berupa string.');
      }
      if (typeof fn !== 'function') {
        throw new TypeError('history.batch wajib menerima fungsi.');
      }

      const prevBatchKey = runningBatchKey;
      if (prevBatchKey === undefined) {
        if (lastMergeKey !== key) {
          undoManager.stopCapturing();
        }
        runningBatchKey = key;
        lastMergeKey = key;
      }

      try {
        const result = fn();
        if (
          result !== null &&
          typeof result === 'object' &&
          typeof (result as { then?: unknown }).then === 'function'
        ) {
          throw new TypeError('fn history.batch wajib sinkron; jangan mengembalikan Promise.');
        }
        return result;
      } finally {
        if (prevBatchKey === undefined) {
          runningBatchKey = undefined;
          undoManager.stopCapturing();
        }
      }
    },

    prepareTransaction(meta: LocalTransactionMeta): void {
      const targetMergeKey = runningBatchKey ?? meta.mergeKey;

      // If the mergeKey changed or was omitted, stop capturing previous coalesced step
      if (targetMergeKey === undefined || targetMergeKey !== lastMergeKey) {
        undoManager.stopCapturing();
      }

      lastMergeKey = targetMergeKey;
      pendingMeta = {
        ...meta,
        mergeKey: targetMergeKey,
      };
    },

    finalizeTransaction(): void {
      pendingMeta = null;
    },

    on(
      event: 'change',
      listener: (state: { canUndo: boolean; canRedo: boolean }) => void,
    ): () => void {
      if (typeof listener !== 'function') {
        throw new TypeError('Listener wajib berupa fungsi.');
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    destroy(): void {
      listeners.clear();
      undoManager.destroy();
    },
  };

  return history;
}
