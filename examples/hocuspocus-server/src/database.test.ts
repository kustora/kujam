/**
 * Unit tests for the SQLite DocumentDatabase persistence module (BOARD-1510).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DocumentDatabase } from './database.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('DocumentDatabase (SQLite)', () => {
  let db: DocumentDatabase;
  let tempDir: string | undefined;

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
      tempDir = undefined;
    }
  });

  it('creates an in-memory database and handles basic CRUD operations', () => {
    db = new DocumentDatabase({ path: ':memory:' });

    // 1. Initial state
    expect(db.hasDocument('doc-1')).toBe(false);
    expect(db.loadDocument('doc-1')).toBeNull();
    expect(db.listDocuments()).toEqual([]);

    // 2. Store document binary data
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    db.storeDocument('doc-1', payload);

    expect(db.hasDocument('doc-1')).toBe(true);
    const loaded = db.loadDocument('doc-1');
    expect(loaded).toBeInstanceOf(Uint8Array);
    expect(Array.from(loaded!)).toEqual([1, 2, 3, 4, 5]);

    // 3. Update existing document (upsert)
    const updatedPayload = new Uint8Array([10, 20, 30]);
    db.storeDocument('doc-1', updatedPayload);

    const reloaded = db.loadDocument('doc-1');
    expect(Array.from(reloaded!)).toEqual([10, 20, 30]);

    // 4. List documents
    const list = db.listDocuments();
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe('doc-1');
    expect(list[0]?.size).toBe(3);
    expect(list[0]?.updatedAt).toBeGreaterThan(0);

    // 5. Delete document
    expect(db.deleteDocument('doc-1')).toBe(true);
    expect(db.hasDocument('doc-1')).toBe(false);
    expect(db.loadDocument('doc-1')).toBeNull();
    expect(db.deleteDocument('doc-1')).toBe(false);
  });

  it('supports file-backed database storage with directory auto-creation', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kujam-test-db-'));
    const filePath = join(tempDir, 'nested', 'test.sqlite');

    db = new DocumentDatabase({ path: filePath });
    db.storeDocument('file-doc', new Uint8Array([99, 100]));
    db.close();

    // Reopen database file
    const db2 = new DocumentDatabase({ path: filePath });
    const loaded = db2.loadDocument('file-doc');
    expect(loaded).toBeDefined();
    expect(Array.from(loaded!)).toEqual([99, 100]);
    db2.close();
  });
});
