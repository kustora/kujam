/**
 * Tool interactions that span many input events (BOARD-501, ADR-004).
 *
 * Each `change` is applied immediately as a local transaction so the renderer can draw
 * right away, but it is not recorded in history. The diffs of all transactions are merged per record; on
 * `commit`, the merged diff is recorded as a single undo step. On `rollback`, the inverse of the merged diff
 * is applied, except to records changed by another party since the interaction's last write
 * (the other party's changes win, same as the history conflict strategy).
 */

import { deepEqual } from '../utils/clone.js';
import type { LocalHistory } from '../history/history.js';
import type { ChangeEvent, RecordStore, RecordUpdate, Transaction } from '../document/store.js';
import type { BoardRecord } from '../types.js';

/** Record value before the interaction touched it and after the interaction's last write. */
interface Span {
  readonly before: BoardRecord | undefined;
  after: BoardRecord | undefined;
}

/** @internal */
export interface Interaction {
  /** There is an interaction that has not been committed or rolled back. */
  readonly active: boolean;
  /** Whether the transaction the store is committing belongs to this interaction. */
  readonly capturing: boolean;
  /** Called for `change` events that occur while `capturing`. */
  observe(event: ChangeEvent): void;
  /** Applies a change as part of the interaction; starts the interaction when inactive. */
  change(fn: (tx: Transaction) => void, label: string | undefined): void;
  /** Records the merged changes as a single undo step. No effect when inactive. */
  commit(fallbackLabel: string): void;
  /** Cancels all of the interaction's changes. Returns `true` when anything was reverted. */
  rollback(): boolean;
  /** Forgets the interaction without changing the document (for example when the document is replaced). */
  discard(): void;
}

/** @internal */
export function createInteraction(store: RecordStore, history: LocalHistory): Interaction {
  let spans: Map<string, Span> | null = null;
  let seq = 0;
  let label: string | undefined;
  let capturing = false;

  function track(
    id: string,
    before: BoardRecord | undefined,
    after: BoardRecord | undefined,
  ): void {
    const span = spans?.get(id);
    if (span) span.after = after;
    else spans?.set(id, { before, after });
  }

  function capture(fn: (tx: Transaction) => void, txLabel: string | undefined): void {
    if (store.inTransaction()) {
      throw new Error('Perubahan interaksi tool tidak boleh dijalankan di dalam transaksi.');
    }
    capturing = true;
    try {
      store.transact(fn, { label: txLabel });
    } finally {
      capturing = false;
    }
  }

  function reset(): void {
    spans = null;
    label = undefined;
  }

  return {
    get active() {
      return spans !== null;
    },
    get capturing() {
      return capturing;
    },
    observe(event) {
      for (const [id, rec] of Object.entries(event.added)) track(id, undefined, rec);
      for (const [id, { before, after }] of Object.entries(event.updated)) track(id, before, after);
      for (const [id, rec] of Object.entries(event.removed)) track(id, rec, undefined);
    },
    change(fn, txLabel) {
      if (!spans) {
        spans = new Map();
        seq = history.reserveSeq();
      }
      if (txLabel !== undefined) label = txLabel;
      capture(fn, txLabel ?? label);
    },
    commit(fallbackLabel) {
      if (!spans) return;
      const added: Record<string, BoardRecord> = {};
      const updated: Record<string, RecordUpdate> = {};
      const removed: Record<string, BoardRecord> = {};
      for (const [id, { before, after }] of spans) {
        if (before === undefined && after !== undefined) added[id] = after;
        else if (before !== undefined && after === undefined) removed[id] = before;
        else if (before !== undefined && after !== undefined && !deepEqual(before, after)) {
          updated[id] = { before, after };
        }
      }
      const diffLabel = label ?? fallbackLabel;
      reset();
      if (
        Object.keys(added).length === 0 &&
        Object.keys(updated).length === 0 &&
        Object.keys(removed).length === 0
      ) {
        return;
      }
      history.record(
        Object.freeze({ added, updated, removed, origin: 'local', label: diffLabel }),
        seq,
      );
    },
    rollback() {
      if (!spans) return false;
      const current = spans;
      const rollbackLabel = label;
      reset();
      if (current.size === 0) return false;
      let reverted = false;
      capture((tx) => {
        for (const [id, { before, after }] of current) {
          // Records changed by another party since the interaction's last write are not touched.
          if (tx.get(id) !== after) continue;
          if (before === undefined) tx.remove(id);
          else tx.put(before);
          reverted = true;
        }
      }, rollbackLabel);
      return reverted;
    },
    discard: reset,
  };
}
