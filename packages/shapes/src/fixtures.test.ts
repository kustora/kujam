/**
 * Tests shapes props validation for release document fixtures (BOARD-704).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElementRegistry, validateDocument, type BoardDocument } from '@kujam/core';
import { describe, expect, it } from 'vitest';

import { defaultElements } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../../fixtures/documents');

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

describe('BOARD-704: Shapes Props Validation on Release Fixtures', () => {
  const registry = createElementRegistry(defaultElements.elements);
  const fixturePaths = findJsonFiles(FIXTURES_DIR);

  for (const filePath of fixturePaths) {
    const relativeName = filePath.slice(FIXTURES_DIR.length + 1);

    it(`passes element props validation for ${relativeName}`, () => {
      const rawContent = readFileSync(filePath, 'utf8');
      const doc = JSON.parse(rawContent) as BoardDocument;
      const result = validateDocument(doc, registry);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(Object.keys(result.invalidRecords)).toHaveLength(0);
    });
  }
});
