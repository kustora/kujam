/**
 * Riwayat undo/redo lokal berbasis diff (BOARD-301).
 *
 * Setiap langkah adalah {@link RecordsDiff} satu transaksi. Undo menerapkan kebalikan diff
 * langkah teratas sebagai transaksi berasal `undo`; diff hasil transaksi itu menjadi langkah
 * redo, dan redo menerapkan kebalikannya lagi (berasal `redo`). Dengan begitu undo dan redo
 * simetris, dan langkah yang hanya sebagian bisa diterapkan tetap konsisten.
 *
 * Strategi konflik 0.1 (perubahan pihak lain, misalnya `remote`, di antara langkah lokal dan
 * undo): kebalikan diff diterapkan per record, dan record yang diubah pihak lain (dibuat, diubah,
 * atau dihapus) setelah langkah itu tercatat dilewati, sehingga perubahan pihak lain selalu
 * menang dan record yang dihapus pihak lain tidak dihidupkan kembali. Bila tidak ada satu pun
 * record yang bisa dibalik, langkah dibuang dan undo lanjut ke langkah berikutnya. Karena
 * langkah lokal dibalik berurutan dari yang terbaru (LIFO), langkah lokal tidak pernah saling
 * berkonflik. Undo per orang yang sesungguhnya datang di 0.2 lewat `UndoManager` Yjs (BOARD-1507).
 *
 * Pelacakan konflik memakai nomor urut: setiap langkah menyimpan nomor saat dicatat, dan setiap
 * perubahan pihak lain menandai ID record yang disentuhnya dengan nomor baru. Biayanya sebanding
 * jumlah record yang berubah, bukan jumlah langkah di riwayat.
 */

import type { ChangeEvent, RecordsDiff, RecordStore, Transaction } from './store.js';

/**
 * Batas bawaan jumlah langkah undo yang disimpan.
 *
 * @public
 */
export const DEFAULT_HISTORY_LIMIT = 200;

/**
 * Opsi riwayat undo untuk `createBoard({ history })`.
 *
 * @public
 */
export interface HistoryOptions {
  /**
   * Jumlah langkah undo maksimum; langkah tertua dibuang saat batas terlewati. Bilangan bulat
   * `>= 0` atau `Infinity`. `0` mematikan riwayat. Bawaan {@link DEFAULT_HISTORY_LIMIT}.
   */
  limit?: number;
}

/**
 * Status riwayat undo papan (`board.history`).
 *
 * @public
 */
export interface BoardHistory {
  /** Ada langkah yang bisa di-undo. */
  readonly canUndo: boolean;
  /** Ada langkah yang bisa di-redo. */
  readonly canRedo: boolean;
  /** Batas langkah yang dipakai (lihat {@link HistoryOptions.limit}). */
  readonly limit: number;
  /** Mengosongkan tumpukan undo dan redo. Dokumen tidak berubah. */
  clear(): void;
}

/**
 * Isi event `history`: dipancarkan hanya saat `canUndo` atau `canRedo` berubah nilai.
 *
 * @public
 */
