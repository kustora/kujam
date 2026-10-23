// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, shallowRef, type App } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createSSRApp } from 'vue';
import { createBoard, type Board as CoreBoard } from '@kujam/core';
import {
  CommandPalette,
  ShortcutHelp,
  Toolbar,
  ZoomControl,
  type UiCommandPaletteSource,
  type UiElementRef,
} from './index.js';

/** BOARD-1410: Vue wrappers for the `@kujam/ui` elements. */

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

let apps: App[] = [];
let boards: CoreBoard[] = [];

afterEach(() => {
  for (const app of apps) app.unmount();
  apps = [];
  for (const board of boards) board.dispose();
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function newBoard(): CoreBoard {
  const board = createBoard();
  boards.push(board);
  return board;
}

function mount(render: () => ReturnType<typeof h>): HTMLElement {
  const container = document.body.appendChild(document.createElement('div'));
  const app = createApp({ render });
  apps.push(app);
  app.mount(container);
  return container;
}

describe('BOARD-1410: Vue UI wrappers', () => {
  it('renders the element, passes board, and falls through class and style', async () => {
    const board = newBoard();
    const container = mount(() => h(Toolbar, { board, class: 'bar', style: { left: '10px' } }));
    await nextTick();
    const el = container.querySelector('kujam-toolbar') as FakeUiElement;
    expect(el).toBeInstanceOf(FakeUiElement);
    expect(el.board).toBe(board);
    expect(el.className).toBe('bar');
    expect(el.style.left).toBe('10px');
  });

  it('follows board changes and detaches on unmount', async () => {
    const a = newBoard();
    const b = newBoard();
    const current = shallowRef<CoreBoard>(a);
    const container = document.body.appendChild(document.createElement('div'));
    const app = createApp({ render: () => h(Toolbar, { board: current.value }) });
    app.mount(container);
    await nextTick();
    const el = container.querySelector('kujam-toolbar') as FakeUiElement;
    current.value = b;
    await nextTick();
    expect(el.board).toBe(b);
    app.unmount();
    expect(el.board).toBeNull();
    expect(el.boards).toEqual([a, b, null]);
  });

  it('exposes the element for its methods', async () => {
    const board = newBoard();
    const help = ref<{ element: UiElementRef | null } | null>(null);
    mount(() => h(ShortcutHelp, { board, ref: help }));
    await nextTick();
    expect(help.value?.element?.tagName.toLowerCase()).toBe('kujam-shortcut-help');
    expect(typeof (help.value?.element as unknown as FakeUiElement).open).toBe('function');
  });

  it('passes the command palette source as a property', async () => {
    const board = newBoard();
    const source: UiCommandPaletteSource = { getItems: () => [] };
    const container = mount(() => h(CommandPalette, { board, source }));
    await nextTick();
    const el = container.querySelector('kujam-command-palette') as FakeUiElement;
    expect(el.source).toBe(source);
  });

  it('warns once when the element is not defined yet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const board = newBoard();
    mount(() => h(ZoomControl, { board }));
    mount(() => h(ZoomControl, { board }));
    await nextTick();
    const own = warn.mock.calls.filter((c) => String(c[0]).includes('defineUiElements'));
    expect(own).toHaveLength(1);
  });

  it('renders on the server without touching the board', async () => {
    const board = newBoard();
    const html = await renderToString(createSSRApp({ render: () => h(Toolbar, { board }) }));
    expect(html).toBe('<kujam-toolbar></kujam-toolbar>');
  });
});
