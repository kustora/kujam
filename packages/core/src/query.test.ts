import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createEmptyDocument,
  defineElement,
  definePlugin,
  object,
  string,
  type BoardDocument,
} from './index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({
    text: string(),
  }),
  defaults: {
    text: 'catatan',
  },
});

const shapeElement = defineElement({
  type: 'shape',
  version: 1,
  props: object({
    color: string(),
  }),
  defaults: {
    color: 'blue',
  },
});

const testPlugin = definePlugin({
  id: 'test-plugin',
  elements: [noteElement, shapeElement],
});

describe('BOARD-206: board.query', () => {
  it('mengembalikan semua elemen terurut berdasarkan fractional index bila tanpa filter', () => {
    const board = createBoard({ plugins: [testPlugin] });

    board.create({ id: 'el-3', type: 'note', index: 'a2' });
    board.create({ id: 'el-1', type: 'note', index: 'a0' });
    board.create({ id: 'el-2', type: 'shape', index: 'a1' });

    const results = board.query();
    expect(results.map((e) => e.id)).toEqual(['el-1', 'el-2', 'el-3']);
    expect(Object.isFrozen(results)).toBe(true);

    board.dispose();
  });

  it('memfilter berdasarkan type', () => {
    const board = createBoard({ plugins: [testPlugin] });

    board.create({ id: 'n1', type: 'note' });
    board.create({ id: 's1', type: 'shape' });
    board.create({ id: 'n2', type: 'note' });

    const notes = board.query({ type: 'note' });
    expect(notes.map((e) => e.id)).toEqual(['n1', 'n2']);

    const shapes = board.query({ type: 'shape' });
    expect(shapes.map((e) => e.id)).toEqual(['s1']);

    board.dispose();
  });

  it('memfilter berdasarkan pageId', () => {
    const board = createBoard({ plugins: [testPlugin] });

    board.create({ id: 'p1-1', type: 'note', pageId: 'page:main' });
    board.create({ id: 'p2-1', type: 'note', pageId: 'page:other' });

    const mainPage = board.query({ pageId: 'page:main' });
    expect(mainPage.map((e) => e.id)).toEqual(['p1-1']);

    const otherPage = board.query({ pageId: 'page:other' });
    expect(otherPage.map((e) => e.id)).toEqual(['p2-1']);

    board.dispose();
  });

  it('memfilter berdasarkan parentId (termasuk null untuk root)', () => {
    const board = createBoard({ plugins: [testPlugin] });

    board.create({ id: 'root-1', type: 'note', parentId: null });
    board.create({ id: 'child-1', type: 'note', parentId: 'frame-1' });
    board.create({ id: 'child-2', type: 'shape', parentId: 'frame-1' });

    const rootElements = board.query({ parentId: null });
    expect(rootElements.map((e) => e.id)).toEqual(['root-1']);

    const frameChildren = board.query({ parentId: 'frame-1' });
    expect(frameChildren.map((e) => e.id)).toEqual(['child-1', 'child-2']);

    board.dispose();
  });

  it('memfilter berdasarkan inBounds memakai indeks spasial (BoxBounds dan RectBounds)', () => {
    const board = createBoard({ plugins: [testPlugin] });

    // el-1 at (0, 0), size 100x100
    board.create({ id: 'el-1', type: 'note', x: 0, y: 0, w: 100, h: 100 });
    // el-2 at (500, 500), size 100x100
    board.create({ id: 'el-2', type: 'shape', x: 500, y: 500, w: 100, h: 100 });

    // Search the area near (0, 0) in BoxBounds format
    const inTopLeft = board.query({
      inBounds: { minX: -50, minY: -50, maxX: 150, maxY: 150 },
    });
    expect(inTopLeft.map((e) => e.id)).toEqual(['el-1']);

    // Search the area near (500, 500) in RectBounds format
    const inBottomRight = board.query({
      inBounds: { x: 450, y: 450, w: 200, h: 200 },
    });
    expect(inBottomRight.map((e) => e.id)).toEqual(['el-2']);

    // Empty area in the middle
    const inMiddle = board.query({
      inBounds: { x: 200, y: 200, w: 100, h: 100 },
    });
    expect(inMiddle).toEqual([]);

    board.dispose();
  });

  it('menggabungkan inBounds dengan filter type dan parentId', () => {
    const board = createBoard({ plugins: [testPlugin] });

    board.create({ id: 'n1', type: 'note', x: 10, y: 10, w: 50, h: 50, parentId: null });
    board.create({ id: 's1', type: 'shape', x: 20, y: 20, w: 50, h: 50, parentId: null });
    board.create({ id: 'n2', type: 'note', x: 30, y: 30, w: 50, h: 50, parentId: 'frame-x' });

    // Search area (0..100) for type note with parent null only
    const result = board.query({
      type: 'note',
      parentId: null,
      inBounds: { x: 0, y: 0, w: 100, h: 100 },
    });
    expect(result.map((e) => e.id)).toEqual(['n1']);

    board.dispose();
  });

  it('indeks spasial terbarui secara inkremental pada create, update, delete, dan loadDocument', () => {
    const board = createBoard({ plugins: [testPlugin] });

    // 1. Create
    const el = board.create({ id: 'dynamic-el', type: 'note', x: 10, y: 10, w: 20, h: 20 })!;
    expect(board.query({ inBounds: { x: 0, y: 0, w: 50, h: 50 } }).map((e) => e.id)).toEqual([
      'dynamic-el',
    ]);

    // 2. Update (move outside)
    board.update(el.id, { x: 1000, y: 1000 });
    expect(board.query({ inBounds: { x: 0, y: 0, w: 50, h: 50 } })).toEqual([]);
    expect(board.query({ inBounds: { x: 900, y: 900, w: 200, h: 200 } }).map((e) => e.id)).toEqual([
      'dynamic-el',
    ]);

    // 3. Delete
    board.delete(el.id);
    expect(board.query({ inBounds: { x: 900, y: 900, w: 200, h: 200 } })).toEqual([]);

    // 4. loadDocument
    const newDoc = createEmptyDocument();
    newDoc.records['loaded-el'] = {
      id: 'loaded-el',
      kind: 'element',
      type: 'note',
      pageId: 'page:main',
      parentId: null,
      index: 'a0',
      x: 50,
      y: 50,
      rotation: 0,
      w: 30,
      h: 30,
      locked: false,
      opacity: 1,
      props: { text: 'Loaded' },
      meta: {},
    };
    board.loadDocument(newDoc);
    expect(board.query({ inBounds: { x: 0, y: 0, w: 100, h: 100 } }).map((e) => e.id)).toEqual([
      'loaded-el',
    ]);

    board.dispose();
  });

  it('loadDocument menjalankan migrasi plugin berurutan (BOARD-702)', () => {
    const migrationPlugin = definePlugin({
      id: 'migration-plugin',
      elements: [noteElement],
      migrations: {
        0: (doc: BoardDocument) => ({
          ...doc,
          schemaVersion: 1,
          meta: { ...doc.meta, migratedFromLegacy: true },
        }),
      },
    });

    const board = createBoard({ plugins: [migrationPlugin] });
    const legacyDoc = {
      schemaVersion: 0,
      meta: { author: 'Riziq' },
      records: {},
    } as unknown as BoardDocument;

    board.loadDocument(legacyDoc);
    const doc = board.getDocument();
    expect(doc.schemaVersion).toBe(1);
    expect(doc.meta.migratedFromLegacy).toBe(true);
    expect(doc.meta.author).toBe('Riziq');

    board.dispose();
  });

  it('menolak query setelah dispose', () => {
    const board = createBoard({ plugins: [testPlugin] });
    board.dispose();
    expect(() => board.query()).toThrow('Papan sudah di-dispose.');
  });
});
