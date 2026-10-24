/**
 * Unit tests for File I/O helpers (BOARD-2403).
 */

import { createBoard, createEmptyDocument } from '@kujam/core';
import { defaultElements } from '@kujam/shapes';
import { describe, expect, it, vi } from 'vitest';

import {
  createFileIoControls,
  exportDocumentToJson,
  importDocumentFromJson,
  importExcalidrawFromText,
} from './file-io.js';

const EXCALIDRAW = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [
    { id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
    { id: 'e', type: 'embeddable', x: 0, y: 0, width: 10, height: 10 },
  ],
  files: {},
});

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

  it('BOARD-1706: imports Excalidraw into the current page, keeping existing content', () => {
    const board = createBoard({ plugins: [defaultElements] });
    board.create({ id: 'keep', type: 'geo', x: 0, y: 0, w: 10, h: 10 });
    const result = importExcalidrawFromText(board, EXCALIDRAW);
    expect(result).toMatchObject({ success: true, imported: 1 });
    expect(result.warnings).toHaveLength(1);
    expect(board.getElement('keep')).toBeDefined();
    expect(board.query({}).length).toBe(2);
    board.dispose();
  });

  it('BOARD-1706: rejects non-Excalidraw files and invalid JSON', () => {
    const board = createBoard();
    expect(importExcalidrawFromText(board, JSON.stringify(createEmptyDocument()))).toMatchObject({
      success: false,
    });
    expect(importExcalidrawFromText(board, '{ nope')).toMatchObject({ success: false });
    board.dispose();
  });

  it('BOARD-1706: the controls have a separate Excalidraw import button', () => {
    const board = createBoard();
    const controls = createFileIoControls(() => board);
    const labels = [...controls.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual([
      '📥 Impor Dokumen (.json)',
      '🧩 Impor Excalidraw (.excalidraw)',
      '📤 Ekspor Dokumen (.json)',
    ]);
    board.dispose();
  });
});
