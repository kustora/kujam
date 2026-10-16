/**
 * Pemancar event per instance board (BOARD-207). Tidak ada state global: setiap board membuat
 * emitter sendiri, sehingga dua board tidak pernah berbagi listener.
 */

import type { HistoryEvent } from './history.js';
import type { ChangeEvent } from './store.js';
import type { CameraState } from './types.js';

/**
 * Pendengar event bertipe.
 *
 * @public
 */
export type Listener<T> = (event: T) => void;

/**
 * Fungsi untuk berhenti mendengarkan event. Aman dipanggil lebih dari sekali.
 *
 * @public
 */
export type Unsubscribe = () => void;

/**
 * Isi event `camera`: dipancarkan hanya bila kamera benar-benar berubah.
 *
 * @public
 */
export interface CameraEvent {
  /** Kamera sesudah perubahan (sama dengan `board.getCamera()`). */
  readonly camera: Readonly<CameraState>;
  /** Kamera sebelum perubahan. */
  readonly previous: Readonly<CameraState>;
}

/**
 * Isi event `selection`: dipancarkan hanya bila seleksi benar-benar berubah (BOARD-405).
 *
 * @beta
 */
export interface SelectionEvent {
  /** ID elemen terpilih sesudah perubahan, sesuai urutan seleksi. */
  readonly ids: readonly string[];
  /** ID elemen terpilih sebelum perubahan. */
  readonly previous: readonly string[];
}

/**
 * Isi event `tool`: dipancarkan saat tool aktif berganti (BOARD-501).
 *
 * @beta
 */
export interface ToolEvent {
  /** ID tool yang kini aktif, atau `null` bila tidak ada tool aktif (tool aktif dilepas). */
  readonly id: string | null;
  /** ID tool sebelumnya, atau `null` bila belum ada tool aktif. */
  readonly previous: string | null;
}

/**
 * Isi event `action`: dipancarkan plugin lewat `ctx.emit(name, payload)` (BOARD-605) agar bisa
 * didengar aplikasi.
 *
 * @beta
 */
export interface ActionEvent {
  /** Nama aksi bernamespace, misalnya `'contoh.ubah-warna'`. */
  readonly name: string;
  /** Data bebas dari plugin; tidak divalidasi core. */
  readonly payload: unknown;
}

/**
 * Kode error yang stabil untuk event `error`. Pemakai sebaiknya bercabang berdasarkan kode,
 * bukan pesan. Kode baru boleh ditambahkan di rilis minor.
 *
 * - `listener-error`: listener event lain melempar (BOARD-207).
 * - `invalid-props`: props elemen tidak lolos skema tipe (BOARD-205).
 * - `invalid-record`: record dari luar (dokumen atau peer) tidak valid dan diabaikan
 *   (BOARD-210, BOARD-1502).
 * - `forbidden`: hook izin menolak operasi (BOARD-212).
 * - `limit-exceeded`: batas ukuran papan tercapai (BOARD-005, BOARD-210).
 * - `document-too-new`: versi skema dokumen lebih baru dari yang dikenal (BOARD-703).
 *
 * @beta
 */
export type BoardErrorCode =
  | 'listener-error'
  | 'invalid-props'
  | 'invalid-record'
  | 'forbidden'
  | 'limit-exceeded'
  | 'document-too-new';

/**
 * Isi event `error`.
 *
 * @public
 */
export interface BoardErrorEvent {
  /** Kode stabil (lihat {@link BoardErrorCode}). */
  readonly code: BoardErrorCode;
  /** Pesan untuk log, berbahasa Indonesia; jangan dijadikan dasar logika. */
  readonly message: string;
  /** Nilai asli penyebab error, misalnya yang dilempar listener. */
  readonly cause: unknown;
  /** Untuk `listener-error`: nama event yang listenernya melempar. */
  readonly eventType?: keyof BoardEventMap;
}

