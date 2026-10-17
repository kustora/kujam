import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createEmptyDocument,
  defineElement,
  definePlugin,
  object,
  string,
  type Board,
  type BoardErrorEvent,
  type ChangeEvent,
  type PageEvent,
  type PermissionHook,
  type SelectionEvent,
} from './index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});

const notes = definePlugin({ id: 'notes', elements: [noteElement] });

function setup(permissions?: PermissionHook): {
  board: Board;
  pageEvents: PageEvent[];
  errors: BoardErrorEvent[];
} {
  const board = createBoard({ plugins: [notes], createId: sequence(), permissions });
  const pageEvents: PageEvent[] = [];
  const errors: BoardErrorEvent[] = [];
  board.on('page', (e) => pageEvents.push(e));
  board.on('error', (e) => errors.push(e));
  return { board, pageEvents, errors };
}

function sequence(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

describe('BOARD-208: pages', () => {
  it('a new board has one page that is current', () => {
    const { board } = setup();
    expect(board.pages.list().map((p) => p.id)).toEqual(['page:main']);
    expect(board.pages.current).toBe('page:main');
    expect(board.pages.get('page:main')).toMatchObject({ kind: 'page', name: 'Halaman 1' });
    expect(board.pages.get('nope')).toBeUndefined();
  });

  it('create adds pages after the last one with a name and order index', () => {
    const { board } = setup();
    const second = board.pages.create()!;
    const third = board.pages.create({ id: 'page:c', name: 'Sketsa', meta: { tag: 1 } })!;
    expect(second).toMatchObject({ id: 'id1', kind: 'page', name: 'Halaman 2' });
    expect(third).toMatchObject({ id: 'page:c', name: 'Sketsa', meta: { tag: 1 } });
    expect(board.pages.list().map((p) => p.id)).toEqual(['page:main', 'id1', 'page:c']);
    // Creating a page does not switch to it.
    expect(board.pages.current).toBe('page:main');
  });

  it('create honors an explicit index for ordering', () => {
    const { board } = setup();
    const main = board.pages.get('page:main')!;
    board.pages.create({ id: 'page:first', index: 'Zz' });
    expect(main.index > 'Zz').toBe(true);
    expect(board.pages.list()[0]!.id).toBe('page:first');
    // The first page by index is not automatically current.
    expect(board.pages.current).toBe('page:main');
  });

  it('create rejects invalid input and used IDs', () => {
    const { board } = setup();
    expect(() => board.pages.create({ name: 5 as never })).toThrow(TypeError);
    expect(() => board.pages.create({ index: '' })).toThrow(TypeError);
    expect(() => board.pages.create(null as never)).toThrow(TypeError);
    board.create({ id: 'el', type: 'note' });
    expect(() => board.pages.create({ id: 'el' })).toThrow('sudah dipakai');
    expect(() => board.pages.create({ id: 'page:main' })).toThrow('sudah dipakai');
  });

  it('rename changes the name, and is undoable like any local change', () => {
    const { board } = setup();
    expect(board.pages.rename('page:main', 'Utama')?.name).toBe('Utama');
    expect(board.pages.rename('missing', 'x')).toBeUndefined();
    board.undo();
    expect(board.pages.get('page:main')?.name).toBe('Halaman 1');
    expect(() => board.pages.rename('page:main', 1 as never)).toThrow(TypeError);
  });

  it('setCurrent switches pages, emits page once, and rejects unknown pages', () => {
    const { board, pageEvents } = setup();
    board.pages.create({ id: 'page:b' });
    board.pages.setCurrent('page:b');
    board.pages.setCurrent('page:b');
    expect(board.pages.current).toBe('page:b');
    expect(pageEvents).toEqual([{ id: 'page:b', previous: 'page:main' }]);
    expect(() => board.pages.setCurrent('missing')).toThrow('tidak ditemukan');
  });

  it('the current page is local state: not in the document and not in undo', () => {
    const { board } = setup();
    board.pages.create({ id: 'page:b' });
    const doc = board.getDocument();
    board.history.clear();
    board.pages.setCurrent('page:b');
    expect(board.getDocument()).toBe(doc);
    expect(board.history.canUndo).toBe(false);
  });

  it('query, hitTest, and create default to the current page', () => {
    const { board } = setup();
    board.pages.create({ id: 'page:b' });
    board.create({ id: 'a1', type: 'note', w: 10, h: 10 });
    board.pages.setCurrent('page:b');
    const b1 = board.create({ id: 'b1', type: 'note', w: 10, h: 10 })!;

    expect(b1.pageId).toBe('page:b');
    expect(board.query().map((e) => e.id)).toEqual(['b1']);
    expect(board.query({ pageId: 'page:main' }).map((e) => e.id)).toEqual(['a1']);
    expect(
      board
        .query({ allPages: true })
        .map((e) => e.id)
        .sort(),
    ).toEqual(['a1', 'b1']);
    expect(board.hitTest({ x: 5, y: 5 })?.id).toBe('b1');
    expect(board.hitTest({ x: 5, y: 5 }, { pageId: 'page:main' })?.id).toBe('a1');
  });

  it('new elements stack per page', () => {
    const { board } = setup();
    board.pages.create({ id: 'page:b' });
    const a = board.create({ type: 'note' })!;
    board.pages.setCurrent('page:b');
    const b = board.create({ type: 'note' })!;
    // Each page has its own layer order, so the first element on each page gets the same index.
    expect(b.index).toBe(a.index);
  });

  it('selection only holds elements of the current page', () => {
    const { board } = setup();
    const selections: SelectionEvent[] = [];
    board.on('selection', (e) => selections.push(e));
    board.pages.create({ id: 'page:b' });
    board.create({ id: 'a1', type: 'note' });
    board.create({ id: 'b1', type: 'note', pageId: 'page:b' });

    board.select(['a1', 'b1']);
    expect(board.selection).toEqual(['a1']);

    // Switching pages clears the selection, before the page event.
    const order: string[] = [];
    board.on('selection', () => order.push('selection'));
    board.on('page', () => order.push('page'));
    board.pages.setCurrent('page:b');
    expect(board.selection).toEqual([]);
    expect(order).toEqual(['selection', 'page']);

    // An element moved to another page leaves the selection.
    board.select('b1');
    board.update('b1', { pageId: 'page:main' });
    expect(board.selection).toEqual([]);
    expect(selections.at(-1)).toEqual({ ids: [], previous: ['b1'] });
  });

  it('delete removes the page with all its elements and bindings in one transaction', () => {
    const { board } = setup();
    board.pages.create({ id: 'page:b' });
    board.create({ id: 'a1', type: 'note' });
    board.create({ id: 'b1', type: 'note', pageId: 'page:b' });
    board.create({ id: 'b2', type: 'note', pageId: 'page:b', locked: true });
    board.create({ id: 'b3', type: 'note', pageId: 'page:b', parentId: 'b1' });
    board.transact((tx) =>
      tx.put({ id: 'bind', kind: 'binding', fromId: 'a1', toId: 'b1', anchor: { x: 0, y: 0 } }),
    );
    const changes: ChangeEvent[] = [];
    board.on('change', (e) => changes.push(e));

    const deleted = board.pages.delete('page:b');
    expect([...deleted].sort()).toEqual(['b1', 'b2', 'b3', 'bind', 'page:b'].sort());
    expect(deleted.at(-1)).toBe('page:b');
    expect(changes).toHaveLength(1);
    expect(Object.keys(changes[0]!.removed).sort()).toEqual([...deleted].sort());
    expect(board.getElement('a1')).toBeDefined();

    // One undo step restores the page and everything on it.
    board.undo();
    expect(board.pages.get('page:b')).toBeDefined();
    expect(board.getElement('b2')).toBeDefined();
    expect(board.getDocument().records['bind']).toBeDefined();
  });

  it('deleting the current page moves to the next page, or the previous one when last', () => {
    const { board, pageEvents } = setup();
    board.pages.create({ id: 'page:b' });
    board.pages.create({ id: 'page:c' });
    board.pages.setCurrent('page:b');
    board.pages.delete('page:b');
    expect(board.pages.current).toBe('page:c');
    board.pages.delete('page:c');
    expect(board.pages.current).toBe('page:main');
    expect(pageEvents.map((e) => e.id)).toEqual(['page:b', 'page:c', 'page:main']);
  });

  it('cannot delete the last page; unknown pages are a no-op', () => {
    const { board } = setup();
    expect(() => board.pages.delete('page:main')).toThrow('Halaman terakhir');
    expect(board.pages.delete('missing')).toEqual([]);
  });

  it('follows pages removed remotely or by loadDocument', () => {
    const { board } = setup();
    board.pages.create({ id: 'page:b' });
    board.pages.create({ id: 'page:c' });
    board.pages.setCurrent('page:b');
    board.transact((tx) => tx.remove('page:b'), { origin: 'remote' });
    expect(board.pages.current).toBe('page:c');

    const doc = createEmptyDocument();
    board.loadDocument(doc);
    expect(board.pages.current).toBe('page:main');

    // A loaded document that still has the current page keeps it.
    board.pages.create({ id: 'page:x' });
    board.pages.setCurrent('page:x');
    board.loadDocument(board.getDocument());
    expect(board.pages.current).toBe('page:x');
  });

  it('starts on the first page of the initial document', () => {
    const doc = createEmptyDocument();
    doc.records['page:zero'] = { id: 'page:zero', kind: 'page', name: '0', index: 'Zz', meta: {} };
    const board = createBoard({ document: doc });
    expect(board.pages.current).toBe('page:zero');
  });

  it('runs page changes through the permission hook', () => {
    let deny = '';
    const { board, errors } = setup((action) => action !== deny);
    board.pages.create({ id: 'page:b' });
    board.create({ id: 'b1', type: 'note', pageId: 'page:b' });

    deny = 'page.create';
    expect(board.pages.create()).toBeUndefined();
    deny = 'page.rename';
    expect(board.pages.rename('page:b', 'x')).toBeUndefined();
    deny = 'page.delete';
    expect(board.pages.delete('page:b')).toEqual([]);
    // Deleting a page also needs `delete` permission for each element on it; nothing is deleted.
    deny = 'delete';
    expect(board.pages.delete('page:b')).toEqual([]);
    expect(board.pages.get('page:b')).toBeDefined();
    expect(board.getElement('b1')).toBeDefined();

    expect(errors.map((e) => e.code)).toEqual(['forbidden', 'forbidden', 'forbidden', 'forbidden']);
    expect(board.pages.list()).toHaveLength(2);
  });

  it('page changes are rejected on readOnly boards, but switching pages is allowed', () => {
    const source = setup().board;
    source.pages.create({ id: 'page:b' });
    const board = createBoard({ document: source.getDocument(), readOnly: true });
    expect(() => board.pages.create()).toThrow();
    expect(() => board.pages.delete('page:b')).toThrow();
    board.pages.setCurrent('page:b');
    expect(board.pages.current).toBe('page:b');
  });

  it('throws after dispose', () => {
    const { board } = setup();
    board.dispose();
    expect(() => board.pages.create()).toThrow('Papan sudah di-dispose.');
    expect(() => board.pages.setCurrent('page:main')).toThrow('Papan sudah di-dispose.');
  });
});
