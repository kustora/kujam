// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineCommand,
  definePlugin,
  defineTool,
  type Board,
  type BoardOptions,
} from '@kujam/core';
import { defineUiElements, UI_TAGS } from './index.js';
import type { CommandPaletteElement, CommandPaletteItem } from './command-palette.js';

const tool = (id: string) => defineTool({ id, initial: 'idle', states: { idle: {} } });

const builtInTools = definePlugin({
  id: 'built-in-tools',
  tools: [
    'select',
    'hand',
    'sticky',
    'draw',
    'rectangle',
    'ellipse',
    'connector',
    'text',
    'eraser',
  ].map(tool),
  keybindings: {
    v: 'tool:select',
    h: 'tool:hand',
    s: 'tool:sticky',
    p: 'tool:draw',
  },
});

let boards: Board[] = [];

afterEach(() => {
  for (const board of boards) if (!board.disposed) board.dispose();
  boards = [];
  document.body.innerHTML = '';
});

function newBoard(options: BoardOptions = {}): Board {
  const board = createBoard({ plugins: [builtInTools], ...options });
  board.setTool('select');
  boards.push(board);
  return board;
}

function mountPalette(board: Board): CommandPaletteElement {
  defineUiElements();
  const el = document.createElement(UI_TAGS.commandPalette) as CommandPaletteElement;
  el.board = board;
  document.body.append(el);
  return el;
}

function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, ...init }),
  );
}

describe('BOARD-1405: command palette', () => {
  it('opens on / or Mod+K, closes on Escape, and ignores / in text inputs', () => {
    const board = newBoard();
    const el = mountPalette(board);
    const root = el.shadowRoot!;
    const backdrop = root.querySelector<HTMLElement>('.backdrop')!;

    expect(backdrop.hidden).toBe(true);

    // Pressing '/' on document / window opens palette
    key(window, '/');
    expect(backdrop.hidden).toBe(false);

    // Pressing Escape closes it
    key(window, 'Escape');
    expect(backdrop.hidden).toBe(true);

    // Mod+K opens it (metaKey)
    key(window, 'k', { metaKey: true });
    expect(backdrop.hidden).toBe(false);

    // Escape in input closes it
    const input = root.querySelector<HTMLInputElement>('.search-input')!;
    key(input, 'Escape');
    expect(backdrop.hidden).toBe(true);

    // Mod+K opens it (ctrlKey)
    key(window, 'k', { ctrlKey: true });
    expect(backdrop.hidden).toBe(false);

    // Clicking backdrop closes it
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(backdrop.hidden).toBe(true);

    // Typing '/' in an external text input does not trigger palette
    const outsideInput = document.createElement('input');
    document.body.append(outsideInput);
    outsideInput.focus();
    key(outsideInput, '/');
    expect(backdrop.hidden).toBe(true);
  });

  it('lists commands and tools, filters by query, and displays empty state', () => {
    const board = newBoard({ locale: 'en' });
    const el = mountPalette(board);
    const root = el.shadowRoot!;
    const input = root.querySelector<HTMLInputElement>('.search-input')!;

    el.open();
    expect(el.isOpen).toBe(true);

    const getItems = () => [...root.querySelectorAll<HTMLButtonElement>('.item')];
    const initialItems = getItems();
    expect(initialItems.length).toBeGreaterThan(0);

    // Check that tools are present
    const labels = initialItems.map((item) => item.textContent);
    expect(labels.some((l) => l?.includes('Select'))).toBe(true);

    // Filter by 'hand'
    input.value = 'hand';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const filtered = getItems();
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((item) => item.textContent?.toLowerCase().includes('hand'))).toBe(true);

    // Filter with no matches
    input.value = 'nonexistent-query-xyz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(getItems()).toHaveLength(0);
    const empty = root.querySelector<HTMLElement>('.empty')!;
    expect(empty).not.toBeNull();
    expect(empty.textContent).toBeTruthy();
  });

  it('navigates with ArrowDown and ArrowUp, and Enter runs command/tool', () => {
    const board = newBoard({ locale: 'en' });
    const el = mountPalette(board);
    const root = el.shadowRoot!;
    const input = root.querySelector<HTMLInputElement>('.search-input')!;

    el.open();

    // Filter specifically for hand tool
    input.value = 'hand';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const items = [...root.querySelectorAll<HTMLButtonElement>('.item')];
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]!.getAttribute('aria-selected')).toBe('true');

    // Arrow down
    key(input, 'ArrowDown');
    expect(root.querySelector('.item.active')).not.toBeNull();

    // Arrow up
    key(input, 'ArrowUp');
    expect(items[0]!.getAttribute('aria-selected')).toBe('true');

    // Press Enter to activate tool
    expect(board.tool).toBe('select');
    key(input, 'Enter');

    expect(board.tool).toBe('hand');
    expect(el.isOpen).toBe(false);
  });

  it('dimmed disabled commands do not run when disabled', () => {
    let runs = 0;
    let enabled = false;

    const testPlugin = definePlugin({
      id: 'test-palette-plugin',
      commands: [
        defineCommand({
          id: 'test.runnable',
          label: 'test.runnable',
          isEnabled: () => enabled,
          run: () => {
            runs++;
          },
        }),
      ],
    });

    const board = newBoard({ plugins: [builtInTools, testPlugin] });
    const el = mountPalette(board);
    const root = el.shadowRoot!;
    const input = root.querySelector<HTMLInputElement>('.search-input')!;

    el.open();

    input.value = 'test.runnable';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const disabledBtn = root.querySelector<HTMLButtonElement>('.item[aria-disabled="true"]');
    expect(disabledBtn).not.toBeNull();
    expect(disabledBtn!.classList.contains('disabled')).toBe(true);

    // Pressing Enter on disabled item does not run it
    key(input, 'Enter');
    expect(runs).toBe(0);

    // Clicking disabled item does not run it
    disabledBtn!.click();
    expect(runs).toBe(0);

    // Enable command and run
    enabled = true;
    el.open();
    input.value = 'test.runnable';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const enabledBtn = root.querySelector<HTMLButtonElement>('.item:not([aria-disabled="true"])');
    expect(enabledBtn).not.toBeNull();
    enabledBtn!.click();
    expect(runs).toBe(1);
  });

  it('supports custom CommandPaletteSource', async () => {
    const board = newBoard();
    const el = mountPalette(board);
    const root = el.shadowRoot!;

    const runSpy = vi.fn();
    const customItems: CommandPaletteItem[] = [
      { id: 'custom-1', label: 'Custom Action 1', run: runSpy },
      { id: 'custom-2', label: 'Custom Action 2', run: () => {} },
    ];

    el.source = {
      getItems: (_b, q) => customItems.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())),
    };

    el.open();
    await Promise.resolve();

    const items = [...root.querySelectorAll<HTMLButtonElement>('.item')];
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('Custom Action 1');

    items[0]!.click();
    expect(runSpy).toHaveBeenCalledWith(board);
    expect(el.isOpen).toBe(false);
  });
});
