/**
 * Kontrak skenario playground (BOARD-2401). Satu skenario = satu berkas di `src/scenarios/`,
 * didaftarkan otomatis lewat `import.meta.glob`.
 */
export interface ScenarioState {
  get(key: string): string | null;
  /** Menyimpan state skenario di query string (tanpa entri riwayat baru). `null` menghapus kunci. */
  set(key: string, value: string | null): void;
}

export interface ScenarioContext {
  /** Area tengah: papan atau isi lab. */
  main: HTMLElement;
  /** Panel kiri: kontrol khusus skenario. */
  controls: HTMLElement;
  /** Panel kanan: informasi debug (bisa disembunyikan pemakai). */
  debug: HTMLElement;
  state: ScenarioState;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  /** Urutan di pemilih skenario. */
  order: number;
  /** `board`: area tengah berlatar grid papan. `lab`: area tengah bebas untuk alat uji. */
  layout: 'board' | 'lab';
  /** Memasang skenario; mengembalikan fungsi pembersih yang dipanggil saat pindah skenario. */
  mount(ctx: ScenarioContext): void | (() => void);
}

export function defineScenario(scenario: Scenario): Scenario {
  return scenario;
}
