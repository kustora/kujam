import { describe, expect, it } from 'vitest';
import {
  ReadOnlyBoardError,
  createBoard,
  createEmptyDocument,
  defineElement,
  definePlugin,
  number,
  object,
  string,
  type BindingRecord,
  type BoardDocument,
  type BoardErrorEvent,
} from './index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({
    text: string(),
    color: string(),
  }),
  defaults: {
    text: 'Default Note',
    color: 'yellow',
  },
});

const strictElement = defineElement({
  type: 'strict-item',
  version: 1,
  props: object({
    count: number(),
  }),
  defaults: {
    count: 10,
  },
});

const testPlugin = definePlugin({
  id: 'test-plugin',
  elements: [noteElement, strictElement],
});

describe('BOARD-205: board.create', () => {
  it('mengisi id, index di atas elemen teratas page, default props, dan nilai bawaan', () => {
    const board = createBoard({ plugins: [testPlugin] });

    const el1 = board.create({
      type: 'note',
      props: { text: 'Catatan 1' },
    });

    expect(el1).toBeDefined();
    expect(el1?.id).toBeTruthy();
    expect(el1?.kind).toBe('element');
    expect(el1?.type).toBe('note');
    expect(el1?.pageId).toBe('page:main');
    expect(el1?.parentId).toBeNull();
    expect(el1?.index).toBe('a0');
    expect(el1?.x).toBe(0);
    expect(el1?.y).toBe(0);
    expect(el1?.rotation).toBe(0);
    expect(el1?.w).toBe(0);
    expect(el1?.h).toBe(0);
    expect(el1?.locked).toBe(false);
    expect(el1?.opacity).toBe(1);
    expect(el1?.props).toEqual({ text: 'Catatan 1', color: 'yellow' });
    expect(el1?.meta).toEqual({});

    // The second element on the same page is automatically above el1
    const el2 = board.create({
      type: 'note',
      props: { text: 'Catatan 2' },
    });
    expect(el2).toBeDefined();
    expect(el2?.index).toBe('a1');

    board.dispose();
  });

  it('menolak create di dokumen tanpa record page sampai page dibuat', () => {
    const doc: BoardDocument = {
      schemaVersion: 1,
      meta: {},
      records: {},
    };
    const board = createBoard({ document: doc, plugins: [testPlugin] });
    const codes: string[] = [];
    board.on('error', (e) => codes.push(e.code));

    expect(board.create({ type: 'note' })).toBeUndefined();
    expect(codes).toEqual(['page-not-found']);

    board.pages.create({ id: 'page:main' });
    expect(board.create({ type: 'note' })?.pageId).toBe('page:main');
    board.dispose();
  });

  it('menolak pageId yang bukan page yang ada', () => {
    const board = createBoard({ plugins: [testPlugin] });
    board.create({ id: 'el-1', type: 'note' });
    const errors: BoardErrorEvent[] = [];
    board.on('error', (e) => errors.push(e));

    expect(board.create({ type: 'note', pageId: 'page:missing' })).toBeUndefined();
    // An element ID is not a page ID either.
    expect(board.create({ type: 'note', pageId: 'el-1' })).toBeUndefined();
    // Prototype keys must not count as existing records.
    expect(board.create({ type: 'note', pageId: 'toString' })).toBeUndefined();

    expect(errors.map((e) => e.code)).toEqual([
      'page-not-found',
      'page-not-found',
      'page-not-found',
    ]);
    expect(errors[0]!.cause).toEqual({ pageId: 'page:missing' });
    expect(board.query({ allPages: true }).map((e) => e.id)).toEqual(['el-1']);
    board.dispose();
  });

  it('menghormati nilai kustom bila diberikan', () => {
    const board = createBoard({ plugins: [testPlugin] });

    const el = board.create({
      id: 'custom-id-123',
      type: 'note',
      pageId: 'page:main',
      parentId: 'frame-1',
      index: 'a05',
      x: 100,
      y: 200,
      rotation: 45,
      w: 300,
      h: 150,
      locked: true,
      opacity: 0.8,
      props: { text: 'Kustom', color: 'blue' },
      meta: { author: 'Budi' },
    });

    expect(el).toEqual({
      id: 'custom-id-123',
      kind: 'element',
      type: 'note',
      pageId: 'page:main',
      parentId: 'frame-1',
      index: 'a05',
      x: 100,
      y: 200,
      rotation: 45,
      w: 300,
      h: 150,
      locked: true,
      opacity: 0.8,
      props: { text: 'Kustom', color: 'blue' },
      typeVersion: 1,
      meta: { author: 'Budi' },
    });

    expect(board.getElement('custom-id-123')).toEqual(el);
    board.dispose();
  });

  it('memancarkan error invalid-props dan menolak bila tipe elemen tidak terdaftar', () => {
    const board = createBoard();
    let errorCaught: BoardErrorEvent | null = null;
    board.on('error', (err) => {
      errorCaught = err;
    });

    const el = board.create({
      type: 'unregistered-type',
      props: { foo: 'bar' },
    });

    expect(el).toBeUndefined();
    expect(errorCaught?.code).toBe('invalid-props');
    expect(errorCaught?.message).toContain('unregistered-type');
    board.dispose();
  });

  it('memancarkan error invalid-props dan menolak bila props tidak lolos skema tipe', () => {
    const board = createBoard({ plugins: [testPlugin] });
    let errorCaught: BoardErrorEvent | null = null;
    board.on('error', (err) => {
      errorCaught = err;
    });

    const el = board.create({
      type: 'strict-item',
      props: { count: 'bukan-angka' as unknown as number },
    });

    expect(el).toBeUndefined();
    expect(errorCaught?.code).toBe('invalid-props');
    expect(errorCaught?.cause).toBeDefined();
    board.dispose();
  });

  it('memancarkan error limit-exceeded bila jumlah elemen mencapai maxElements', () => {
    const board = createBoard({
      plugins: [testPlugin],
      limits: { maxElements: 2 },
    });
    let errorCaught: BoardErrorEvent | null = null;
    board.on('error', (err) => {
      errorCaught = err;
    });

    const el1 = board.create({ type: 'note' });
    const el2 = board.create({ type: 'note' });
    expect(el1).toBeDefined();
    expect(el2).toBeDefined();

    const el3 = board.create({ type: 'note' });
    expect(el3).toBeUndefined();
    expect(errorCaught?.code).toBe('limit-exceeded');
    board.dispose();
  });

  it('menolak partialElement yang bukan objek atau type yang tidak valid', () => {
    const board = createBoard({ plugins: [testPlugin] });
    expect(() => board.create(null as unknown as object)).toThrow(TypeError);
    expect(() => board.create([] as unknown as object)).toThrow(TypeError);
    expect(() => board.create({} as unknown as object)).toThrow(TypeError);
    expect(() => board.create({ type: '' } as unknown as object)).toThrow(TypeError);
    board.dispose();
  });

  it('menolak mutasi create saat readOnly', () => {
    const board = createBoard({ plugins: [testPlugin], readOnly: true });
    expect(() => {
      board.create({ type: 'note' });
    }).toThrow(ReadOnlyBoardError);
    board.dispose();
  });

  it('menolak create setelah board di-dispose', () => {
    const board = createBoard({ plugins: [testPlugin] });
    board.dispose();
    expect(() => {
      board.create({ type: 'note' });
    }).toThrow('Papan sudah di-dispose.');
  });
});

