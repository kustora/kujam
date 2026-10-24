/**
 * Integration of the Excalidraw import of `@kujam/export` with the real built-in elements of
 * `@kujam/shapes` (BOARD-1706): every converted element must pass the built-in props schemas.
 * The export package cannot import shapes, so this lives in the playground, which depends on both.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBoard, type Board, type ElementRecord } from '@kujam/core';
import { excalidrawToDocument, importExcalidraw } from '@kujam/export';
import { defaultElements } from '@kujam/shapes';
import { afterEach, describe, expect, it } from 'vitest';
import { importDocumentFromJson } from './file-io.js';

const FIXTURE = readFileSync(
  resolve(__dirname, '../../../fixtures/excalidraw/basic.excalidraw'),
  'utf8',
);

let boards: Board[] = [];
afterEach(() => {
  for (const b of boards) b.dispose();
  boards = [];
});

function board(): Board {
  const b = createBoard({ plugins: [defaultElements] });
  boards.push(b);
  return b;
}

describe('Impor Excalidraw dengan elemen bawaan (BOARD-1706)', () => {
  it('semua elemen hasil konversi lolos skema props bawaan', () => {
    const b = board();
    const result = importExcalidraw(b, FIXTURE);
    expect(result.rejected).toEqual([]);
    expect(result.unsupported.map((u) => u.type)).toEqual(['embeddable']);

    const types = result.ids.map((id) => b.getElement(id)?.type).sort();
    expect(types).toEqual([
      'connector',
      'draw',
      'frame',
      'geo',
      'geo',
      'geo',
      'group',
      'image',
      'line',
      'line',
      'text',
    ]);
  });

  it('konektor tetap terikat ke bentuk dan ikut saat bentuk digeser', () => {
    const b = board();
    const { idMap } = importExcalidraw(b, FIXTURE);
    const arrowId = idMap.get('arrow-1')!;
    const rectId = idMap.get('rect-1')!;
    const before = b.getElement(arrowId)!;
    b.update(rectId, { x: -300 });
    const after = b.getElement(arrowId)!;
    expect(after.x).not.toBe(before.x);
  });

  it('grup menghitung ulang batasnya dari anak', () => {
    const b = board();
    const { idMap } = importExcalidraw(b, FIXTURE);
    const diamond = b.getElement(idMap.get('diamond-1')!)!;
    const group = b.getElement(diamond.parentId!) as ElementRecord;
    expect(group.type).toBe('group');
    // Diamond (0, 300, 120 × 120) and text (200, 330, 180 × 50).
    expect(group).toMatchObject({ x: 0, y: 300, w: 380, h: 120 });
  });

  it('hasil konversi bisa dimuat sebagai dokumen utuh', () => {
    const { document } = excalidrawToDocument(FIXTURE);
    const b = createBoard({ plugins: [defaultElements], document });
    boards.push(b);
    expect(b.query({}).length).toBeGreaterThan(10);
  });

  it('File I/O playground mengenali berkas Excalidraw dan melaporkan yang dilewati', () => {
    const b = board();
    const result = importDocumentFromJson(b, FIXTURE);
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toContain('embed-1');
  });
});
