/**
 * Interaksi tool yang berlangsung selama banyak event input (BOARD-501, ADR-004).
 *
 * Setiap `change` diterapkan langsung sebagai transaksi lokal sehingga renderer bisa segera
 * menggambar, tetapi tidak dicatat ke riwayat. Diff semua transaksi digabung per record; saat
 * `commit`, gabungannya dicatat sebagai satu langkah undo. Saat `rollback`, kebalikan gabungan
 * diterapkan, kecuali pada record yang sudah diubah pihak lain sejak tulisan terakhir interaksi
 * (perubahan pihak lain menang, sama dengan strategi konflik riwayat).
 */

import { deepEqual } from './clone.js';
import type { LocalHistory } from './history.js';
import type { ChangeEvent, RecordStore, RecordUpdate, Transaction } from './store.js';
import type { BoardRecord } from './types.js';

/** Nilai record sebelum interaksi menyentuhnya dan sesudah tulisan terakhir interaksi. */
interface Span {
  readonly before: BoardRecord | undefined;
  after: BoardRecord | undefined;
}

/** @internal */
export interface Interaction {
  /** Ada interaksi yang belum di-commit atau di-rollback. */
  readonly active: boolean;
  /** Apakah transaksi yang sedang di-commit store milik interaksi ini. */
  readonly capturing: boolean;
  /** Dipanggil untuk event `change` yang terjadi selama `capturing`. */
  observe(event: ChangeEvent): void;
  /** Menerapkan perubahan sebagai bagian interaksi; memulai interaksi bila belum aktif. */
  change(fn: (tx: Transaction) => void, label: string | undefined): void;
  /** Mencatat gabungan perubahan sebagai satu langkah undo. Tanpa efek bila tidak aktif. */
  commit(fallbackLabel: string): void;
  /** Membatalkan semua perubahan interaksi. Mengembalikan `true` bila ada yang dibalik. */
  rollback(): boolean;
  /** Melupakan interaksi tanpa mengubah dokumen (misalnya saat dokumen diganti). */
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
          // Record yang sudah diubah pihak lain sejak tulisan terakhir interaksi tidak disentuh.
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
