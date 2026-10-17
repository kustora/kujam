import { describe, expect, it } from 'vitest';
import {
  createBoard,
  defaultCommands,
  defineElement,
  definePlugin,
  object,
  string,
  type Board,
  type InputModifiers,
  type ToolKeyEvent,
} from '../index.js';

const note = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});

const notes = definePlugin({ id: 'notes', elements: [note] });

const NO_MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

function keyDown(key: string, code: string, mods: Partial<InputModifiers> = {}): ToolKeyEvent {
  return { type: 'key-down', key, code, repeat: false, modifiers: { ...NO_MODS, ...mods } };
}

/** Board with notes a..e stacked bottom to top, each 100×100 at x = 0, 100, ... */
function setup(readOnly = false): Board {
  const board = createBoard({ plugins: [notes, defaultCommands], platform: 'other' });
  ['a', 'b', 'c', 'd', 'e'].forEach((id, i) =>
    board.create({ id, type: 'note', x: i * 100, y: 0, w: 100, h: 100 }),
  );
  if (!readOnly) return board;
  return createBoard({
    plugins: [notes, defaultCommands],
    platform: 'other',
    document: board.getDocument(),
    readOnly: true,
  });
}

const order = (board: Board) => board.query().map((el) => el.id);
const indexes = (board: Board) =>
  Object.fromEntries(board.query().map((el) => [el.id, el.index] as const));

