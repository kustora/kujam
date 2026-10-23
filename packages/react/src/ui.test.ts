// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { createBoard, type Board as CoreBoard } from '@kujam/core';
import {
  CommandPalette,
  ShortcutHelp,
  Toolbar,
  ZoomControl,
  type UiCommandPaletteSource,
  type UiElementRef,
} from './index.js';

/** BOARD-1410: React wrappers for the `@kujam/ui` elements. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Stand-in for a `@kujam/ui` element: records every `board` it was given. */
class FakeUiElement extends HTMLElement {
  boards: (CoreBoard | null)[] = [];
  source?: unknown;
  #board: CoreBoard | null = null;
  get board(): CoreBoard | null {
    return this.#board;
  }
  set board(board: CoreBoard | null) {
    this.#board = board;
    this.boards.push(board);
  }
  open(): void {}
}
for (const tag of ['kujam-toolbar', 'kujam-command-palette', 'kujam-shortcut-help']) {
  if (!customElements.get(tag)) customElements.define(tag, class extends FakeUiElement {});
}

let roots: Root[] = [];
let boards: CoreBoard[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots = [];
  for (const board of boards) board.dispose();
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function render(node: Parameters<Root['render']>[0]): HTMLElement {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}

function newBoard(): CoreBoard {
  const board = createBoard();
  boards.push(board);
  return board;
}

describe('BOARD-1410: UI wrappers', () => {
  it('renders the element and passes board, className, and style', () => {
    const board = newBoard();
    const container = render(
      createElement(Toolbar, { board, className: 'bar', style: { left: 10 }, id: 'main' }),
    );
    const el = container.querySelector('kujam-toolbar') as FakeUiElement;
    expect(el).toBeInstanceOf(FakeUiElement);
    expect(el.board).toBe(board);
    expect(el.className).toBe('bar');
    expect(el.style.left).toBe('10px');
    expect(el.id).toBe('main');
  });

  it('follows board changes and detaches on unmount', () => {
    const a = newBoard();
    const b = newBoard();
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    act(() => root.render(createElement(Toolbar, { board: a })));
    const el = container.querySelector('kujam-toolbar') as FakeUiElement;
    act(() => root.render(createElement(Toolbar, { board: b })));
    expect(el.board).toBe(b);
    act(() => root.unmount());
    expect(el.board).toBeNull();
    expect(el.boards).toEqual([a, b, null]);
  });

  it('exposes the element through ref for its methods', () => {
    const board = newBoard();
    const ref = createRef<UiElementRef>();
    render(createElement(ShortcutHelp, { board, ref }));
    expect(ref.current?.tagName.toLowerCase()).toBe('kujam-shortcut-help');
    expect(typeof (ref.current as unknown as FakeUiElement).open).toBe('function');
  });

  it('passes the command palette source as a property', () => {
    const board = newBoard();
    const source: UiCommandPaletteSource = { getItems: () => [] };
    const container = render(createElement(CommandPalette, { board, source }));
    const el = container.querySelector('kujam-command-palette') as FakeUiElement;
    expect(el.source).toBe(source);
  });

  it('keeps one board assignment per element under StrictMode', () => {
    const board = newBoard();
    const container = render(createElement(StrictMode, null, createElement(Toolbar, { board })));
    const el = container.querySelector('kujam-toolbar') as FakeUiElement;
    expect(el.board).toBe(board);
  });

  it('warns once when the element is not defined yet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const board = newBoard();
    render(createElement(ZoomControl, { board }));
    render(createElement(ZoomControl, { board }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('defineUiElements');
  });

  it('renders on the server without touching the board', () => {
    const board = newBoard();
    expect(renderToString(createElement(Toolbar, { board, className: 'bar' }))).toBe(
      '<kujam-toolbar class="bar"></kujam-toolbar>',
    );
  });
});
