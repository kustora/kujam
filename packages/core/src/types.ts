/**
 * Tipe dokumen papan dan kontrak adapter.
 */

/**
 * Versi skema dokumen papan saat ini.
 *
 * @public
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Representasi record elemen di dalam dokumen papan datar.
 *
 * @public
 */
export interface ElementRecord<P = Record<string, unknown>> {
  /** ID unik, dibuat di klien (lihat `createId`). */
  id: string;
  kind: 'element';
  /** Tipe elemen, misalnya `'sticky'`, `'draw'`, `'geo'`, atau tipe kustom. */
  type: string;
  /** ID page tempat elemen berada. */
  pageId: string;
  /** ID frame atau grup induk, atau `null` bila langsung di page. */
  parentId: string | null;
  /** Fractional index untuk urutan lapisan (lihat `indexBetween`). */
  index: string;
  x: number;
  y: number;
  rotation: number;
  w: number;
  h: number;
  locked: boolean;
  /** Opasitas 0 sampai 1. */
  opacity: number;
  /** Isi khusus per tipe, divalidasi skema tipe. */
  props: P;
  /** Bebas untuk pemakai; package tidak pernah membaca atau mengubah isinya. */
  meta: Record<string, unknown>;
}

/**
 * Representasi record konektor/binding antar elemen.
 *
 * @public
 */
export interface BindingRecord {
  id: string;
  kind: 'binding';
  fromId: string;
  toId: string;
  /** Posisi relatif 0..1 di tepi elemen tujuan. */
  anchor: { x: number; y: number };
}

/**
 * Representasi record halaman (page) di dalam papan.
 *
 * @public
 */
export interface PageRecord {
  id: string;
  kind: 'page';
  name: string;
  /** Fractional index untuk urutan page. */
  index: string;
  /** Bebas untuk pemakai; package tidak pernah membaca atau mengubah isinya. */
  meta: Record<string, unknown>;
}

/**
 * Representasi record aset media di dalam papan.
 *
 * @public
 */
export interface AssetRecord {
  id: string;
  kind: 'asset';
  mimeType: string;
  w: number;
  h: number;
  /** Bebas untuk pemakai; package tidak pernah membaca atau mengubah isinya. */
  meta: Record<string, unknown>;
}

/**
 * Gabungan seluruh jenis record pada dokumen papan.
 *
 * @public
 */
export type BoardRecord = ElementRecord | BindingRecord | PageRecord | AssetRecord;

/**
 * Dokumen papan berversi yang menyimpan kumpulan record datar.
 *
 * @public
 */
export interface BoardDocument {
  /** Versi skema; naik setiap ada migrasi. Lihat {@link CURRENT_SCHEMA_VERSION}. */
  schemaVersion: number;
  /** Bebas untuk pemakai; package tidak pernah membaca atau mengubah isinya. */
  meta: Record<string, unknown>;
  /** Kumpulan record datar, dikunci dengan `id` record. */
  records: Record<string, BoardRecord>;
}

/**
 * Konfigurasi kamera papan.
 *
 * @public
 */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Perubahan yang diserahkan ke adapter penyimpanan: dokumen JSON utuh,
 * update biner (misalnya state Yjs), atau keduanya.
 *
 * @public
 */
export interface StorageChange {
  document?: BoardDocument;
  update?: Uint8Array;
}

/**
 * Kontrak adapter penyimpanan papan. Diimplementasikan oleh `@kujam/storage-*`
 * atau adapter buatan pemakai.
 *
 * @public
 */
export interface StorageAdapter {
  load(boardId: string): Promise<BoardDocument | Uint8Array | null>;
  save(boardId: string, change: StorageChange): Promise<void>;
  /** Jeda debounce penyimpanan otomatis dalam milidetik (bawaan 1000). */
  debounceMs?: number;
}
