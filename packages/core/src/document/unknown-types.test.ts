import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createEmptyDocument,
  defineElement,
  definePlugin,
  object,
  string,
  type BoardDocument,
  type BoardErrorEvent,
  type ElementRecord,
} from '../index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});
const notes = definePlugin({ id: 'notes', elements: [noteElement] });

/** Props a third-party plugin might store: nested data, unicode, empty values, odd keys. */
const foreignProps = {
  title: 'Kartu 📌 — ünïcode',
  nested: { list: [1, 'two', { three: [3] }], empty: {}, nil: null },
  flag: false,
  zero: 0,
  'key with spaces': 'ok',
};

function foreignElement(overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id: 'ext-1',
    kind: 'element',
    type: 'vendor.kanban-card',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 10,
    y: 20,
    rotation: 0,
    w: 120,
    h: 80,
    locked: false,
    opacity: 1,
    props: structuredClone(foreignProps),
    meta: { owner: 'plugin-x' },
    ...overrides,
  };
}

function docWith(...elements: ElementRecord[]): BoardDocument {
  const doc = createEmptyDocument();
  const records: BoardDocument['records'] = { ...doc.records };
  for (const el of elements) records[el.id] = el;
  return { ...doc, records };
}

/** Serializes and parses like a storage adapter would. */
function roundTrip(doc: BoardDocument): BoardDocument {
  return JSON.parse(JSON.stringify(doc)) as BoardDocument;
}

describe('BOARD-209: elements with unregistered types are preserved', () => {
  it('loads unregistered types as-is without props validation (initial document)', () => {
    const board = createBoard({ plugins: [notes], document: docWith(foreignElement()) });
    const el = board.getElement('ext-1');
    expect(el).toBeDefined();
    expect(el!.props).toEqual(foreignProps);
    expect(el!.meta).toEqual({ owner: 'plugin-x' });
    expect(board.elements.get('vendor.kanban-card')).toBeUndefined();
  });

  it('loads unregistered types as-is through loadDocument, without error events', () => {
    const board = createBoard({ plugins: [notes] });
    const errors: BoardErrorEvent[] = [];
    board.on('error', (e) => errors.push(e));
    board.loadDocument(docWith(foreignElement()));
    expect(board.getElement('ext-1')!.props).toEqual(foreignProps);
    expect(errors).toEqual([]);
  });

  it('is found by query and the spatial index as a plain box', () => {
    const board = createBoard({ plugins: [notes], document: docWith(foreignElement()) });
    expect(board.query({ type: 'vendor.kanban-card' }).map((e) => e.id)).toEqual(['ext-1']);
    expect(board.spatial.getBounds('ext-1')).toEqual({ minX: 10, minY: 20, maxX: 130, maxY: 100 });
    expect(board.query({ inBounds: { x: 0, y: 0, w: 15, h: 25 } }).map((e) => e.id)).toEqual([
      'ext-1',
    ]);
  });

  it('can be moved, resized, rotated, and locked without touching props', () => {
    const board = createBoard({ plugins: [notes], document: docWith(foreignElement()) });
    const before = board.getElement('ext-1')!;

    const moved = board.update('ext-1', { x: 500, y: 600, w: 300, h: 200, rotation: 45 });
    expect(moved).toMatchObject({ x: 500, y: 600, w: 300, h: 200, rotation: 45 });
    expect(moved!.props).toEqual(before.props);

    board.update('ext-1', { locked: true });
    expect(board.getElement('ext-1')!.locked).toBe(true);
    expect(board.getElement('ext-1')!.props).toEqual(foreignProps);
  });

  it('rejects props patches for unregistered types and keeps props unchanged', () => {
    const board = createBoard({ plugins: [notes], document: docWith(foreignElement()) });
    const errors: BoardErrorEvent[] = [];
    board.on('error', (e) => errors.push(e));

    const result = board.update('ext-1', { x: 1, props: { title: 'changed' } });
    expect(result).toBeUndefined();
    expect(errors.map((e) => e.code)).toEqual(['invalid-props']);
    expect(board.getElement('ext-1')).toMatchObject({ x: 10, props: foreignProps });
  });

  it('can be deleted, and deletion can be undone with identical props', () => {
    const board = createBoard({ plugins: [notes], document: docWith(foreignElement()) });
    expect(board.delete('ext-1')).toEqual(['ext-1']);
    expect(board.getElement('ext-1')).toBeUndefined();

    expect(board.undo()).toBe(true);
    expect(board.getElement('ext-1')!.props).toEqual(foreignProps);
  });

  it('undo and redo of a move keep props identical', () => {
    const board = createBoard({ plugins: [notes], document: docWith(foreignElement()) });
    board.update('ext-1', { x: 999 });
    board.undo();
    expect(board.getElement('ext-1')).toMatchObject({ x: 10, props: foreignProps });
    board.redo();
    expect(board.getElement('ext-1')).toMatchObject({ x: 999, props: foreignProps });
  });

  it('cannot create new elements of an unregistered type', () => {
    const board = createBoard({ plugins: [notes] });
    const errors: BoardErrorEvent[] = [];
    board.on('error', (e) => errors.push(e));
    expect(board.create({ type: 'vendor.kanban-card' })).toBeUndefined();
    expect(errors.map((e) => e.code)).toEqual(['invalid-props']);
  });

  it('round-trips through save and load with identical props (round-trip test)', () => {
    const original = docWith(
      foreignElement(),
      foreignElement({ id: 'ext-2', type: 'other.vendor', index: 'a2', props: { deep: [[[]]] } }),
    );

    // Load, edit unrelated and positional data, save, load again on a second board, save again.
    const first = createBoard({ plugins: [notes], document: roundTrip(original) });
    first.create({ id: 'n1', type: 'note', props: { text: 'hi' } });
    first.update('ext-1', { x: 42 });
    const saved = roundTrip(first.getDocument());

    const second = createBoard({ document: saved });
    const resaved = roundTrip(second.getDocument());

    for (const doc of [saved, resaved]) {
      expect(doc.records['ext-1']).toEqual({ ...original.records['ext-1'], x: 42 });
      expect(doc.records['ext-2']).toEqual(original.records['ext-2']);
    }
    expect(JSON.stringify(resaved.records['ext-1']!)).toBe(JSON.stringify(saved.records['ext-1']!));
  });

  it('cascades deletes to unregistered children and restores them on undo', () => {
    // An unregistered element nested in a registered container is cascaded like any other child.
    const doc = docWith(foreignElement({ id: 'child', parentId: 'frame' }));
    const board = createBoard({ plugins: [notes], document: doc });
    board.create({ id: 'frame', type: 'note' });
    expect([...board.delete('frame')].sort()).toEqual(['child', 'frame']);
    board.undo();
    expect(board.getElement('child')!.props).toEqual(foreignProps);
  });
});
