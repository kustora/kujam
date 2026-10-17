import {
  createBoard,
  createEmptyDocument,
  defineElement,
  definePlugin,
  InvalidDocumentError,
  MigrationError,
  number,
  object,
  string,
  type Board,
  type BoardDocument,
  type ChangeEvent,
  type ElementRecord,
} from '@kujam/core';
import { describe, expect, it } from 'vitest';
import { exportJSON, ImportError, importJSON } from './index.js';

const note = defineElement({
  type: 'note',
  version: 2,
  props: object({ text: string(), size: number() }),
  defaults: { text: '', size: 1 },
  migrate: { 1: (props) => ({ ...props, size: 1 }) },
});
const notes = definePlugin({ id: 'notes', elements: [note] });

function boardWith(...ids: string[]): Board {
  const board = createBoard({ plugins: [notes] });
  ids.forEach((id, i) => board.create({ id, type: 'note', x: i * 100, y: 0, w: 50, h: 50 }));
  return board;
}

function element(id: string, extra: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'note',
    pageId: 'page:main',
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    rotation: 0,
    w: 10,
    h: 10,
    locked: false,
    opacity: 1,
    props: { text: id, size: 1 },
    typeVersion: 2,
    meta: {},
    ...extra,
  };
}

function docWith(...records: BoardDocument['records'][string][]): BoardDocument {
  const doc = createEmptyDocument();
  for (const rec of records) doc.records[rec.id] = rec;
  return doc;
}

describe('BOARD-1701: exportJSON', () => {
  it('exports the whole document as an unlinked copy', () => {
    const board = boardWith('a', 'b');
    const json = exportJSON(board);
    expect(json).toEqual(board.getDocument());
    expect(json).not.toBe(board.getDocument());
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('exports selected elements with descendants, bindings, pages, and referenced assets', () => {
    const board = boardWith();
    board.transact((tx) => {
      tx.put(element('frame', { index: 'a0' }));
      tx.put(element('child', { parentId: 'frame', index: 'a1' }));
      tx.put(element('grandchild', { parentId: 'child', index: 'a2' }));
      tx.put(element('outside', { index: 'a3', props: { text: 'asset:1', size: 1 } }));
      tx.put(element('orphan', { parentId: 'outside', index: 'a4' }));
      tx.put({
        id: 'b-in',
        kind: 'binding',
        fromId: 'child',
        toId: 'grandchild',
        anchor: { x: 0, y: 0 },
      });
      tx.put({
        id: 'b-out',
        kind: 'binding',
        fromId: 'child',
        toId: 'outside',
        anchor: { x: 0, y: 0 },
      });
      tx.put({ id: 'asset:1', kind: 'asset', mimeType: 'image/png', w: 1, h: 1, meta: {} });
      tx.put({ id: 'asset:2', kind: 'asset', mimeType: 'image/png', w: 1, h: 1, meta: {} });
    });

    const json = exportJSON(board, { ids: ['frame', 'orphan', 'missing', 'page:main'] });
    expect(Object.keys(json.records).sort()).toEqual(
      ['b-in', 'child', 'frame', 'grandchild', 'orphan', 'page:main'].sort(),
    );
    // The parent of `orphan` is not exported, so it becomes a root element.
    expect((json.records['orphan'] as ElementRecord).parentId).toBeNull();
    expect((json.records['child'] as ElementRecord).parentId).toBe('frame');

    const withAsset = exportJSON(board, { ids: ['outside'] });
    expect(Object.keys(withAsset.records).sort()).toEqual([
      'asset:1',
      'orphan',
      'outside',
      'page:main',
    ]);
  });

  it('rejects invalid ids', () => {
    const board = boardWith('a');
    expect(() => exportJSON(board, { ids: 'a' as never })).toThrow(TypeError);
    expect(() => exportJSON(board, { ids: [1] as never })).toThrow(TypeError);
  });
});

describe('BOARD-1701: importJSON into an empty board', () => {
  it('keeps IDs, pages, and indexes, as one undoable local transaction', () => {
    const source = boardWith('a', 'b');
    source.pages.create({ id: 'page:2', name: 'Dua' });
    source.create({ id: 'c', type: 'note', pageId: 'page:2' });
    const text = JSON.stringify(exportJSON(source));

    const target = createBoard({ plugins: [notes] });
    const changes: ChangeEvent[] = [];
    target.on('change', (e) => changes.push(e));
    const result = importJSON(target, text);

    expect(result.keptIds).toBe(true);
    expect([...result.ids].sort()).toEqual(['a', 'b', 'c']);
    expect(target.getElement('c')?.pageId).toBe('page:2');
    expect(target.pages.get('page:2')?.name).toBe('Dua');
    expect(target.getElement('a')?.index).toBe(source.getElement('a')?.index);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ origin: 'local', label: 'import' });

    target.undo();
    expect(target.query({ allPages: true })).toEqual([]);
  });

  it('round-trips export and import', () => {
    const source = boardWith('a', 'b');
    const target = createBoard({ plugins: [notes] });
    importJSON(target, exportJSON(source));
    expect(target.getDocument().records).toEqual(source.getDocument().records);
  });
});

