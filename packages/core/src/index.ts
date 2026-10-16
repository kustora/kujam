/**
 * `@kujam/core` — Inti papan tulis agnostik tanpa DOM dan tanpa dependensi runtime.
 *
 * @packageDocumentation
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
 * Opsi pembuatan instance `Board`.
 *
 * @public
 */
export interface CreateBoardOptions {
  document?: BoardDocument;
  readOnly?: boolean;
  locale?: 'id' | 'en';
}

/**
 * Antarmuka publik instance `Board`.
 *
 * @public
 */
export interface Board {
  getDocument(): Readonly<BoardDocument>;
  loadDocument(doc: BoardDocument): void;
  getElement(id: string): Readonly<ElementRecord> | undefined;
  getCamera(): Readonly<CameraState>;
  setCamera(patch: Partial<CameraState>): void;
  dispose(): void;
}

/**
 * Membuat dokumen papan kosong dengan satu halaman bawaan (`page:main`).
 *
 * @public
 */
export function createEmptyDocument(meta: Record<string, unknown> = {}): BoardDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { ...meta },
    records: {
      'page:main': {
        id: 'page:main',
        kind: 'page',
        name: 'Halaman 1',
        index: 'a0',
        meta: {},
      },
    },
  };
}

function cloneDocument(doc: BoardDocument): BoardDocument {
  return JSON.parse(JSON.stringify(doc)) as BoardDocument;
}

/**
 * Membuat instance `Board` baru tanpa ketergantungan DOM.
 *
 * @public
 */
export function createBoard(options: CreateBoardOptions = {}): Board {
  let currentDoc: BoardDocument = options.document
    ? cloneDocument(options.document)
    : createEmptyDocument();
  let camera: CameraState = { x: 0, y: 0, zoom: 1 };

  return {
    getDocument(): Readonly<BoardDocument> {
      return currentDoc;
    },
    loadDocument(doc: BoardDocument): void {
      currentDoc = cloneDocument(doc);
    },
    getElement(id: string): Readonly<ElementRecord> | undefined {
      const rec = currentDoc.records[id];
      return rec?.kind === 'element' ? rec : undefined;
    },
    getCamera(): Readonly<CameraState> {
      return camera;
    },
    setCamera(patch: Partial<CameraState>): void {
      camera = {
        x: patch.x ?? camera.x,
        y: patch.y ?? camera.y,
        zoom: patch.zoom ?? camera.zoom,
      };
    },
    dispose(): void {
      // Pembersihan listener & state
    },
  };
}
