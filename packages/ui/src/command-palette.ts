/**
 * Command palette overlay component (BOARD-1405).
 *
 * Opens with `/` (when not in text input) or `Mod+K`. Shows built-in commands and tools,
 * filters by query, and supports keyboard navigation with Arrow keys, Enter, and Escape.
 */

import type { Board } from '@kujam/core';
import { createElementClass, type KujamUiElement, type UiWindow } from './base.js';
import { shortcutFor } from './controls.js';
import { createIcon } from './icons.js';
import { tOr } from './i18n.js';

/**
 * Item in the command palette.
 *
 * @public
 */
export interface CommandPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly category?: string;
  readonly disabled?: boolean;
  run(board: Board): void;
}

/**
 * Provider of items for the command palette.
 *
 * @public
 */
export interface CommandPaletteSource {
  getItems(
    board: Board,
    query: string,
  ): readonly CommandPaletteItem[] | Promise<readonly CommandPaletteItem[]>;
}

/**
 * Command palette custom element interface.
 *
 * @public
 */
export interface CommandPaletteElement extends KujamUiElement {
  /** Opens the command palette dialog. */
  open(): void;
  /** Closes the command palette dialog. */
  close(): void;
  /** Whether the command palette dialog is currently visible. */
  readonly isOpen: boolean;
  /** Custom item source. When undefined, built-in commands and tools are used. */
  source?: CommandPaletteSource;
}

const PALETTE_CSS = `
  :host {
    display: block;
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1000;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
    background: rgba(0, 0, 0, 0.4);
    pointer-events: auto;
  }
  .backdrop[hidden] {
    display: none !important;
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 520px;
    max-height: 400px;
    background: var(--kujam-ui-surface);
    color: var(--kujam-ui-ink);
    border: 1px solid var(--kujam-ui-border);
    border-radius: var(--kujam-ui-radius-lg);
    box-shadow: var(--kujam-ui-shadow-pop);
    overflow: hidden;
  }
  .search-box {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--kujam-ui-border);
    gap: 10px;
  }
  .search-input {
    flex: 1;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--kujam-ui-ink);
    font: var(--kujam-ui-font);
    font-size: 14px;
    line-height: 20px;
  }
  .search-input::placeholder {
    color: var(--kujam-ui-ink-disabled);
  }
  .results-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    margin: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .empty {
    padding: 24px 16px;
    text-align: center;
    color: var(--kujam-ui-ink-muted);
    font-size: 13px;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: var(--kujam-ui-radius-md);
    border: 0;
    background: transparent;
    color: var(--kujam-ui-ink);
    font: var(--kujam-ui-font);
    text-align: left;
    cursor: pointer;
    width: 100%;
  }
  .item:hover,
  .item[aria-selected="true"],
  .item.active {
    background: var(--kujam-ui-surface-hover);
  }
  .item[aria-disabled="true"],
  .item.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .item-label {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-shortcut {
    margin-left: auto;
    padding-left: 12px;
    font: inherit;
    color: var(--kujam-ui-ink-muted);
  }
  .item-shortcut kbd {
    font: inherit;
    padding: 2px 6px;
    border-radius: var(--kujam-ui-radius-md);
    background: var(--kujam-ui-surface);
    border: 1px solid var(--kujam-ui-border);
  }
`;

function getTranslatedLabel(board: Board, key: string): string {
  if (board.i18n?.has(key)) return board.i18n.t(key);
  if (typeof board.t === 'function') {
    try {
      const val = board.t(key);
      if (val && val !== key) return val;
    } catch {
      // Ignored
    }
  }
  return key;
}

function getDefaultItems(board: Board): CommandPaletteItem[] {
  const items: CommandPaletteItem[] = [];

  // 1. Built-in and plugin commands
  if (board.commands?.list) {
    for (const cmd of board.commands.list()) {
      const label = getTranslatedLabel(board, cmd.label);
      const shortcut = shortcutFor(board, cmd.id);
      const disabled = !board.commands.isEnabled(cmd.id);
      items.push({
        id: cmd.id,
        label,
        shortcut,
        category: 'commands',
        disabled,
        run: (b) => {
          if (b.commands.isEnabled(cmd.id)) {
            b.run(cmd.id);
          }
        },
      });
    }
  }

  // 2. Built-in and plugin tools
  if (board.tools?.list) {
    for (const tool of board.tools.list()) {
      const toolKey = `tool.${tool.id}`;
      const label = board.i18n?.has(toolKey)
        ? board.i18n.t(toolKey)
        : board.i18n?.has(tool.id)
          ? board.i18n.t(tool.id)
          : tool.id;
      const shortcut = shortcutFor(board, `tool:${tool.id}`);
      items.push({
        id: `tool:${tool.id}`,
        label,
        shortcut,
        category: 'tools',
        disabled: false,
        run: (b) => b.setTool(tool.id),
      });
    }
  }

  return items;
}

function matchesFilter(item: CommandPaletteItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const label = item.label.toLowerCase();
  const id = item.id.toLowerCase();
  if (label.includes(q) || id.includes(q)) return true;

  // Simple fuzzy character check
  let index = 0;
  for (let i = 0; i < q.length; i++) {
    index = label.indexOf(q[i]!, index);
    if (index === -1) return false;
    index++;
  }
  return true;
}