describe('BOARD-1701: importJSON into a board with elements', () => {
  it('pastes with new IDs on the current page, above existing elements, keeping order', () => {
    const source = boardWith();
    source.transact((tx) => {
      tx.put(element('frame', { index: 'a5' }));
      tx.put(element('child', { parentId: 'frame', index: 'a6' }));
      tx.put({
        id: 'bind',
        kind: 'binding',
        fromId: 'frame',
        toId: 'child',
        anchor: { x: 0, y: 0 },
      });
    });
    const target = boardWith('existing');
    target.pages.create({ id: 'page:2' });
    target.create({ id: 'on-page-2', type: 'note', pageId: 'page:2' });
    target.pages.setCurrent('page:2');

    const result = importJSON(target, exportJSON(source));
    expect(result.keptIds).toBe(false);
    const frameId = result.idMap.get('frame')!;
    const childId = result.idMap.get('child')!;
    expect(frameId).not.toBe('frame');
    expect(result.ids).toEqual([frameId, childId]);

    const frame = target.getElement(frameId)!;
    const child = target.getElement(childId)!;
    expect(frame.pageId).toBe('page:2');
    expect(child.parentId).toBe(frameId);
    expect(frame.index > target.getElement('on-page-2')!.index).toBe(true);
    expect(child.index > frame.index).toBe(true);

    const binding = target.getDocument().records[result.idMap.get('bind')!];
    expect(binding).toMatchObject({ kind: 'binding', fromId: frameId, toId: childId });
    // The source elements were not overwritten.
    expect(target.getElement('existing')).toBeDefined();
  });

  it('pasting the same content twice creates two copies', () => {
    const board = boardWith('a');
    const json = exportJSON(board, { ids: ['a'] });
    importJSON(board, json);
    importJSON(board, json);
    expect(board.query()).toHaveLength(3);
  });

  it('places the center of the content at `at`', () => {
    const source = boardWith();
    source.transact((tx) => {
      tx.put(element('l', { x: 0, y: 0, w: 10, h: 10 }));
      tx.put(element('r', { x: 90, y: 40, w: 10, h: 10, index: 'a1' }));
    });
    const target = boardWith('existing');
    const result = importJSON(target, exportJSON(source), { at: { x: 500, y: 500 } });
    const [l, r] = result.ids.map((id) => target.getElement(id)!);
    expect(l).toMatchObject({ x: 450, y: 475 });
    expect(r).toMatchObject({ x: 540, y: 515 });
    expect(() => importJSON(target, exportJSON(source), { at: { x: NaN, y: 0 } })).toThrow(
      TypeError,
    );
  });
});

describe('BOARD-1701: importJSON validation (same path as loadDocument)', () => {
  it('drops invalid records and reports them', () => {
    const board = createBoard({ plugins: [notes] });
    const bad = element('bad', { props: { text: 42, size: 1 } as never });
    const result = importJSON(board, docWith(element('ok'), bad));
    expect(result.ids).toEqual(['ok']);
    expect(result.rejected.map((r) => r.id)).toEqual(['bad']);
    expect(result.rejected[0]!.errors.join(' ')).toContain('props');
  });

  it('migrates old element versions on import', () => {
    const board = boardWith('existing');
    const old = element('old', { typeVersion: 1, props: { text: 'x' } as never });
    const result = importJSON(board, docWith(old));
    expect(board.getElement(result.ids[0]!)).toMatchObject({
      typeVersion: 2,
      props: { text: 'x', size: 1 },
    });
  });

  it('throws and leaves the board unchanged for invalid input', () => {
    const board = boardWith('a');
    const before = board.getDocument();
    expect(() => importJSON(board, '{not json')).toThrow(InvalidDocumentError);
    expect(() => importJSON(board, { records: {} })).toThrow(InvalidDocumentError);
    expect(() => importJSON(board, null)).toThrow(InvalidDocumentError);
    expect(board.getDocument()).toBe(before);
  });

  it('propagates migration failures without changing the board', () => {
    const broken = defineElement({
      type: 'broken',
      version: 2,
      props: object({ v: number() }),
      defaults: { v: 1 },
      migrate: {
        1: () => {
          throw new Error('boom');
        },
      },
    });
    const board = createBoard({ plugins: [definePlugin({ id: 'b', elements: [broken] })] });
    const before = board.getDocument();
    const old = { ...element('x'), type: 'broken', typeVersion: 1, props: { v: 1 } };
    expect(() => importJSON(board, docWith(old))).toThrow(MigrationError);
    expect(board.getDocument()).toBe(before);
  });

  it('rejects content from a newer version', () => {
    const board = boardWith('a');
    const before = board.getDocument();
    const future = element('future', { typeVersion: 9 });
    let error: unknown;
    try {
      importJSON(board, docWith(future));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).code).toBe('document-too-new');
    expect((error as ImportError).reason).toMatchObject({ kind: 'element', type: 'note' });
    expect(board.getDocument()).toBe(before);
    expect(board.readOnly).toBe(false);
  });

  it('enforces the element limit, permissions, and read-only mode', () => {
    const limited = createBoard({ plugins: [notes], limits: { maxElements: 2 } });
    limited.create({ type: 'note' });
    expect(() => importJSON(limited, docWith(element('a'), element('b', { index: 'a1' })))).toThrow(
      expect.objectContaining({ code: 'limit-exceeded' }),
    );

    const guarded = createBoard({
      plugins: [notes],
      permissions: (action, el) => !(action === 'create' && el?.props.text === 'secret'),
    });
    const doc = docWith(element('ok'), element('secret', { index: 'a1' }));
    expect(() => importJSON(guarded, doc)).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(guarded.query()).toEqual([]);

    const readOnly = createBoard({ plugins: [notes], readOnly: true });
    expect(() => importJSON(readOnly, docWith(element('a')))).toThrow(
      expect.objectContaining({ code: 'read-only' }),
    );
  });
});
