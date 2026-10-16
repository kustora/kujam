import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_ZOOM_RANGE,
  InvalidDocumentError,
  createBoard,
  createEmptyDocument,
  deepClone,
  validateDocument,
  type BoardDocument,
  type CameraState,
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

function makeElement(overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id: 'el:1',
    kind: 'element',
    type: 'sticky',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 0,
    y: 0,
    rotation: 0,
    w: 100,
    h: 100,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...overrides,
  };
}

describe('snapshot immutable', () => {
  it('getDocument dan getCamera tidak bisa diubah dari luar', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement();
    const board = createBoard({ document: doc });

    const snapshot = board.getDocument() as BoardDocument;
    expect(() => {
      (snapshot.records['el:1'] as ElementRecord).x = 999;
    }).toThrow(TypeError);
    expect(board.getElement('el:1')?.x).toBe(0);

    expect(() => {
      (board.getCamera() as CameraState).zoom = 0;
    }).toThrow(TypeError);
    expect(board.getCamera().zoom).toBe(1);
  });

  it('dokumen masukan tidak ikut terkunci atau terhubung dengan state board', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement();
    const board = createBoard();
    board.loadDocument(doc);

    (doc.records['el:1'] as ElementRecord).x = 50;
    expect(board.getElement('el:1')?.x).toBe(0);
  });
});

describe('setCamera', () => {
  it('mengabaikan nilai tidak berhingga dan menjepit zoom ke batas bawaan', () => {
    const board = createBoard();
    board.setCamera({ x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: Number.NaN });
    expect(board.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });

    board.setCamera({ zoom: 0 });
    expect(board.getCamera().zoom).toBe(DEFAULT_ZOOM_RANGE.min);
    board.setCamera({ zoom: -3 });
    expect(board.getCamera().zoom).toBe(DEFAULT_ZOOM_RANGE.min);
    board.setCamera({ zoom: 100 });
    expect(board.getCamera().zoom).toBe(DEFAULT_ZOOM_RANGE.max);
  });

  it('memakai zoomRange kustom dan menolak rentang yang tidak valid', () => {
    const board = createBoard({ zoomRange: { min: 0.5, max: 2 } });
    board.setCamera({ zoom: 0.1 });
    expect(board.getCamera().zoom).toBe(0.5);
    expect(() => createBoard({ zoomRange: { min: 0, max: 2 } })).toThrow(RangeError);
    expect(() => createBoard({ zoomRange: { min: 3, max: 2 } })).toThrow(RangeError);
  });
});

describe('opsi readOnly dan locale', () => {
  it('diterapkan dan diekspos di board', () => {
    const board = createBoard({ readOnly: true, locale: 'en' });
    expect(board.readOnly).toBe(true);
    expect(board.locale).toBe('en');

    const defaults = createBoard();
    expect(defaults.readOnly).toBe(false);
    expect(defaults.locale).toBe('id');
  });

  it('menolak locale yang tidak didukung', () => {
    expect(() => createBoard({ locale: 'fr' as 'id' })).toThrow(RangeError);
  });
});

describe('validateDocument', () => {
  it('menerima dokumen yang valid', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement();
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ['bukan objek', null],
    ['array', []],
    ['schemaVersion NaN', { schemaVersion: Number.NaN, meta: {}, records: {} }],
    ['schemaVersion negatif', { schemaVersion: -1, meta: {}, records: {} }],
    [
      'schemaVersion dari masa depan',
      { schemaVersion: CURRENT_SCHEMA_VERSION + 1, meta: {}, records: {} },
    ],
    ['records berupa array', { schemaVersion: 1, meta: {}, records: [] }],
    ['record bukan objek', { schemaVersion: 1, meta: {}, records: { x: 42 } }],
    [
      'kind tidak dikenal',
      { schemaVersion: 1, meta: {}, records: { x: { id: 'x', kind: 'foo' } } },
    ],
    ['id tidak sama dengan kunci', { schemaVersion: 1, meta: {}, records: { a: makeElement() } }],
    [
      'koordinat NaN',
      { schemaVersion: 1, meta: {}, records: { 'el:1': makeElement({ x: Number.NaN }) } },
    ],
    [
      'opacity di luar 0..1',
      { schemaVersion: 1, meta: {}, records: { 'el:1': makeElement({ opacity: 2 }) } },
    ],
  ])('menolak %s', (_label, doc) => {
    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('menerima record binding, page, dan asset yang valid', () => {
    const doc = createEmptyDocument();
    doc.records['b:1'] = {
      id: 'b:1',
      kind: 'binding',
      fromId: 'el:1',
      toId: 'el:2',
      anchor: { x: 0.5, y: 1 },
    };
    doc.records['page:2'] = { id: 'page:2', kind: 'page', name: '', index: 'a1', meta: {} };
    doc.records['asset:1'] = {
      id: 'asset:1',
      kind: 'asset',
      mimeType: 'image/png',
      w: 10,
      h: 10,
      meta: {},
    };
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ['binding tanpa anchor', { id: 'r', kind: 'binding', fromId: 'a', toId: 'b' }],
    [
      'binding dengan fromId kosong',
      { id: 'r', kind: 'binding', fromId: '', toId: 'b', anchor: { x: 0, y: 0 } },
    ],
    ['page tanpa index', { id: 'r', kind: 'page', name: 'x', meta: {} }],
    [
      'asset dengan ukuran negatif',
      { id: 'r', kind: 'asset', mimeType: 'image/png', w: -1, h: 1, meta: {} },
    ],
  ])('menolak %s', (_label, rec) => {
    const result = validateDocument({ schemaVersion: 1, meta: {}, records: { r: rec } });
    expect(result.valid).toBe(false);
  });

  it('menolak dokumen tanpa meta', () => {
    expect(validateDocument({ schemaVersion: 1, records: {} }).valid).toBe(false);
  });

  it('createBoard dan loadDocument melempar InvalidDocumentError untuk dokumen rusak', () => {
    const broken = { schemaVersion: 1, meta: {}, records: [] } as unknown as BoardDocument;
    expect(() => createBoard({ document: broken })).toThrow(InvalidDocumentError);
    const board = createBoard();
    expect(() => board.loadDocument(broken)).toThrow(InvalidDocumentError);
    expect(board.getDocument().records['page:main']).toBeDefined();
  });
});

describe('deepClone', () => {
  it('mempertahankan NaN, Infinity, undefined, dan Uint8Array', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const source = {
      a: Number.NaN,
      b: Number.POSITIVE_INFINITY,
      c: undefined,
      d: bytes,
      e: [1, { f: 2 }],
    };
    const copy = deepClone(source);
    expect(copy).toEqual(source);
    expect('c' in copy).toBe(true);
    expect(copy.d).not.toBe(bytes);
    expect(copy.e[1]).not.toBe(source.e[1]);
  });

  it('snapshot tetap bisa dibuat untuk dokumen yang memuat Uint8Array di meta', () => {
    const doc = createEmptyDocument({ thumbnail: new Uint8Array([1]) });
    const board = createBoard({ document: doc });
    expect(Object.isFrozen(board.getDocument().meta)).toBe(true);
    expect(board.getDocument().meta.thumbnail).toEqual(new Uint8Array([1]));
  });
});