function renderPalette(root: ShadowRoot, board: Board, host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  const win = doc.defaultView ?? window;

  const backdrop = doc.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', tOr('commandPalette.title', board, 'Command Palette'));

  const dialog = doc.createElement('div');
  dialog.className = 'dialog';
  backdrop.append(dialog);

  const searchBox = doc.createElement('div');
  searchBox.className = 'search-box';
  dialog.append(searchBox);

  const searchInput = doc.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'search-input';
  searchInput.placeholder = tOr(
    'commandPalette.placeholder',
    board,
    board.locale === 'en' ? 'Type a command...' : 'Ketik perintah...',
  );
  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-expanded', 'true');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-controls', 'command-palette-results');
  searchBox.append(searchInput);

  const resultsList = doc.createElement('div');
  resultsList.id = 'command-palette-results';
  resultsList.className = 'results-list';
  resultsList.setAttribute('role', 'listbox');
  dialog.append(resultsList);

  root.append(backdrop);

  let activeIndex = 0;
  let currentFiltered: CommandPaletteItem[] = [];
  let itemElements: HTMLButtonElement[] = [];
  let lastActiveElement: HTMLElement | null = null;

  function updateActiveHighlight(): void {
    for (let i = 0; i < itemElements.length; i++) {
      const el = itemElements[i]!;
      const isActive = i === activeIndex;
      el.setAttribute('aria-selected', String(isActive));
      if (isActive) {
        el.classList.add('active');
        el.scrollIntoView({ block: 'nearest' });
        searchInput.setAttribute('aria-activedescendant', el.id);
      } else {
        el.classList.remove('active');
      }
    }
  }

  function executeItem(item: CommandPaletteItem | undefined): void {
    if (!item || item.disabled) return;
    close();
    item.run(board);
  }

  function populateResults(items: readonly CommandPaletteItem[]): void {
    currentFiltered = [...items];
    itemElements = [];
    resultsList.replaceChildren();

    if (currentFiltered.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'empty';
      empty.textContent = tOr(
        'commandPalette.empty',
        board,
        board.locale === 'en' ? 'No commands found' : 'Tidak ada perintah ditemukan',
      );
      resultsList.append(empty);
      searchInput.removeAttribute('aria-activedescendant');
      return;
    }

    if (activeIndex >= currentFiltered.length) {
      activeIndex = 0;
    }

    for (let i = 0; i < currentFiltered.length; i++) {
      const item = currentFiltered[i]!;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      btn.id = `palette-item-${item.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(i === activeIndex));
      if (item.disabled) {
        btn.setAttribute('aria-disabled', 'true');
        btn.classList.add('disabled');
      }

      const labelSpan = doc.createElement('span');
      labelSpan.className = 'item-label';

      // Tool icon if matching built-in tool
      const iconName = item.id.startsWith('tool:') ? item.id.slice(5) : undefined;
      const iconSvg = iconName ? createIcon(doc, iconName, 16) : null;
      if (iconSvg) labelSpan.append(iconSvg);

      const textNode = doc.createElement('span');
      textNode.textContent = item.label;
      labelSpan.append(textNode);
      btn.append(labelSpan);

      if (item.shortcut) {
        const kbdSpan = doc.createElement('span');
        kbdSpan.className = 'item-shortcut';
        const kbd = doc.createElement('kbd');
        kbd.textContent = item.shortcut;
        kbdSpan.append(kbd);
        btn.append(kbdSpan);
      }

      btn.addEventListener('click', () => {
        executeItem(item);
      });

      resultsList.append(btn);
      itemElements.push(btn);
    }

    updateActiveHighlight();
  }

  async function refresh(query = searchInput.value): Promise<void> {
    const paletteHost = host as unknown as CommandPaletteElement;
    if (paletteHost.source) {
      const sourceItems = await paletteHost.source.getItems(board, query);
      populateResults(sourceItems);
    } else {
      const defaultItems = getDefaultItems(board);
      const filtered = defaultItems.filter((item) => matchesFilter(item, query));
      populateResults(filtered);
    }
  }

  function open(): void {
    if (!backdrop.hidden) return;
    lastActiveElement = doc.activeElement as HTMLElement | null;
    backdrop.hidden = false;
    searchInput.value = '';
    activeIndex = 0;
    void refresh('');
    searchInput.focus();
  }

  function close(): void {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    searchInput.value = '';
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
  }

  // Attach controller methods to host
  const paletteEl = host as unknown as CommandPaletteElement;
  paletteEl.open = open;
  paletteEl.close = close;
  Object.defineProperty(paletteEl, 'isOpen', {
    get: () => !backdrop.hidden,
    configurable: true,
  });

  searchInput.addEventListener('input', () => {
    activeIndex = 0;
    void refresh(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentFiltered.length > 0) {
        activeIndex = (activeIndex + 1) % currentFiltered.length;
        updateActiveHighlight();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentFiltered.length > 0) {
        activeIndex = (activeIndex - 1 + currentFiltered.length) % currentFiltered.length;
        updateActiveHighlight();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeItem(currentFiltered[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      close();
    }
  });

  const onGlobalKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    const inTextInput = Boolean(
      target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ),
    );

    const isModK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
    const isSlash = e.key === '/';

    if (isModK || (isSlash && !inTextInput)) {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && !backdrop.hidden) {
      e.preventDefault();
      close();
    }
  };

  win.addEventListener('keydown', onGlobalKeyDown);

  return () => {
    win.removeEventListener('keydown', onGlobalKeyDown);
  };
}

/**
 * Creates the `<kujam-command-palette>` custom element class for a window (BOARD-1405).
 *
 * @internal
 */
export function createCommandPaletteClass(win: UiWindow): new () => KujamUiElement {
  return createElementClass(win, { css: PALETTE_CSS, render: renderPalette });
}
