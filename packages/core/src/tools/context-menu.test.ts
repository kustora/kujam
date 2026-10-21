import { describe, expect, it } from 'vitest';
import { createBoard } from '../index.js';
import { defaultCommands } from './default-commands.js';
import { buildContextMenuItems, createContextMenuEvent } from './context-menu.js';
import { defineElement } from '../elements/elements.js';
import { definePlugin } from '../plugins/plugins.js';
import { object, string } from '../document/schema.js';

describe('BOARD-912: context menu items and event', () => {
  const noteElement = defineElement({
    type: 'note',
    version: 1,
    props: object({ text: string() }),
    defaults: { text: '' },
  });

  const testPlugin = definePlugin({
    id: 'test-elements',
    elements: [noteElement],
  });

  function makeBoard() {
    const board = createBoard({
      plugins: [testPlugin, defaultCommands],
    });
    return board;
  }

  it('generates canvas context menu items when selection is empty', () => {
    const board = makeBoard();
    const items = buildContextMenuItems(board);

    const ids = items.map((item) => item.id);
    expect(ids).toContain('clipboard.paste');
    expect(ids).toContain('selection.all');
    expect(ids).toContain('history.undo');
    expect(ids).toContain('history.redo');
    expect(ids).toContain('camera.zoom-to-fit');
    expect(ids).toContain('camera.zoom-reset');

    const undoItem = items.find((i) => i.id === 'history.undo')!;
    expect(undoItem.disabled).toBe(true); // Nothing to undo yet

    const selectAll = items.find((i) => i.id === 'selection.all')!;
    expect(selectAll.disabled).toBe(true); // No elements on board
  });

  it('generates element context menu items when element is selected', () => {
    const board = makeBoard();
    const el = board.create({ type: 'note', x: 10, y: 10, props: { text: 'Hello' } })!;
    board.select(el.id);

    const items = buildContextMenuItems(board);
    const ids = items.map((item) => item.id);

    expect(ids).toContain('clipboard.cut');
    expect(ids).toContain('clipboard.copy');
    expect(ids).toContain('clipboard.paste');
    expect(ids).toContain('element.duplicate');
    expect(ids).toContain('element.lock');
    expect(ids).toContain('element.delete');

    const deleteItem = items.find((i) => i.id === 'element.delete')!;
    expect(deleteItem.danger).toBe(true);
    expect(deleteItem.disabled).toBe(false);

    // Run delete action
    deleteItem.run();
    expect(board.getElement(el.id)).toBeUndefined();
  });

  it('includes custom element actions from board.getActions()', () => {
    const customCard = defineElement({
      type: 'note-card',
      version: 1,
      props: object({ title: string() }),
      render: { canvas: () => {} },
      actions: (_el, _data, ctx) => [
        {
          id: 'card.highlight',
          label: 'Highlight Card',
          run: () => {
            ctx.updateProps({ title: 'Highlighted' });
          },
        },
      ],
    });

    const cardPlugin = definePlugin({
      id: 'card-plugin',
      elements: [noteElement, customCard],
    });

    const board = createBoard({
      plugins: [cardPlugin, defaultCommands],
    });

    const card = board.create({ type: 'note-card', x: 0, y: 0, props: { title: 'Test' } })!;
    board.select(card.id);

    const items = buildContextMenuItems(board);
    const highlightItem = items.find((i) => i.id === 'card.highlight');
    expect(highlightItem).toBeDefined();
    expect(highlightItem?.label).toBe('Highlight Card');

    highlightItem?.run();
    expect(board.getElement(card.id)?.props.title).toBe('Highlighted');
  });

  it('shows unlock command when all selected elements are locked', () => {
    const board = makeBoard();
    const el = board.create({ type: 'note', x: 0, y: 0, locked: true })!;
    board.select(el.id);

    const items = buildContextMenuItems(board);
    const ids = items.map((i) => i.id);

    expect(ids).toContain('element.unlock');
    expect(ids).not.toContain('element.lock');

    const unlockItem = items.find((i) => i.id === 'element.unlock')!;
    unlockItem.run();
    expect(board.getElement(el.id)?.locked).toBe(false);
  });

  it('createContextMenuEvent handles defaultPrevented', () => {
    const board = makeBoard();
    const event = createContextMenuEvent({
      board,
      screen: { x: 100, y: 150 },
      point: { x: 200, y: 300 },
      client: { x: 100, y: 150 },
    });

    expect(event.defaultPrevented).toBe(false);
    expect(event.screen).toEqual({ x: 100, y: 150 });
    expect(event.point).toEqual({ x: 200, y: 300 });
    expect(event.items.length).toBeGreaterThan(0);

    event.preventDefault();
    expect(event.defaultPrevented).toBe(true);
  });

  it('handles in-memory clipboard cut, copy, paste fallback', () => {
    const board = makeBoard();
    const el = board.create({ type: 'note', x: 20, y: 40, props: { text: 'Note to copy' } })!;
    board.select(el.id);

    const copyMenu = buildContextMenuItems(board);
    const copyItem = copyMenu.find((i) => i.id === 'clipboard.copy')!;
    copyItem.run();

    board.clearSelection();
    const pasteMenu = buildContextMenuItems(board, { point: { x: 100, y: 200 } });
    const pasteItem = pasteMenu.find((i) => i.id === 'clipboard.paste')!;
    pasteItem.run();

    expect(board.query().length).toBe(2);
    const pasted = board.query().find((e) => e.id !== el.id)!;
    expect(pasted.props.text).toBe('Note to copy');
  });
});