describe('BOARD-205: board.update', () => {
  it('menggabungkan patch dangkal dan menggabungkan props per kunci', () => {
    const board = createBoard({ plugins: [testPlugin] });
    const el = board.create({
      type: 'note',
      props: { text: 'Awal', color: 'green' },
    })!;

    const updated = board.update(el.id, {
      x: 100,
      props: { text: 'Diperbarui' },
    });

    expect(updated).toBeDefined();
    expect(updated?.x).toBe(100);
    expect(updated?.y).toBe(0);
    // props text is updated, color is preserved
    expect(updated?.props).toEqual({ text: 'Diperbarui', color: 'green' });
    expect(board.getElement(el.id)).toEqual(updated);
    board.dispose();
  });

  it('menolak perubahan pada elemen locked kecuali opsi force bernilai true', () => {
    const board = createBoard({ plugins: [testPlugin] });
    const el = board.create({
      type: 'note',
      locked: true,
      props: { text: 'Terkunci' },
    })!;

    // Without force: rejected
    const failed = board.update(el.id, { x: 50 });
    expect(failed).toBeUndefined();
    expect(board.getElement(el.id)?.x).toBe(0);

    // With force: allowed (for example unlocking)
    const unlocked = board.update(el.id, { locked: false, x: 50 }, { force: true });
    expect(unlocked).toBeDefined();
    expect(unlocked?.locked).toBe(false);
    expect(unlocked?.x).toBe(50);
    expect(board.getElement(el.id)?.locked).toBe(false);

    board.dispose();
  });

  it('mengizinkan penguncian elemen yang belum locked tanpa perlu force', () => {
    const board = createBoard({ plugins: [testPlugin] });
    const el = board.create({ type: 'note', locked: false })!;

    const locked = board.update(el.id, { locked: true });
    expect(locked).toBeDefined();
    expect(locked?.locked).toBe(true);
    board.dispose();
  });

  it('memancarkan error invalid-props dan membatalkan update bila props tidak lolos skema', () => {
    const board = createBoard({ plugins: [testPlugin] });
    const el = board.create({ type: 'strict-item', props: { count: 10 } })!;

    let errorCaught: BoardErrorEvent | null = null;
    board.on('error', (err) => {
      errorCaught = err;
    });

    const failed = board.update(el.id, {
      props: { count: 'rusak' as unknown as number },
    });

    expect(failed).toBeUndefined();
    expect(errorCaught?.code).toBe('invalid-props');
    expect(board.getElement(el.id)?.props).toEqual({ count: 10 });
    board.dispose();
  });

  it('mengembalikan undefined bila elemen id tidak ditemukan', () => {
    const board = createBoard({ plugins: [testPlugin] });
    const result = board.update('non-existent', { x: 10 });
    expect(result).toBeUndefined();
    board.dispose();
  });

  it('menolak id dan patch yang tidak valid', () => {
    const board = createBoard({ plugins: [testPlugin] });
    expect(() => board.update('', {})).toThrow(TypeError);
    expect(() => board.update('id', null as unknown as object)).toThrow(TypeError);
    expect(() => board.update('id', { props: 'invalid' as unknown as object })).toThrow(TypeError);
    board.dispose();
  });

  it('menolak update saat readOnly atau setelah dispose', () => {
    const doc = createEmptyDocument();
    doc.records['el:ro'] = {
      id: 'el:ro',
      kind: 'element',
      type: 'note',
      pageId: 'page:main',
      parentId: null,
      index: 'a0',
      x: 0,
      y: 0,
      rotation: 0,
      w: 100,
      h: 100,
      locked: false,
      opacity: 1,
      props: { text: 'RO', color: 'yellow' },
      meta: {},
    };
    const readOnlyBoard = createBoard({ document: doc, plugins: [testPlugin], readOnly: true });
    expect(() => readOnlyBoard.update('el:ro', { x: 10 })).toThrow(ReadOnlyBoardError);
    readOnlyBoard.dispose();

    const board = createBoard({ plugins: [testPlugin] });
    board.dispose();
    expect(() => board.update('id', { x: 10 })).toThrow('Papan sudah di-dispose.');
  });
});

