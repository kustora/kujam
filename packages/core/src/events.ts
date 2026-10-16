/**
 * Pemancar event per instance board. Tidak ada state global: setiap board membuat emitter
 * sendiri, sehingga dua board tidak pernah berbagi listener. Peta event diperluas di BOARD-207.
 */

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

/** @internal */
export interface Emitter<M> {
  on<K extends keyof M>(type: K, listener: Listener<M[K]>): Unsubscribe;
  emit<K extends keyof M>(type: K, event: M[K]): void;
  clear(): void;
}

/**
 * Membuat emitter baru. Listener dipanggil berurutan sesuai pendaftaran; listener yang melempar
 * tidak menghentikan listener lain, dan error pertama dilempar ulang setelah semua listener
 * dipanggil (BOARD-207 akan meneruskannya ke event `error`).
 *
 * @internal
 */
export function createEmitter<M>(): Emitter<M> {
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
      let failed = false;
      let firstError: unknown;
      // Salin dulu: listener boleh berhenti berlangganan atau mendaftar selama emit.
      for (const listener of [...set] as Listener<M[typeof type]>[]) {
        // Listener yang dilepas oleh listener sebelumnya tidak dipanggil lagi.
        if (!set.has(listener as Listener<never>)) continue;
        try {
          listener(event);
        } catch (error) {
          if (!failed) {
            failed = true;
            firstError = error;
          }
        }
      }
      if (failed) throw firstError;
    },
    clear() {
      listeners.clear();
    },
  };
}
