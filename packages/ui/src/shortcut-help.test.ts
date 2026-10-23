// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBoard,
  defineCommand,
  definePlugin,
  defineTool,
  type Board,
  type BoardOptions,
} from '@kujam/core';
import { buildShortcutHelp, defineUiElements, mountDefaultUi, UI_TAGS } from './index.js';
import type { ShortcutHelpElement } from './shortcut-help.js';

/** BOARD-1409: shortcut help panel read from the keybinding registry. */

const tool = (id: string) => defineTool({ id, initial: 'idle', states: { idle: {} } });

const plugin = definePlugin({
  id: 'help-test',
  tools: ['select', 'hand', 'draw'].map(tool),
  commands: [
    defineCommand({ id: 'test.zap', label: 'undo', run: () => {} }),
    defineCommand({ id: 'test.bolt', label: 'Bolt it', run: () => {} }),
  ],
  keybindings: {
    v: 'tool:select',
    p: 'tool:draw',
    h: 'tool:hand',
    'Mod+Z': 'test.zap',
    'Shift+B': 'test.bolt',
    b: 'test.bolt',
  },
});

let boards: Board[] = [];

afterEach(() => {
  for (const board of boards) if (!board.disposed) board.dispose();
  boards = [];
  document.body.innerHTML = '';
});

function newBoard(options: BoardOptions = {}): Board {
  const board = createBoard({ plugins: [plugin], platform: 'other', ...options });
  boards.push(board);
  return board;
}

function mountHelp(board: Board): ShortcutHelpElement {
  defineUiElements();
  const el = document.createElement(UI_TAGS.shortcutHelp) as ShortcutHelpElement;
  el.board = board;
  document.body.append(el);
  return el;
}

function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Visible rows as `label: shortcut, shortcut`, per section heading. */
function rows(el: ShortcutHelpElement): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const body = el.shadowRoot!.querySelector('.body')!;
  let current = '';
  for (const child of body.children) {
    if (child.tagName === 'H3') {
      current = child.textContent!;
      out[current] = [];
    } else if (child.tagName === 'DL') {
      const items = [...child.children];
      for (let i = 0; i < items.length; i += 2) {
        const kbds = [...items[i + 1]!.querySelectorAll('kbd')].map((k) => k.textContent);
        out[current]!.push(`${items[i]!.textContent}: ${kbds.join(', ')}`);
      }
    }
  }
  return out;
}

describe('BOARD-1409: shortcut help panel', () => {
  it('groups shortcuts by target: tools in registration order, then commands by label', () => {
    const board = newBoard();
    const { tools, commands } = buildShortcutHelp(board);
    expect(tools.map((t) => t.target)).toEqual(['tool:select', 'tool:hand', 'tool:draw']);
    expect(tools[0]).toEqual({ target: 'tool:select', label: 'Pilih', shortcuts: ['V'] });
    // `undo` is an i18n key; `Bolt it` has no translation and stays as written.
    expect(commands.map((c) => c.label)).toEqual(['Bolt it', 'Urungkan']);
    expect(commands[0]!.shortcuts).toHaveLength(2);
    expect(commands[1]!.shortcuts).toEqual(['Ctrl+Z']);
  });

  it('opens with ? and lists the effective shortcuts, including consumer bindings', () => {
    const board = newBoard({ keybindings: { e: 'tool:draw', v: null } });
    const el = mountHelp(board);
    expect(el.isOpen).toBe(false);

    const event = key(document.body, '?', { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(el.isOpen).toBe(true);

    const dialog = el.shadowRoot!.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(el.shadowRoot!.getElementById('shortcut-help-title')!.textContent).toBe(
      'Pintasan keyboard',
    );
    const sections = rows(el);
    expect(sections['Alat']).toEqual(['Tangan: H', 'Pena: P, E']);
    expect(sections['Perintah']).toHaveLength(2);
  });

  it('reads the registry again on every open', () => {
    const board = newBoard();
    const el = mountHelp(board);
    el.open();
    expect(rows(el)['Alat']).toContain('Pilih: V');
    el.close();
    board.keybindings.set('s', 'tool:select');
    el.open();
    expect(rows(el)['Alat']).toContain('Pilih: V, S');
  });

  it('closes with Esc, the close button, a backdrop click, or ? again, restoring focus', () => {
    const board = newBoard();
    const el = mountHelp(board);
    const outside = document.body.appendChild(document.createElement('button'));
    outside.focus();

    el.open();
    const close = el.shadowRoot!.querySelector<HTMLButtonElement>('.close')!;
    expect(el.shadowRoot!.activeElement).toBe(close);
    key(close, 'Escape');
    expect(el.isOpen).toBe(false);
    expect(document.activeElement).toBe(outside);

    el.open();
    close.click();
    expect(el.isOpen).toBe(false);

    el.open();
    el.shadowRoot!.querySelector<HTMLElement>('.backdrop')!.click();
    expect(el.isOpen).toBe(false);

    key(document.body, '?');
    key(document.body, '?');
    expect(el.isOpen).toBe(false);
  });

  it('keeps Tab inside the dialog and lets the scrollable list take focus', () => {
    const board = newBoard();
    const el = mountHelp(board);
    el.open();
    const root = el.shadowRoot!;
    const close = root.querySelector<HTMLButtonElement>('.close')!;
    const list = root.querySelector<HTMLElement>('.body')!;
    expect(list.tabIndex).toBe(0);
    expect(list.getAttribute('aria-labelledby')).toBe('shortcut-help-title');
    key(close, 'Tab');
    expect(root.activeElement).toBe(list);
    key(list, 'Tab', { shiftKey: true });
    expect(root.activeElement).toBe(close);
  });

  it('ignores ? while typing and with modifier keys', () => {
    const board = newBoard();
    const el = mountHelp(board);
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    key(input, '?');
    expect(el.isOpen).toBe(false);
    input.blur();
    key(document.body, '?', { ctrlKey: true });
    expect(el.isOpen).toBe(false);
  });

  it('uses the board locale and shows an empty state without shortcuts', () => {
    const board = createBoard({ locale: 'en' });
    boards.push(board);
    const el = mountHelp(board);
    el.open();
    expect(el.shadowRoot!.getElementById('shortcut-help-title')!.textContent).toBe(
      'Keyboard shortcuts',
    );
    expect(el.shadowRoot!.querySelector('.empty')!.textContent).toBe('No shortcuts yet');
  });

  it('is part of the default UI', () => {
    const board = newBoard();
    const container = document.body.appendChild(document.createElement('div'));
    const ui = mountDefaultUi({ board, container });
    expect(ui.shortcutHelp.tagName.toLowerCase()).toBe(UI_TAGS.shortcutHelp);
    key(document.body, '?');
    expect((ui.shortcutHelp as ShortcutHelpElement).isOpen).toBe(true);
    ui.unmount();
    expect(container.querySelector(UI_TAGS.shortcutHelp)).toBeNull();
  });

  it('stops listening when removed', () => {
    const board = newBoard();
    const el = mountHelp(board);
    el.remove();
    key(document.body, '?');
    expect(el.isOpen).toBe(false);
  });
});