describe('BOARD-505: layer commands', () => {
  it('bring-forward moves the selection up past one sibling and changes only its index', () => {
    const board = setup();
    const before = indexes(board);
    board.select(['b']);
    board.run('layer.bring-forward');
    expect(order(board)).toEqual(['a', 'c', 'b', 'd', 'e']);
    const after = indexes(board);
    for (const id of ['a', 'c', 'd', 'e']) expect(after[id]).toBe(before[id]);
    expect(after.b).not.toBe(before.b);
  });

  it('moves a block of selected elements together', () => {
    const board = setup();
    board.select(['b', 'c']);
    board.run('layer.bring-forward');
    expect(order(board)).toEqual(['a', 'd', 'b', 'c', 'e']);
    board.run('layer.send-backward');
    board.run('layer.send-backward');
    expect(order(board)).toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('bring-to-front and send-to-back keep the relative order of the selection', () => {
    const board = setup();
    board.select(['d', 'a']);
    board.run('layer.bring-to-front');
    expect(order(board)).toEqual(['b', 'c', 'e', 'a', 'd']);
    board.run('layer.send-to-back');
    expect(order(board)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('does not change anything that is already in place', () => {
    const board = createBoard({ plugins: [notes, defaultCommands] });
    // Irregular indexes, so regenerating one would give a different value.
    for (const [id, index] of [
      ['a', 'a1'],
      ['b', 'a3'],
      ['c', 'a7'],
      ['d', 'aV'],
    ] as const) {
      board.create({ id, type: 'note', index });
    }
    const before = indexes(board);
    board.select(['c', 'd']);
    board.run('layer.bring-forward');
    board.run('layer.bring-to-front');
    board.select(['a']);
    board.run('layer.send-backward');
    board.run('layer.send-to-back');
    expect(indexes(board)).toEqual(before);
  });

  it('only reorders siblings with the same parent, and skips locked elements', () => {
    const board = setup();
    board.create({ id: 'child1', type: 'note', parentId: 'a', index: 'a0' });
    board.create({ id: 'child2', type: 'note', parentId: 'a', index: 'a1' });
    board.update('c', { locked: true });
    board.select(['child1', 'c']);
    board.run('layer.bring-forward');
    expect(board.query({ parentId: 'a' }).map((el) => el.id)).toEqual(['child2', 'child1']);
    expect(order(board).filter((id) => !id.startsWith('child'))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('is one undo step', () => {
    const board = setup();
    board.select(['a', 'c']);
    board.run('layer.bring-to-front');
    board.undo();
    expect(order(board)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('runs from Mod+] / Mod+[ and Shift+Mod+] / Shift+Mod+[', () => {
    const board = setup();
    board.select(['a']);
    expect(board.dispatch(keyDown(']', 'BracketRight', { ctrl: true }))).toBe(true);
    expect(order(board)).toEqual(['b', 'a', 'c', 'd', 'e']);
    expect(board.dispatch(keyDown('}', 'BracketRight', { ctrl: true, shift: true }))).toBe(true);
    expect(order(board)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(board.dispatch(keyDown('[', 'BracketLeft', { ctrl: true }))).toBe(true);
    expect(board.dispatch(keyDown('{', 'BracketLeft', { ctrl: true, shift: true }))).toBe(true);
    expect(order(board)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('BOARD-505: lock, duplicate, delete, select all', () => {
  it('Shift+Mod+L toggles the lock, and lock/unlock are one undo step each', () => {
    const board = setup();
    board.select(['a', 'b']);
    board.dispatch(keyDown('L', 'KeyL', { ctrl: true, shift: true }));
    expect(board.getElement('a')?.locked).toBe(true);
    expect(board.getElement('b')?.locked).toBe(true);
    board.dispatch(keyDown('L', 'KeyL', { ctrl: true, shift: true }));
    expect(board.getElement('a')?.locked).toBe(false);
    board.run('element.lock');
    board.undo();
    expect(board.getElement('a')?.locked).toBe(false);
    expect(board.getElement('b')?.locked).toBe(false);
  });

  it('element.unlock unlocks only locked elements', () => {
    const board = setup();
    board.update('a', { locked: true });
    board.select(['a', 'b']);
    expect(board.commands.isEnabled('element.unlock')).toBe(true);
    board.run('element.unlock');
    expect(board.getElement('a')?.locked).toBe(false);
    expect(board.commands.isEnabled('element.unlock')).toBe(false);
  });

  it('Mod+D duplicates with an offset on top, selects the copies, and is one undo step', () => {
    const board = setup();
    board.select(['b', 'a']);
    board.dispatch(keyDown('d', 'KeyD', { ctrl: true }));
    const copies = board.selection;
    expect(copies).toHaveLength(2);
    const [copyA, copyB] = copies.map((id) => board.getElement(id)!);
    expect(copyA).toMatchObject({ type: 'note', x: 16, y: 16, w: 100, locked: false });
    expect(copyB).toMatchObject({ x: 116, y: 16 });
    // Copies sit above everything and keep the originals' relative order.
    expect(order(board).slice(-2)).toEqual([copyA!.id, copyB!.id]);
    board.undo();
    expect(order(board)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('duplicate takes a custom offset, copies descendants, and unlocks copies', () => {
    const board = setup();
    board.create({ id: 'child', type: 'note', parentId: 'a', x: 5, props: { text: 'hi' } });
    board.update('a', { locked: true });
    board.select(['a', 'child']);
    board.run('element.duplicate', { offset: { x: 0, y: 200 } });
    expect(board.selection).toHaveLength(1);
    const copy = board.getElement(board.selection[0]!)!;
    expect(copy).toMatchObject({ y: 200, locked: false });
    const children = board.query({ parentId: copy.id });
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ x: 5, y: 200, props: { text: 'hi' } });
  });

  it('Delete and Backspace delete the selection except locked elements', () => {
    const board = setup();
    board.update('c', { locked: true });
    board.select(['a', 'c']);
    expect(board.dispatch(keyDown('Delete', 'Delete'))).toBe(true);
    expect(order(board)).toEqual(['b', 'c', 'd', 'e']);
    board.select(['b']);
    expect(board.dispatch(keyDown('Backspace', 'Backspace'))).toBe(true);
    expect(order(board)).toEqual(['c', 'd', 'e']);
    board.undo();
    expect(order(board)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('Mod+A selects top-level unlocked elements of the current page', () => {
    const board = setup();
    board.create({ id: 'child', type: 'note', parentId: 'a' });
    board.update('e', { locked: true });
    board.pages.create({ id: 'page:2' });
    board.create({ id: 'other', type: 'note', pageId: 'page:2' });
    expect(board.dispatch(keyDown('a', 'KeyA', { ctrl: true }))).toBe(true);
    expect([...board.selection].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('commands are disabled without a selection and on read-only boards', () => {
    const board = setup();
    for (const id of [
      'layer.bring-forward',
      'element.lock',
      'element.duplicate',
      'element.delete',
    ]) {
      expect(board.commands.isEnabled(id)).toBe(false);
    }
    // Disabled commands are not handled, so the renderer leaves the key to the browser.
    expect(board.dispatch(keyDown('Delete', 'Delete'))).toBe(false);

    const ro = setup(true);
    ro.select(['a']);
    for (const id of ['layer.bring-forward', 'element.toggle-lock', 'element.duplicate']) {
      expect(ro.commands.isEnabled(id)).toBe(false);
    }
    expect(ro.commands.isEnabled('selection.all')).toBe(true);
  });
});

describe('BOARD-505: zoom commands', () => {
  it('Shift+1 fits all elements of the current page in the viewport', () => {
    const board = setup();
    expect(board.commands.isEnabled('camera.zoom-to-fit')).toBe(false); // no viewport yet
    board.camera.setViewport({ width: 564, height: 164 });
    expect(board.dispatch(keyDown('!', 'Digit1', { shift: true }))).toBe(true);
    // Content 500×100; available 500×100 after 32 px padding on each side.
    const cam = board.camera.get();
    expect(cam.zoom).toBeCloseTo(1);
    expect(board.camera.boardToScreen({ x: 250, y: 50 })).toEqual({ x: 282, y: 82 });
  });

  it('Shift+2 fits the selection, at most 100% like camera.zoomToSelection', () => {
    const board = setup();
    board.camera.setViewport({ width: 800, height: 600 });
    board.select(['c']);
    expect(board.dispatch(keyDown('@', 'Digit2', { shift: true }))).toBe(true);
    // A small selection would fit far above 100%; the BOARD-402 default caps it.
    expect(board.camera.get().zoom).toBe(1);
    const center = board.camera.screenToBoard({ x: 400, y: 300 });
    expect(center.x).toBeCloseTo(250);
    expect(center.y).toBeCloseTo(50);

    board.clearSelection();
    expect(board.commands.isEnabled('camera.zoom-to-selection')).toBe(false);
  });
});
