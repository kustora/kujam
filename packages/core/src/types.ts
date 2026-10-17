/**
 * Board document types and adapter contracts.
 */

/**
 * Current board document schema version.
 *
 * @public
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Element record stored in the flat board document.
 *
 * @public
 */
export interface ElementRecord<P = Record<string, unknown>> {
  /** Unique ID, generated on the client (see `createId`). */
  id: string;
  kind: 'element';
  /** Element type, for example `'sticky'`, `'draw'`, `'geo'`, or a custom type. */
  type: string;
  /** ID of the page the element is on. */
  pageId: string;
  /** ID of the parent frame or group, or `null` when directly on the page. */
  parentId: string | null;
  /** Fractional index for layer order (see `indexBetween`). */
  index: string;
  x: number;
  y: number;
  rotation: number;
  w: number;
  h: number;
  locked: boolean;
  /** Opacity from 0 to 1. */
  opacity: number;
  /** Type-specific content, validated by the type schema. */
  props: P;
  /**
   * Version of the element type (`version` in `defineElement`) that `props` were written for
   * (BOARD-702). Missing means `1`. `board.create` and props migrations set it; code that writes
   * element records with `tx.put` should set it too, or newer props may be migrated again on load.
   */
  typeVersion?: number;
  /** Free for consumers; the package never reads or changes its content. */
  meta: Record<string, unknown>;
}

/**
 * Connector/binding record between elements.
 *
 * @public
 */
export interface BindingRecord {
  id: string;
  kind: 'binding';
  fromId: string;
  toId: string;
  /** Relative position 0..1 on the edge of the target element. */
  anchor: { x: number; y: number };
}

/**
 * Page record within the board.
 *
 * @public
 */
export interface PageRecord {
  id: string;
  kind: 'page';
  name: string;
  /** Fractional index for page order. */
  index: string;
  /** Free for consumers; the package never reads or changes its content. */
  meta: Record<string, unknown>;
}

/**
 * Media asset record within the board.
 *
 * @public
 */
export interface AssetRecord {
  id: string;
  kind: 'asset';
  mimeType: string;
  w: number;
  h: number;
  /** Free for consumers; the package never reads or changes its content. */
  meta: Record<string, unknown>;
}

/**
 * Union of every record kind in a board document.
 *
 * @public
 */
export type BoardRecord = ElementRecord | BindingRecord | PageRecord | AssetRecord;

/**
 * Versioned board document holding a flat collection of records.
 *
 * @public
 */
export interface BoardDocument {
  /** Schema version; incremented with every migration. See {@link CURRENT_SCHEMA_VERSION}. */
  schemaVersion: number;
  /** Free for consumers; the package never reads or changes its content. */
  meta: Record<string, unknown>;
  /** Flat collection of records, keyed by record `id`. */
  records: Record<string, BoardRecord>;
  /**
   * Document migration version per plugin ID (BOARD-702): how many of the plugin's `migrations`
   * steps this document has been through. A missing plugin entry means `0`.
   */
  pluginVersions?: Record<string, number>;
}

/**
 * Board camera configuration.
 *
 * @public
 */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Change handed to a storage adapter: the full JSON document,
 * a binary update (for example Yjs state), or both.
 *
 * @public
 */
export interface StorageChange {
  document?: BoardDocument;
  update?: Uint8Array;
}

/**
 * Board storage adapter contract. Implemented by `@kujam/storage-*`
 * or by consumer-written adapters.
 *
 * @public
 */
export interface StorageAdapter {
  load(boardId: string): Promise<BoardDocument | Uint8Array | null>;
  save(boardId: string, change: StorageChange): Promise<void>;
  /** Autosave debounce delay in milliseconds (defaults to 1000). */
  debounceMs?: number;
}