/**
 * Peta nama event ke isi event untuk `board.on`.
 *
 * Listener yang melempar tidak menghentikan listener lain; error-nya dipancarkan sebagai event
 * `error` berkode `listener-error`. Bila tidak ada listener `error`, atau listener `error` sendiri
 * yang melempar, error dilaporkan ke `console.error` (bila tersedia) dan tidak dipancarkan ulang,
 * sehingga tidak ada rekursi.
 *
 * @public
 */
export interface BoardEventMap {
  /** Satu event per transaksi yang menghasilkan perubahan bersih, dan per `loadDocument`. */
  change: ChangeEvent;
  /**
   * Seleksi berubah. Belum ada sumbernya di rilis ini (BOARD-405).
   *
   * @beta
   */
  selection: SelectionEvent;
  /** Kamera berubah lewat `setCamera`. */
  camera: CameraEvent;
  /**
   * Tool aktif berganti lewat `setTool`, Esc, tool `oneShot`, atau spasi (BOARD-501).
   *
   * @beta
   */
  tool: ToolEvent;
  /**
   * Aksi plugin. Belum ada sumbernya di rilis ini (BOARD-605).
   *
   * @beta
   */
  action: ActionEvent;
  /** Error yang tidak dilempar ke pemanggil (lihat {@link BoardErrorCode}). */
  error: BoardErrorEvent;
  /** `canUndo` atau `canRedo` berubah (BOARD-301). */
  history: HistoryEvent;
}

/**
 * Dipanggil emitter untuk setiap listener yang melempar. `type` adalah event yang sedang
 * dipancarkan, `error` nilai yang dilempar listener.
 *
 * @internal
 */
export type ListenerErrorHandler<M> = (type: keyof M, error: unknown) => void;

/** @internal */
export interface Emitter<M> {
  on<K extends keyof M>(type: K, listener: Listener<M[K]>): Unsubscribe;
  emit<K extends keyof M>(type: K, event: M[K]): void;
  /** Apakah ada listener terdaftar untuk `type`. */
  has(type: keyof M): boolean;
  clear(): void;
}

/**
 * Membuat emitter baru. Listener dipanggil berurutan sesuai pendaftaran. Listener yang melempar
 * tidak menghentikan listener lain dan tidak pernah membuat `emit` melempar: error-nya
 * diteruskan ke `onListenerError` (board meneruskannya ke event `error`).
 *
 * @internal
 */
export function createEmitter<M>(onListenerError: ListenerErrorHandler<M>): Emitter<M> {
  const listeners = new Map<keyof M, Set<Listener<never>>>();

  return {
    on(type, listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('Listener event wajib berupa fungsi.');
      }
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      // Bungkus agar fungsi yang sama bisa didaftarkan dua kali dan dilepas satu per satu.
      const entry: Listener<M[typeof type]> = (event) => listener(event);
      set.add(entry as Listener<never>);
      return () => {
        set.delete(entry as Listener<never>);
      };
    },
    emit(type, event) {
      const set = listeners.get(type);
      if (!set || set.size === 0) return;
      // Salin dulu: listener boleh berhenti berlangganan atau mendaftar selama emit.
      for (const listener of [...set] as Listener<M[typeof type]>[]) {
        // Listener yang dilepas oleh listener sebelumnya tidak dipanggil lagi.
        if (!set.has(listener as Listener<never>)) continue;
        try {
          listener(event);
        } catch (error) {
          onListenerError(type, error);
        }
      }
    },
    has(type) {
      const set = listeners.get(type);
      return set !== undefined && set.size > 0;
    },
    clear() {
      listeners.clear();
    },
  };
}

/**
 * Melaporkan error yang tidak punya tujuan lain ke `console.error` bila tersedia (Node, Worker,
 * browser). Core tidak bergantung pada tipe `console` (lib ES2022 tanpa DOM), jadi diakses lewat
 * `globalThis` secara defensif. Tidak pernah melempar.
 *
 * @internal
 */
export function reportUnhandled(message: string, error: unknown): void {
  try {
    const sink = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console;
    sink?.error?.(message, error);
  } catch {
    // Tidak ada tempat lain untuk melapor; diabaikan agar tidak memicu rekursi.
  }
}
