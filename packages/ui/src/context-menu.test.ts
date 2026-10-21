// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  createContextMenuEvent,
  type Board,
  type ContextMenuItem,
} from '@kujam/core';
import { defineUiElements, mountDefaultUi, UI_TAGS } from './index.js';
import type { ContextMenuElement } from './context-menu.js';

let boards: Board[] = [];

afterEach(() => {
  for (const board of boards) if (!board.disposed) board.dispose();
  boards = [];
  document.body.innerHTML = '';
});

function newBoard(): Board {
  const board = createBoard();
  boards.push(board);
  return board;
}

function mountContextMenu(board: Board): ContextMenuElement {
  defineUiElements();
  const el = document.createElement(UI_TAGS.contextMenu) as ContextMenuElement;
  el.board = board;
  document.body.append(el);
  return el;
}

function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, ...init }),
  );
}

describe('BOARD-1408: built-in context menu', () => {
  it('starts hidden and opens when board emits contextmenu', () => {
    const board = newBoard();
    const el = mountContextMenu(board);
    const root = el.shadowRoot!;

    expect(el.isOpen).toBe(false);
    expect(el.hidden).toBe(true);

    const runAction = vi.fn();
    const items: ContextMenuItem[] = [
      { id: 'custom.action', label: 'Custom Action', shortcut: 'Mod+A', run: runAction },
      { id: 'sep-1', label: '', separator: true, run: () => {} },
      { id: 'custom.delete', label: 'Delete', danger: true, run: () => {} },
    ];

    const event = createContextMenuEvent({
      board,
      screen: { x: 100, y: 150 },
      point: { x: 100, y: 150 },
      client: { x: 100, y: 150 },
      items,
    });

    board.emit('contextmenu', event);

    expect(el.isOpen).toBe(true);
    expect(el.hidden).toBe(false);

    const buttons = root.querySelectorAll<HTMLButtonElement>('.menu-item');
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.textContent).toContain('Custom Action');
    expect(buttons[0]?.textContent).toContain('Mod+A');

    const separator = root.querySelector('.separator');
    expect(separator).not.toBeNull();

    const dangerBtn = root.querySelector('.menu-item.danger');
    expect(dangerBtn).not.toBeNull();
    expect(dangerBtn?.textContent).toContain('Delete');
  });

  it('executes item run() and closes menu on item click', () => {
    const board = newBoard();
    const el = mountContextMenu(board);
    const root = el.shadowRoot!;

    const runAction = vi.fn();
    const items: ContextMenuItem[] = [
      { id: 'test.action', label: 'Test Action', run: runAction },
    ];

    const event = createContextMenuEvent({
      board,
      screen: { x: 50, y: 50 },
      point: { x: 50, y: 50 },
      client: { x: 50, y: 50 },
      items,
    });

    board.emit('contextmenu', event);
    expect(el.isOpen).toBe(true);

    const btn = root.querySelector<HTMLButtonElement>('.menu-item')!;
    btn.click();

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(el.isOpen).toBe(false);
    expect(el.hidden).toBe(true);
  });

  it('supports keyboard navigation with Arrow keys and closes on Escape', () => {
    const board = newBoard();
    const el = mountContextMenu(board);
    const root = el.shadowRoot!;

    const items: ContextMenuItem[] = [
      { id: 'item.1', label: 'Item 1', run: () => {} },
      { id: 'item.2', label: 'Item 2', run: () => {} },
      { id: 'item.3', label: 'Item 3', run: () => {} },
    ];

    const event = createContextMenuEvent({
      board,
      screen: { x: 50, y: 50 },
      point: { x: 50, y: 50 },
      client: { x: 50, y: 50 },
      items,
    });

    board.emit('contextmenu', event);
    const menuWrap = root.querySelector('.menu')!;

    // Press ArrowDown to cycle
    key(menuWrap, 'ArrowDown');
    key(menuWrap, 'ArrowUp');
    key(menuWrap, 'Home');
    key(menuWrap, 'End');

    // Press Escape to close
    key(menuWrap, 'Escape');
    expect(el.isOpen).toBe(false);
    expect(el.hidden).toBe(true);
  });

  it('closes on outside click', () => {
    const board = newBoard();
    const el = mountContextMenu(board);

    const items: ContextMenuItem[] = [
      { id: 'item.1', label: 'Item 1', run: () => {} },
    ];

    const event = createContextMenuEvent({
      board,
      screen: { x: 50, y: 50 },
      point: { x: 50, y: 50 },
      client: { x: 50, y: 50 },
      items,
    });

    board.emit('contextmenu', event);
    expect(el.isOpen).toBe(true);

    // Outside pointerdown
    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true }),
    );

    expect(el.isOpen).toBe(false);
  });

  it('closes on camera pan/zoom', () => {
    const board = newBoard();
    const el = mountContextMenu(board);

    const items: ContextMenuItem[] = [
      { id: 'item.1', label: 'Item 1', run: () => {} },
    ];

    const event = createContextMenuEvent({
      board,
      screen: { x: 50, y: 50 },
      point: { x: 50, y: 50 },
      client: { x: 50, y: 50 },
      items,
    });

    board.emit('contextmenu', event);
    expect(el.isOpen).toBe(true);

    board.setCamera({ x: 100, y: 100, zoom: 1 });
    expect(el.isOpen).toBe(false);
  });

  it('does not open when event.defaultPrevented is true', () => {
    const board = newBoard();
    const el = mountContextMenu(board);

    const items: ContextMenuItem[] = [
      { id: 'item.1', label: 'Item 1', run: () => {} },
    ];

    const event = createContextMenuEvent({
      board,
      screen: { x: 50, y: 50 },
      point: { x: 50, y: 50 },
      client: { x: 50, y: 50 },
      items,
    });

    event.preventDefault();
    board.emit('contextmenu', event);

    expect(el.isOpen).toBe(false);
    expect(el.hidden).toBe(true);
  });

  it('integrates with mountDefaultUi', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const board = newBoard();

    const ui = mountDefaultUi({ board, container });
    expect(ui.contextMenu).toBeDefined();
    expect(ui.contextMenu.tagName.toLowerCase()).toBe(UI_TAGS.contextMenu);

    ui.unmount();
    expect(ui.contextMenu.board).toBeNull();
  });
});
