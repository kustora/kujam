import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  createBoard,
  createEmptyDocument,
  type ElementRecord,
} from './index.js';

describe('@kujam/core (pure Node environment)', () => {
  it('berjalan di environment Node murni tanpa window dan document (BOARD-103)', () => {
    expect(typeof globalThis).toBe('object');
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
  });

  it('membuat dokumen kosong dengan versi skema saat ini dan halaman bawaan', () => {
    const doc = createEmptyDocument({ workspace: 'demo' });
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.meta).toEqual({ workspace: 'demo' });
    expect(doc.records['page:main']).toMatchObject({
      id: 'page:main',
      kind: 'page',
      name: 'Halaman 1',
    });
  });

  it('mengelola dokumen, elemen, dan kamera melalui createBoard', () => {
    const board = createBoard();
    expect(board.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });

    board.setCamera({ x: 120, y: -40, zoom: 1.5 });
    expect(board.getCamera()).toEqual({ x: 120, y: -40, zoom: 1.5 });

    const sampleElement: ElementRecord = {
      id: 'el:1',
      kind: 'element',
      type: 'sticky',
      pageId: 'page:main',
      parentId: null,
      index: 'a1',
      x: 10,
      y: 20,
      rotation: 0,
      w: 200,
      h: 200,
      locked: false,
      opacity: 1,
      props: { text: 'Halo' },
      meta: {},
    };

    const nextDoc = createEmptyDocument();
    nextDoc.records['el:1'] = sampleElement;

    board.loadDocument(nextDoc);
    expect(board.getElement('el:1')).toEqual(sampleElement);
    expect(board.getElement('page:main')).toBeUndefined();
    expect(board.getDocument().records['el:1']).toEqual(sampleElement);

    board.setCamera({});
    expect(board.getCamera()).toEqual({ x: 120, y: -40, zoom: 1.5 });

    const preloaded = createBoard({ document: nextDoc });
    expect(preloaded.getElement('el:1')).toEqual(sampleElement);

    board.dispose();
    preloaded.dispose();
  });
});
