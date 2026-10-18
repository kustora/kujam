import { describe, expect, it } from 'vitest';
import {
  ContentError,
  createBoard,
  defineElement,
  definePlugin,
  insertContent,
  object,
  parseClipboard,
  serializeClipboard,
  string,
  type Board,
} from '../index.js';

const note = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
  export: { text: (el) => el.props.text },
});
const silent = defineElement({
  type: 'silent',
  version: 1,
  props: object({}),
  defaults: {},
});
const broken = defineElement({
  type: 'broken',
  version: 1,
  props: object({}),
  defaults: {},
  export: {
    text: () => {
      throw new Error('boom');
    },
  },
});
const notes = definePlugin({ id: 'notes', elements: [note, silent, broken] });
const custom = defineElement({ type: 'custom', version: 1, props: object({}), defaults: {} });
const customPlugin = definePlugin({ id: 'custom', elements: [custom] });

function boardWith(...plugins: (typeof customPlugin)[]): Board {
  return createBoard({ plugins: [notes, ...plugins] });
}

function addNote(board: Board, text: string, x: number, y: number, extra: object = {}) {
  return board.create({ type: 'note', x, y, w: 100, h: 50, props: { text }, ...extra })!;
}

function payloadOf(board: Board, ids?: readonly string[]) {
  const payload = serializeClipboard(board, ids);
  if (!payload) throw new Error('expected a payload');
  return payload;
}

describe('BOARD-906: serializeClipboard', () => {
  it('copies the selection by default, with board JSON and plain text', () => {
    const board = boardWith();
    const a = addNote(board, 'Ide pertama', 0, 0);
    addNote(board, 'not copied', 500, 0);
    board.select([a.id]);

    const payload = payloadOf(board);
    expect(payload.ids).toEqual([a.id]);
    expect(payload.text).toBe('Ide pertama');
    expect(parseClipboard(payload.json)?.records[a.id]).toMatchObject({ id: a.id, type: 'note' });
  });

  it('writes element text in reading order and skips empty or failing exporters', () => {
    const board = boardWith();
    const bottom = addNote(board, 'Bawah', 0, 200);
    const topRight = addNote(board, 'Atas kanan', 300, 0);
    const topLeft = addNote(board, 'Atas kiri', 0, 0);
    const empty = addNote(board, '   ', 0, 100);
    const silentEl = board.create({ type: 'silent', x: 0, y: 50 })!;
    const brokenEl = board.create({ type: 'broken', x: 0, y: 60 })!;

    const payload = payloadOf(board, [
      bottom.id,
      topRight.id,
      topLeft.id,
      empty.id,
      silentEl.id,
      brokenEl.id,
    ]);
    expect(payload.text).toBe('Atas kiri\nAtas kanan\nBawah');
    expect(payload.ids).toHaveLength(6);
  });

  it('includes descendants and bindings between copied elements only', () => {
    const board = boardWith();
    const frame = addNote(board, 'frame', 0, 0);
    const child = addNote(board, 'child', 10, 10, { parentId: frame.id });
    const other = addNote(board, 'other', 400, 0);
    board.transact((tx) => {
      tx.put({
        id: 'bind-in',
        kind: 'binding',
        fromId: frame.id,
        toId: child.id,
        anchor: { x: 0, y: 0 },
      });
      tx.put({
        id: 'bind-out',
        kind: 'binding',
        fromId: frame.id,
        toId: other.id,
        anchor: { x: 1, y: 1 },
      });
    });

    const doc = parseClipboard(payloadOf(board, [frame.id]).json)!;
    expect(Object.keys(doc.records).sort()).toEqual(
      [frame.id, child.id, 'bind-in', board.pages.current].sort(),
    );
  });

  it('returns null when nothing copyable is given', () => {
    const board = boardWith();
    expect(serializeClipboard(board)).toBeNull();
    expect(serializeClipboard(board, ['missing'])).toBeNull();
  });
});

describe('BOARD-906: parseClipboard', () => {
  it('reads only the board envelope', () => {
    const board = boardWith();
    const a = addNote(board, 'x', 0, 0);
    const payload = payloadOf(board, [a.id]);

    expect(parseClipboard(payload.json)).not.toBeNull();
    expect(parseClipboard('just some text')).toBeNull();
    expect(parseClipboard('{"kind":"kujam/clipboard"')).toBeNull();
    expect(parseClipboard(JSON.stringify({ kind: 'other', version: 1, document: {} }))).toBeNull();
    expect(
      parseClipboard(JSON.stringify({ kind: 'kujam/clipboard', version: 99, document: {} })),
    ).toBeNull();
    expect(
      parseClipboard(JSON.stringify({ kind: 'kujam/clipboard', version: 1, document: [] })),
    ).toBeNull();
  });
});

