/**
 * Tests compatibility and validation for release document fixtures (BOARD-704).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createBoard } from '../index.js';
import { CURRENT_SCHEMA_VERSION, type BoardDocument } from '../types.js';
import { migrateSchema } from './migrations.js';
import { validateDocument } from './validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../../../fixtures/documents');

function findJsonFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findJsonFiles(fullPath));
    } else if (entry.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('BOARD-704: Document Fixtures Compatibility Tests', () => {
  const fixturePaths = findJsonFiles(FIXTURES_DIR);

  it('finds document fixtures in fixtures/documents', () => {
    expect(fixturePaths.length).toBeGreaterThanOrEqual(2);
    expect(fixturePaths.some((p) => p.endsWith('basic.json'))).toBe(true);
    expect(fixturePaths.some((p) => p.endsWith('kitchen-sink.json'))).toBe(true);
  });

  for (const filePath of fixturePaths) {
    const relativeName = filePath.slice(FIXTURES_DIR.length + 1);

    describe(`fixture: ${relativeName}`, () => {
      const rawContent = readFileSync(filePath, 'utf8');
      const doc = JSON.parse(rawContent) as BoardDocument;

      it('passes document structural validation', () => {
        const validation = validateDocument(doc);
        expect(validation.valid).toBe(true);
        expect(validation.errors).toEqual([]);
        expect(Object.keys(validation.invalidRecords)).toHaveLength(0);
      });

      it('runs core schema migrations with zero errors', () => {
        const migrated = migrateSchema(doc);
        expect(migrated).toBeDefined();
        expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      });

      it('loads cleanly into createBoard', () => {
        const board = createBoard({ document: doc });
        expect(board.disposed).toBe(false);
        const loadedDoc = board.getDocument();
        expect(loadedDoc.schemaVersion).toBe(doc.schemaVersion);
        expect(Object.keys(loadedDoc.records).length).toBe(Object.keys(doc.records).length);
        board.dispose();
      });
    });
  }
});
