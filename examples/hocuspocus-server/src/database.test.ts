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

describe('BOARD-1515: DocumentDatabase compaction', () => {
  it('compacts a stored update log without changing the document', async () => {
    const Y = await import('yjs');
    const db = new DocumentDatabase({ path: ':memory:' });
    try {
      const doc = new Y.Doc();
      const log: Uint8Array[] = [];
      doc.on('update', (update: Uint8Array) => log.push(update));
      const text = doc.getText('t');
      // Edits that delete most of what they insert, like rewriting a note over and over.
      for (let i = 0; i < 500; i++) {
        text.insert(0, `draft ${i} `.repeat(6));
        text.delete(0, 50);
      }
      // A store that appended every update, merged without garbage collection.
      db.storeDocument('doc-log', Y.mergeUpdates(log));
      db.storeDocument('doc-broken', new Uint8Array([1, 2, 3, 250]));

      const errors: string[] = [];
      const results = db.compactAll({
        skip: (name) => name === 'doc-skipped',
        onError: (name) => errors.push(name),
      });
      expect(errors).toEqual(['doc-broken']);
      const result = results.find((r) => r.name === 'doc-log')!;
      expect(result.after).toBeLessThan(result.before);

      const restored = new Y.Doc();
      Y.applyUpdate(restored, db.loadDocument('doc-log')!);
      expect(restored.getText('t').toString()).toBe(text.toString());
      expect(Y.encodeStateVector(restored)).toEqual(Y.encodeStateVector(doc));
      expect(db.compactDocument('missing')).toBeNull();
    } finally {
      db.close();
    }
  });
});
