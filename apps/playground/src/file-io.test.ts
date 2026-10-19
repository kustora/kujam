/**
 * Unit tests for File I/O helpers (BOARD-2403).
 */

import { createBoard, createEmptyDocument } from '@kujam/core';
import { describe, expect, it, vi } from 'vitest';

import { exportDocumentToJson, importDocumentFromJson } from './file-io.js';

describe('BOARD-2403: File I/O', () => {
  it('imports valid JSON document into board', () => {
    const board = createBoard();
    const doc = createEmptyDocument({ title: 'Uji Impor' });
    const jsonString = JSON.stringify(doc);

    const result = importDocumentFromJson(board, jsonString);
    expect(result.success).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(board.getDocument().meta).toEqual({ title: 'Uji Impor' });
    board.dispose();
  });

  it('rejects malformed JSON string', () => {
    const board = createBoard();
    const result = importDocumentFromJson(board, '{ not json');
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('Format file bukan JSON yang valid');
    board.dispose();
  });

  it('rejects invalid document structure', () => {
    const board = createBoard();
    const badDoc = { schemaVersion: -1, meta: {}, records: {} };
    const result = importDocumentFromJson(board, JSON.stringify(badDoc));
    expect(result.success).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
    board.dispose();
  });

  it('exports document as downloadable JSON file', () => {
    const board = createBoard();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    exportDocumentToJson(board, 'uji-ekspor.json');
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
    board.dispose();
  });
});