export interface HistoryEvent {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/** @internal */
export interface LocalHistory {
  readonly api: BoardHistory;
  undo(): boolean;
  redo(): boolean;
  /** Dipanggil untuk setiap event `change` papan, sebelum listener pemakai. */
  observe(event: ChangeEvent): void;
  /** Memanggil `onStateChange` bila `canUndo`/`canRedo` berubah sejak laporan terakhir. */
  flush(): void;
  /**
   * Memesan nomor urut untuk langkah yang baru dicatat nanti (interaksi tool, BOARD-501).
   * Perubahan pihak lain sesudah nomor ini dianggap konflik saat langkahnya di-undo.
   */
  reserveSeq(): number;
  /**
   * Mencatat diff gabungan sebagai satu langkah lokal dengan nomor urut yang sudah dipesan,
   * lalu membuang tumpukan redo (seperti transaksi lokal biasa).
   */
  record(diff: ChangeEvent, seq: number): void;
  dispose(): void;
}

/** @internal */
export interface LocalHistoryOptions {
  limit: number;
  onStateChange: (event: HistoryEvent) => void;
}

/** Satu langkah riwayat: diff transaksi dan nomor urut saat dicatat. */
interface Entry {
  readonly diff: ChangeEvent;
  readonly seq: number;
}

interface Capture {
  readonly origin: 'undo' | 'redo';
  readonly target: Entry[];
  applied: boolean;
}

/**
 * Memvalidasi `history.limit`.
 *
 * @internal
 */
export function resolveHistoryLimit(options: HistoryOptions | undefined): number {
  const limit = options?.limit;
  if (limit === undefined) return DEFAULT_HISTORY_LIMIT;
  if (limit === Number.POSITIVE_INFINITY || (Number.isInteger(limit) && limit >= 0)) return limit;
  throw new RangeError('history.limit wajib bilangan bulat >= 0 atau Infinity.');
}

/** Menerapkan kebalikan `diff` pada record yang lolos `keep`. */
function applyInverse(tx: Transaction, diff: RecordsDiff, keep: (id: string) => boolean): void {
  for (const id of Object.keys(diff.added)) {
    if (keep(id)) tx.remove(id);
  }
  for (const [id, rec] of Object.entries(diff.removed)) {
    if (keep(id)) tx.put(rec);
  }
  for (const [id, { before }] of Object.entries(diff.updated)) {
    if (keep(id)) tx.put(before);
  }
}

function touchedIds(diff: RecordsDiff): string[] {
  return [...Object.keys(diff.added), ...Object.keys(diff.updated), ...Object.keys(diff.removed)];
}

/**
 * Membuat riwayat undo lokal yang terhubung ke store.
 *
 * @internal
 */
export function createLocalHistory(store: RecordStore, options: LocalHistoryOptions): LocalHistory {
  const { limit, onStateChange } = options;
  const undoStack: Entry[] = [];
  const redoStack: Entry[] = [];
  /** ID record -> nomor urut perubahan pihak lain terakhir yang menyentuhnya. */
  const foreign = new Map<string, number>();
  let seq = 0;
  let capture: Capture | null = null;
  let reported: HistoryEvent = { canUndo: false, canRedo: false };
  let disposed = false;

  function push(stack: Entry[], diff: ChangeEvent, entrySeq = ++seq): void {
    stack.push({ diff, seq: entrySeq });
    while (stack.length > limit) stack.shift();
  }

  function clear(): void {
    undoStack.length = 0;
    redoStack.length = 0;
    foreign.clear();
  }

  function flush(): void {
    const canUndo = undoStack.length > 0;
    const canRedo = redoStack.length > 0;
    if (canUndo === reported.canUndo && canRedo === reported.canRedo) return;
    reported = Object.freeze({ canUndo, canRedo });
    onStateChange(reported);
  }

  function step(from: Entry[], to: Entry[], origin: 'undo' | 'redo'): boolean {
    if (disposed) throw new Error('Papan sudah di-dispose.');
    if (store.inTransaction()) {
      throw new Error(`${origin} tidak boleh dipanggil di dalam transaksi.`);
    }
    let applied = false;
    while (!applied && from.length > 0) {
      const entry = from.pop() as Entry;
      const token: Capture = { origin, target: to, applied: false };
      // Record yang disentuh pihak lain setelah langkah ini tercatat tidak dibalik.
      const keep = (id: string): boolean => (foreign.get(id) ?? 0) < entry.seq;
      capture = token;
      try {
        store.transact((tx) => applyInverse(tx, entry.diff, keep), {
          origin,
          label: entry.diff.label,
        });
      } finally {
        if (capture === token) capture = null;
      }
      // Bila semua record sudah diubah pihak lain, langkah ini dibuang (tidak masuk `to`).
      applied = token.applied;
    }
    if (undoStack.length === 0 && redoStack.length === 0) foreign.clear();
    flush();
    return applied;
  }

  const api: BoardHistory = {
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    limit,
    clear() {
      clear();
      flush();
    },
  };

  return {
    api,
    undo: () => step(undoStack, redoStack, 'undo'),
    redo: () => step(redoStack, undoStack, 'redo'),
    observe(event) {
      // Hanya transaksi undo/redo milik riwayat ini yang ditangkap; transaksi lain yang memakai
      // origin `undo`/`redo` secara manual diperlakukan seperti perubahan non-lokal.
      if (capture && event.origin === capture.origin) {
        capture.applied = true;
        push(capture.target, event);
        capture = null;
        return;
      }
      if (event.origin === 'local') {
        push(undoStack, event);
        redoStack.length = 0;
      } else if (event.origin === 'load' || event.origin === 'migration') {
        // Diff lama tidak berlaku lagi untuk dokumen yang diganti atau dimigrasi.
        clear();
      } else if (undoStack.length > 0 || redoStack.length > 0) {
        // Perubahan pihak lain (remote, atau undo/redo manual): tandai record yang disentuhnya.
        const mark = ++seq;
        for (const id of touchedIds(event)) foreign.set(id, mark);
      }
    },
    flush,
    reserveSeq: () => ++seq,
    record(diff, entrySeq) {
      if (disposed) return;
      push(undoStack, diff, entrySeq);
      redoStack.length = 0;
      flush();
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
