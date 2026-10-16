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
  id: string;
  kind: 'element';
  type: string;
  pageId: string;
  parentId: string | null;
  index: string;
  x: number;
  y: number;
  rotation: number;
  w: number;
  h: number;
  locked: boolean;
  opacity: number;
  props: P;
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
  index: string;
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
  schemaVersion: number;
  meta: Record<string, unknown>;
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