describe('BOARD-906: insertContent', () => {
  function copyFrom(board: Board, ids: readonly string[]) {
    return parseClipboard(payloadOf(board, ids).json)!;
  }

  it('pastes with new IDs, remapped parents and bindings, above existing elements', () => {
    const source = boardWith();
    const frame = addNote(source, 'frame', 0, 0);
    const child = addNote(source, 'child', 10, 10, { parentId: frame.id });
    source.transact((tx) => {
      tx.put({
        id: 'bind',
        kind: 'binding',
        fromId: child.id,
        toId: frame.id,
        anchor: { x: 0.5, y: 1 },
      });
    });
    const content = copyFrom(source, [frame.id]);

    const target = boardWith();
    const existing = addNote(target, 'existing', 0, 0);
    const result = insertContent(target, content);

    expect(result.ids).toHaveLength(2);
    expect(result.rootIds).toHaveLength(1);
    const [newFrame, newChild] = result.ids.map((id) => target.getElement(id)!);
    expect(newFrame!.id).not.toBe(frame.id);
    expect(newChild!.parentId).toBe(newFrame!.id);
    expect(newFrame!.pageId).toBe(target.pages.current);
    expect(newFrame!.index > existing.index).toBe(true);

    const binding = Object.values(target.getDocument().records).find((r) => r.kind === 'binding');
    expect(binding).toMatchObject({
      fromId: newChild!.id,
      toId: newFrame!.id,
      anchor: { x: 0.5, y: 1 },
    });
    expect(result.idMap.get('bind')).toBe(binding!.id);
  });

  it('creates new IDs even on an empty board and when pasting twice', () => {
    const source = boardWith();
    const a = addNote(source, 'a', 0, 0);
    const content = copyFrom(source, [a.id]);

    const target = boardWith();
    const first = insertContent(target, content);
    const second = insertContent(target, content);
    expect(first.ids[0]).not.toBe(a.id);
    expect(second.ids[0]).not.toBe(first.ids[0]);
    expect(target.query()).toHaveLength(2);
  });

  it('pastes onto the current page of the target board', () => {
    const source = boardWith();
    const a = addNote(source, 'a', 0, 0);
    const content = copyFrom(source, [a.id]);

    const target = boardWith();
    const page = target.pages.create({ name: 'Kedua' });
    target.pages.setCurrent(page.id);
    const [id] = insertContent(target, content).ids;
    expect(target.getElement(id!)!.pageId).toBe(page!.id);
    // The source page is not added to the target.
    expect(target.pages.list()).toHaveLength(2);
  });

  it('centers the content at `at`', () => {
    const source = boardWith();
    const a = addNote(source, 'a', 0, 0);
    const b = addNote(source, 'b', 200, 100);
    const content = copyFrom(source, [a.id, b.id]);

    const target = boardWith();
    const result = insertContent(target, content, { at: { x: 1000, y: 1000 } });
    const els = result.ids.map((id) => target.getElement(id)!);
    const minX = Math.min(...els.map((e) => e.x));
    const maxX = Math.max(...els.map((e) => e.x + e.w));
    const minY = Math.min(...els.map((e) => e.y));
    const maxY = Math.max(...els.map((e) => e.y + e.h));
    expect((minX + maxX) / 2).toBeCloseTo(1000);
    expect((minY + maxY) / 2).toBeCloseTo(1000);
    // Relative layout is kept.
    expect(els[1]!.x - els[0]!.x).toBe(200);
  });

  it('is one undo step', () => {
    const source = boardWith();
    const content = copyFrom(source, [
      addNote(source, 'a', 0, 0).id,
      addNote(source, 'b', 50, 0).id,
    ]);
    const target = boardWith();
    insertContent(target, content);
    expect(target.query()).toHaveLength(2);
    target.undo();
    expect(target.query()).toHaveLength(0);
  });

  it('keeps elements of types the target does not know as-is (BOARD-209)', () => {
    const source = boardWith(customPlugin);
    const el = source.create({ type: 'custom', x: 5, y: 5, w: 40, h: 40 })!;
    const content = copyFrom(source, [el.id]);

    const target = boardWith();
    const [id] = insertContent(target, content).ids;
    expect(target.getElement(id!)).toMatchObject({ type: 'custom', w: 40, h: 40 });
  });

  it('rejects read-only boards, limits, and permission hooks without changing the board', () => {
    const source = boardWith();
    const content = copyFrom(source, [
      addNote(source, 'a', 0, 0).id,
      addNote(source, 'b', 50, 0).id,
    ]);

    const readOnly = createBoard({ plugins: [notes], readOnly: true });
    expect(() => insertContent(readOnly, content)).toThrow(
      expect.objectContaining({ code: 'read-only' }),
    );

    const limited = createBoard({ plugins: [notes], limits: { maxElements: 2 } });
    addNote(limited, 'existing', 0, 0);
    expect(() => insertContent(limited, content)).toThrow(ContentError);
    expect(limited.query()).toHaveLength(1);

    const guarded = createBoard({
      plugins: [notes],
      permissions: (action, element) => !(action === 'create' && element?.type === 'note'),
    });
    expect(() => insertContent(guarded, content)).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    );
    expect(guarded.query()).toHaveLength(0);
  });

  it('validates `at`', () => {
    const board = boardWith();
    const content = copyFrom(board, [addNote(board, 'a', 0, 0).id]);
    expect(() => insertContent(board, content, { at: { x: Number.NaN, y: 0 } })).toThrow(TypeError);
  });
});
