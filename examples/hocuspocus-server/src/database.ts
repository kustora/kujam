/**
 * SQLite persistence layer for binary Yjs document state (BOARD-1510).
 *
 * Persists and loads binary Yjs document state blobs using `better-sqlite3`.
 * Supports both on-disk database files and in-memory databases (`:memory:`).
 *
 * @packageDocumentation
 */

import DatabaseConstructor, { type Database as SQLiteDatabase } from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { compactUpdate } from '@kujam/sync-yjs';

/**
 * Options for configuring the SQLite persistence database.
 */
export interface DatabaseOptions {
  /**
   * Path to SQLite database file or ':memory:' for transient in-memory storage.
   * Defaults to ':memory:'.
   */
  path?: string;

  /**
   * Custom table name for storing document records.
   * Defaults to 'kujam_documents'.
   */
  tableName?: string;
}

/**
 * Metadata record for a stored document.
 */
export interface StoredDocumentMeta {
  name: string;
  updatedAt: number;
  size: number;
}

/**
 * Result of compacting one stored document (BOARD-1515).
 */
export interface CompactionResult {
  name: string;
  /** Stored size in bytes before compaction. */
  before: number;
  /** Stored size in bytes after compaction. */
  after: number;
}

/**
 * Persistence service for storing and retrieving binary Yjs document states in SQLite.
 */
export class DocumentDatabase {
  private readonly db: SQLiteDatabase;
  private readonly tableName: string;

  constructor(options: DatabaseOptions = {}) {
    const dbPath = options.path ?? ':memory:';
    this.tableName = options.tableName ?? 'kujam_documents';

    // Auto-create parent directory if path is a file
    if (dbPath !== ':memory:') {
      const dir = dirname(dbPath);
      if (dir && dir !== '.') {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseConstructor(dbPath);

    // Optimize SQLite with WAL mode if file-backed
    if (dbPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }

    this.initSchema();
  }

  /**
   * Initializes the document storage table if not already present.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        name TEXT PRIMARY KEY,
        data BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Loads the binary Yjs document state for a given document name.
   *
   * @param documentName - Unique identifier of the document.
   * @returns Uint8Array of the binary Yjs state if found, or null if no record exists.
   */
  loadDocument(documentName: string): Uint8Array | null {
    const stmt = this.db.prepare(`SELECT data FROM "${this.tableName}" WHERE name = ?`);
    const row = stmt.get(documentName) as { data: Buffer } | undefined;

    if (!row || !row.data) {
      return null;
    }

    // Convert Node Buffer to Uint8Array
    return new Uint8Array(row.data.buffer, row.data.byteOffset, row.data.byteLength);
  }

  /**
   * Stores the binary Yjs document state into the database.
   *
   * Upserts the binary data and records the current timestamp.
   *
   * @param documentName - Unique identifier of the document.
   * @param data - Uint8Array containing binary Yjs state or update.
   */
  storeDocument(documentName: string, data: Uint8Array): void {
    const stmt = this.db.prepare(`
      INSERT INTO "${this.tableName}" (name, data, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
    `);

    stmt.run(documentName, Buffer.from(data), Date.now());
  }

  /**
   * Deletes a stored document from the database.
   *
   * @param documentName - Document identifier to remove.
   * @returns True if a record was deleted, false otherwise.
   */
  deleteDocument(documentName: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM "${this.tableName}" WHERE name = ?`);
    const info = stmt.run(documentName);
    return info.changes > 0;
  }

  /**
   * Checks whether a document exists in the database.
   *
   * @param documentName - Document identifier to query.
   * @returns True if document exists.
   */
  hasDocument(documentName: string): boolean {
    const stmt = this.db.prepare(`SELECT 1 FROM "${this.tableName}" WHERE name = ? LIMIT 1`);
    return Boolean(stmt.get(documentName));
  }

  /**
   * Lists all stored documents with their size and last update timestamp.
   *
   * @returns Array of document metadata records.
   */
  listDocuments(): StoredDocumentMeta[] {
    const stmt = this.db.prepare(
      `SELECT name, updated_at AS updatedAt, length(data) AS size FROM "${this.tableName}" ORDER BY updated_at DESC`,
    );
    return stmt.all() as StoredDocumentMeta[];
  }

  /**
   * Re-encodes a stored document state so it stays compact (BOARD-1515): the state is loaded into
   * a garbage-collected `Y.Doc` and encoded again with `compactUpdate` from `@kujam/sync-yjs`.
   * The document keeps its CRDT identity, so connected clients and offline caches are not
   * affected. The row is only rewritten when the result is smaller.
   *
   * @param documentName - Document identifier to compact.
   * @param maxUpdateBytes - Largest stored state accepted for compaction.
   * @returns Sizes before and after, or `null` when the document does not exist.
   */
  compactDocument(documentName: string, maxUpdateBytes?: number): CompactionResult | null {
    const state = this.loadDocument(documentName);
    if (!state) return null;
    const compacted = compactUpdate(state, maxUpdateBytes === undefined ? {} : { maxUpdateBytes });
    if (compacted.byteLength < state.byteLength) {
      this.storeDocument(documentName, compacted);
    }
    return {
      name: documentName,
      before: state.byteLength,
      after: Math.min(state.byteLength, compacted.byteLength),
    };
  }

  /**
   * Compacts every stored document (BOARD-1515), for example from a periodic job. Documents that
   * fail to compact (corrupt or too large) are skipped and reported through `onError`.
   *
   * @param options.skip - Returns `true` for documents to leave alone, for example documents that
   *   are loaded in the server right now (they are re-encoded on every store anyway).
   */
  compactAll(
    options: {
      skip?: (documentName: string) => boolean;
      onError?: (documentName: string, error: unknown) => void;
      maxUpdateBytes?: number;
    } = {},
  ): CompactionResult[] {
    const results: CompactionResult[] = [];
    for (const { name } of this.listDocuments()) {
      if (options.skip?.(name)) continue;
      try {
        const result = this.compactDocument(name, options.maxUpdateBytes);
        if (result) results.push(result);
      } catch (error) {
        options.onError?.(name, error);
      }
    }
    return results;
  }

  /**
   * Closes the SQLite database connection.
   */
  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  /**
   * Access the underlying better-sqlite3 Database instance.
   */
  get rawDb(): SQLiteDatabase {
    return this.db;
  }
}