describe('BOARD-205: board.delete', () => {
  it('menghapus elemen tunggal atau beberapa elemen', () => {
    const board = createBoard({ plugins: [testPlugin] });
    const el1 = board.create({ type: 'note' })!;
    const el2 = board.create({ type: 'note' })!;

    const deleted = board.delete([el1.id, el2.id]);
    expect(deleted).toEqual([el1.id, el2.id]);
    expect(board.getElement(el1.id)).toBeUndefined();
    expect(board.getElement(el2.id)).toBeUndefined();
    board.dispose();
  });

  it('menerima id tunggal bertipe string', () => {
    const board = createBoard({ plugins: [testPlugin] });
    const el = board.create({ type: 'note' })!;

    const deleted = board.delete(el.id);
    expect(deleted).toEqual([el.id]);
    expect(board.getElement(el.id)).toBeUndefined();
    board.dispose();
  });

  it('juga menghapus anak frame atau grup secara rekursif', () => {
    const board = createBoard({ plugins: [testPlugin] });
    // Root container
    board.create({ id: 'frame-1', type: 'note' });
    // Child of the frame
    board.create({ id: 'group-1', type: 'note', parentId: 'frame-1' });
    // Grandchild of the frame (child of childGroup)
    board.create({ id: 'sub-child-1', type: 'note', parentId: 'group-1' });
    // Unrelated outside element
    board.create({ id: 'outside-1', type: 'note' });

    const deleted = board.delete('frame-1');
    expect(deleted).toContain('frame-1');
    expect(deleted).toContain('group-1');
    expect(deleted).toContain('sub-child-1');
    expect(deleted).not.toContain('outside-1');

    expect(board.getElement('frame-1')).toBeUndefined();
    expect(board.getElement('group-1')).toBeUndefined();
    expect(board.getElement('sub-child-1')).toBeUndefined();
    expect(board.getElement('outside-1')).toBeDefined();
    board.dispose();
  });

  it('juga menghapus binding yang menempel', () => {
    const doc: BoardDocument = createEmptyDocument();
    const board = createBoard({ document: doc, plugins: [testPlugin] });

    const elA = board.create({ id: 'el-a', type: 'note' })!;
    const elB = board.create({ id: 'el-b', type: 'note' })!;

    // Add a binding between el-a and el-b
    const binding: BindingRecord = {
      id: 'bind-1',
      kind: 'binding',
      fromId: elA.id,
      toId: elB.id,
      anchor: { x: 0.5, y: 0.5 },
    };
    board.transact((tx) => {
      tx.put(binding);
    });

    expect(board.getDocument().records['bind-1']).toBeDefined();

    // Delete elA; binding bind-1 must be deleted automatically
    const deleted = board.delete(elA.id);
    expect(deleted).toContain('el-a');
    expect(deleted).toContain('bind-1');
    expect(board.getDocument().records['el-a']).toBeUndefined();
    expect(board.getDocument().records['bind-1']).toBeUndefined();
    expect(board.getDocument().records['el-b']).toBeDefined();

    board.dispose();
  });

  it('menolak penghapusan elemen locked tanpa opsi force', () => {
    const board = createBoard({ plugins: [testPlugin] });
    const locked = board.create({ id: 'locked-el', type: 'note', locked: true })!;
    const unlocked = board.create({ id: 'unlocked-el', type: 'note', locked: false })!;

    // Delete without force: only unlocked elements are deleted
    const deleted = board.delete([locked.id, unlocked.id]);
    expect(deleted).toEqual(['unlocked-el']);
    expect(board.getElement('locked-el')).toBeDefined();
    expect(board.getElement('unlocked-el')).toBeUndefined();

    // Delete with force: locked elements are deleted too
    const deletedForced = board.delete(locked.id, { force: true });
    expect(deletedForced).toEqual(['locked-el']);
    expect(board.getElement('locked-el')).toBeUndefined();

    board.dispose();
  });

  it('cascade delete kontainer melompati anak yang locked jika tanpa opsi force', () => {
    const board = createBoard({ plugins: [testPlugin] });
    const parent = board.create({ id: 'parent-1', type: 'note' })!;
    const lockedChild = board.create({
      id: 'child-locked',
      type: 'note',
      parentId: parent.id,
      locked: true,
    })!;
    board.create({
      id: 'child-unlocked',
      type: 'note',
      parentId: parent.id,
      locked: false,
    });

    const deleted = board.delete(parent.id);
    expect(deleted).toContain('parent-1');
    expect(deleted).toContain('child-unlocked');
    expect(deleted).not.toContain('child-locked');
    expect(board.getElement('child-locked')).toBeDefined();

    // Delete with force: true
    const deletedForced = board.delete(lockedChild.id, { force: true });
    expect(deletedForced).toEqual(['child-locked']);
    expect(board.getElement('child-locked')).toBeUndefined();

    board.dispose();
  });

  it('mengabaikan id yang tidak ada atau input kosong', () => {
    const board = createBoard({ plugins: [testPlugin] });
    expect(board.delete([])).toEqual([]);
    expect(board.delete('non-existent')).toEqual([]);
    board.dispose();
  });

  it('menolak argumen ids yang bukan string atau Iterable', () => {
    const board = createBoard({ plugins: [testPlugin] });
    expect(() => board.delete(123 as unknown as string)).toThrow(TypeError);
    expect(() => board.delete(null as unknown as string)).toThrow(TypeError);
    board.dispose();
  });

  it('menolak delete saat readOnly atau setelah dispose', () => {
    const doc = createEmptyDocument();
    doc.records['el:ro'] = {
      id: 'el:ro',
      kind: 'element',
      type: 'note',
      pageId: 'page:main',
      parentId: null,
      index: 'a0',
      x: 0,
      y: 0,
      rotation: 0,
      w: 100,
      h: 100,
      locked: false,
      opacity: 1,
      props: { text: 'RO', color: 'yellow' },
      meta: {},
    };
    const readOnlyBoard = createBoard({ document: doc, plugins: [testPlugin], readOnly: true });
    expect(() => readOnlyBoard.delete('el:ro')).toThrow(ReadOnlyBoardError);
    readOnlyBoard.dispose();

    const board = createBoard({ plugins: [testPlugin] });
    board.dispose();
    expect(() => board.delete('id')).toThrow('Papan sudah di-dispose.');
  });
});
