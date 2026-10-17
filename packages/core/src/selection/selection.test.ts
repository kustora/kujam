import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createEmptyDocument,
  defineElement,
  definePlugin,
  object,
  string,
  type Board,
  type SelectionEvent,
} from '../index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});

const notes = definePlugin({ id: 'notes', elements: [noteElement] });

/** Board with notes `a` (0,0 100×100), `b` (200,0 50×50), and `c` (0,300 10×10). */
function setup(options: Parameters<typeof createBoard>[0] = {}): {
  board: Board;
  events: SelectionEvent[];
} {
  const board = createBoard({ plugins: [notes], ...options });
  board.create({ id: 'a', type: 'note', x: 0, y: 0, w: 100, h: 100 });
  board.create({ id: 'b', type: 'note', x: 200, y: 0, w: 50, h: 50 });
  board.create({ id: 'c', type: 'note', x: 0, y: 300, w: 10, h: 10 });
  const events: SelectionEvent[] = [];
  board.on('selection', (e) => events.push(e));
  return { board, events };
}

describe('BOARD-405: selection state', () => {
  it('starts empty with no bounds', () => {
    const { board } = setup();
    expect(board.selection).toEqual([]);
    expect(board.selectionBounds).toBeNull();
  });

  it('select replaces the selection, keeps order, and drops duplicates and unknown IDs', () => {
    const { board, events } = setup();
    board.select(['b', 'a', 'b', 'missing']);
    expect(board.selection).toEqual(['b', 'a']);
    expect(Object.isFrozen(board.selection)).toBe(true);

    board.select('c');
    expect(board.selection).toEqual(['c']);
    expect(events).toEqual([
      { ids: ['b', 'a'], previous: [] },
      { ids: ['c'], previous: ['b', 'a'] },
    ]);
  });

  it('only selects element records, not pages', () => {
    const { board } = setup();
    board.select(['page:main', 'a']);
    expect(board.selection).toEqual(['a']);
  });

  it('addToSelection appends new IDs and keeps existing positions', () => {
    const { board } = setup();
    board.select(['b']);
    board.addToSelection(['a', 'b', 'c']);
    expect(board.selection).toEqual(['b', 'a', 'c']);
  });

  it('removeFromSelection and clearSelection remove IDs', () => {
    const { board } = setup();
    board.select(['a', 'b', 'c']);
    board.removeFromSelection('b');
    expect(board.selection).toEqual(['a', 'c']);
    board.clearSelection();
    expect(board.selection).toEqual([]);
  });

  it('emits selection only when the selection actually changes', () => {
    const { board, events } = setup();
    board.select(['a', 'b']);
    const snapshot = board.selection;

    board.select(['a', 'b']);
    board.addToSelection(['a', 'missing']);
    board.removeFromSelection('c');
    expect(events).toHaveLength(1);
    expect(board.selection).toBe(snapshot);

    // Same members in a different order is a change: the order is part of the selection.
    board.select(['b', 'a']);
    expect(events).toHaveLength(2);

    board.clearSelection();
    board.clearSelection();
    board.select([]);
    expect(events).toHaveLength(3);
  });

  it('selectionBounds encloses all selected elements', () => {
    const { board } = setup();
    board.select('a');
    expect(board.selectionBounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    board.select(['a', 'b', 'c']);
    expect(board.selectionBounds).toEqual({ minX: 0, minY: 0, maxX: 250, maxY: 310 });
  });

  it('selectionBounds accounts for rotation', () => {
    const board = createBoard({ plugins: [notes] });
    // 100×200 box at (0, 0), center (50, 100). Rotated 90 degrees it becomes 200×100 around the same center.
    board.create({ id: 'r', type: 'note', x: 0, y: 0, w: 100, h: 200, rotation: 90 });
    board.select('r');
    const bounds = board.selectionBounds!;
    expect(bounds.minX).toBeCloseTo(-50);
    expect(bounds.maxX).toBeCloseTo(150);
    expect(bounds.minY).toBeCloseTo(50);
    expect(bounds.maxY).toBeCloseTo(150);
  });

  it('selectionBounds follows element updates', () => {
    const { board } = setup();
    board.select('b');
    board.update('b', { x: 1000 });
    expect(board.selectionBounds).toEqual({ minX: 1000, minY: 0, maxX: 1050, maxY: 50 });
  });

  it('is not part of the document and not recorded in undo history', () => {
    const { board } = setup();
    const doc = board.getDocument();
    const canUndo = board.history.canUndo;
    board.history.clear();

    board.select(['a', 'b']);
    expect(board.getDocument()).toBe(doc);
    expect(board.history.canUndo).toBe(false);
    expect(canUndo).toBe(true);

    // Undo of a document change does not touch the selection of surviving elements.
    board.update('c', { x: 5 });
    board.undo();
    expect(board.selection).toEqual(['a', 'b']);
  });

  it('drops locally deleted elements and emits once', () => {
    const { board, events } = setup();
    board.select(['a', 'b', 'c']);
    events.length = 0;

    board.delete(['a', 'c']);
    expect(board.selection).toEqual(['b']);
    expect(events).toEqual([{ ids: ['b'], previous: ['a', 'b', 'c'] }]);
  });

  it('drops remotely deleted elements', () => {
    const { board } = setup();
    board.select(['a', 'b']);
    board.transact((tx) => tx.remove('a'), { origin: 'remote' });
    expect(board.selection).toEqual(['b']);
  });

  it('drops elements removed by undo', () => {
    const board = createBoard({ plugins: [notes] });
    board.create({ id: 'n', type: 'note' });
    board.select('n');
    board.undo();
    expect(board.getElement('n')).toBeUndefined();
    expect(board.selection).toEqual([]);
  });

  it('drops elements missing from a loaded document', () => {
    const { board, events } = setup();
    board.select(['a', 'b']);
    events.length = 0;

    const doc = createEmptyDocument();
    const b = board.getElement('b')!;
    board.loadDocument({ ...doc, records: { ...doc.records, b } });
    expect(board.selection).toEqual(['b']);
    expect(events).toHaveLength(1);
  });

  it('does not emit for changes that leave selected elements in place', () => {
    const { board, events } = setup();
    board.select('a');
    events.length = 0;
    board.update('a', { x: 10 });
    board.delete('b');
    expect(events).toHaveLength(0);
  });

  it('change listeners see the document before the selection is pruned', () => {
    const { board } = setup();
    board.select('a');
    let seen: readonly string[] = [];
    board.on('change', () => {
      seen = board.selection;
    });
    board.delete('a');
    expect(seen).toEqual(['a']);
    expect(board.selection).toEqual([]);
  });

  it('handles IDs that collide with Object.prototype keys', () => {
    const board = createBoard({ plugins: [notes] });
    board.create({ id: 'toString', type: 'note' });
    board.create({ id: 'constructor', type: 'note' });
    board.select(['toString', 'constructor']);
    board.delete('constructor');
    expect(board.selection).toEqual(['toString']);
  });

  it('works on readOnly boards', () => {
    const source = setup().board.getDocument();
    const board = createBoard({ plugins: [notes], document: source, readOnly: true });
    board.select(['a', 'c']);
    expect(board.selection).toEqual(['a', 'c']);
  });

  it('rejects invalid arguments and calls after dispose', () => {
    const { board } = setup();
    expect(() => board.select(42 as never)).toThrow(TypeError);
    expect(() => board.addToSelection([1] as never)).toThrow(TypeError);
    expect(() => board.removeFromSelection(null as never)).toThrow(TypeError);

    board.dispose();
    expect(() => board.select('a')).toThrow('Papan sudah di-dispose.');
    expect(() => board.clearSelection()).toThrow('Papan sudah di-dispose.');
  });

  it('a throwing selection listener does not break the operation', () => {
    const { board } = setup();
    const errors: unknown[] = [];
    board.on('error', (e) => errors.push(e.code));
    board.on('selection', () => {
      throw new Error('boom');
    });
    board.select('a');
    expect(board.selection).toEqual(['a']);
    expect(errors).toEqual(['listener-error']);
  });
});
