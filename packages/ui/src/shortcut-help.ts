/**
 * Shortcut help panel (BOARD-1409).
 *
 * Opens with `?` outside text inputs and lists the board's effective shortcuts, read from
 * `board.keybindings` every time it opens, so it always matches the consumer's bindings
 * (`createBoard({ keybindings })` or `board.keybindings.set`). Shortcuts of one target are shown
 * together, tools first in registration order, then commands by label.
 */

import type { Board } from '@kujam/core';
import { createElementClass, type KujamUiElement, type UiWindow } from './base.js';
import { getTranslatedLabel, toolLabel } from './command-palette.js';
import { tOr } from './i18n.js';

/**
 * One row of the shortcut help panel: a target with all of its shortcuts.
 *
 * @public
 */
export interface ShortcutHelpEntry {
  /** Command ID, or `'tool:<id>'`. */
  readonly target: string;
  /** Translated label of the tool or command. */
  readonly label: string;
  /** Shortcuts formatted for the board's platform, for example `['⌘D']`. */
  readonly shortcuts: readonly string[];
}

/**
 * Shortcut help panel element (`<kujam-shortcut-help>`).
 *
 * @public
 */
export interface ShortcutHelpElement extends KujamUiElement {
  /** Opens the panel with the current shortcuts. */
  open(): void;
  /** Closes the panel and returns focus to where it was. */
  close(): void;
  /** Whether the panel is visible. */
  readonly isOpen: boolean;
}

/**
 * Groups the board's effective shortcuts by target (BOARD-1409): tools in registration order,
 * then commands sorted by label. Bindings to unknown targets are kept, labelled by their ID.
 *
 * @public
 */
export function buildShortcutHelp(board: Board): {
  readonly tools: readonly ShortcutHelpEntry[];
  readonly commands: readonly ShortcutHelpEntry[];
} {
  const byTarget = new Map<string, string[]>();
  for (const binding of board.keybindings.list()) {
    const list = byTarget.get(binding.target) ?? [];
    list.push(board.keybindings.format(binding.shortcut));
    byTarget.set(binding.target, list);
  }

  const tools: ShortcutHelpEntry[] = [];
  const toolOrder = new Map(board.tools.list().map((tool, i) => [tool.id, i]));
  const commands: ShortcutHelpEntry[] = [];
  for (const [target, shortcuts] of byTarget) {
    if (target.startsWith('tool:')) {
      const id = target.slice(5);
      tools.push({ target, label: toolLabel(board, id), shortcuts });
    } else {
      const command = board.commands.get(target);
      commands.push({
        target,
        label: command ? getTranslatedLabel(board, command.label) : target,
        shortcuts,
      });
    }
  }
  const rank = (entry: ShortcutHelpEntry): number =>
    toolOrder.get(entry.target.slice(5)) ?? Number.MAX_SAFE_INTEGER;
  tools.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  commands.sort((a, b) => a.label.localeCompare(b.label, board.locale));
  return { tools, commands };
}

const HELP_CSS = `
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
    align-items: center;
    justify-content: center;
    padding: 16px;
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
    max-width: 560px;
    max-height: min(560px, calc(100vh - 32px));
    background: var(--kujam-ui-surface);
    color: var(--kujam-ui-ink);
    border: 1px solid var(--kujam-ui-border);
    border-radius: var(--kujam-ui-radius-lg);
    box-shadow: var(--kujam-ui-shadow-pop);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--kujam-ui-border);
  }
  h2 {
    margin: 0;
    font: var(--kujam-ui-font);
    font-size: 15px;
    font-weight: 600;
  }
  .close {
    border: 0;
    background: transparent;
    color: var(--kujam-ui-ink-muted);
    font: var(--kujam-ui-font);
    padding: 4px 8px;
    border-radius: var(--kujam-ui-radius-md);
    cursor: pointer;
  }
  .close:hover {
    background: var(--kujam-ui-surface-hover);
    color: var(--kujam-ui-ink);
  }
  .body {
    overflow-y: auto;
    padding: 8px 16px 12px;
  }
  h3 {
    margin: 12px 0 6px;
    font: var(--kujam-ui-font);
    font-size: 12px;
    font-weight: 600;
    color: var(--kujam-ui-ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 16px;
    row-gap: 4px;
  }
  dt,
  dd {
    margin: 0;
    padding: 4px 0;
    font: var(--kujam-ui-font);
    font-size: 13px;
  }
  dd {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  kbd {
    font: inherit;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: var(--kujam-ui-radius-md);
    background: var(--kujam-ui-surface-hover);
    border: 1px solid var(--kujam-ui-border);
  }
  .empty,
  .hint {
    font: var(--kujam-ui-font);
    font-size: 12px;
    color: var(--kujam-ui-ink-muted);
  }
  .hint {
    margin: 0;
    padding: 8px 16px 12px;
    border-top: 1px solid var(--kujam-ui-border);
  }
`;

function isTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

/** Text input focused inside shadow roots too, as the board's text editor may live in one. */
function deepActiveElement(doc: Document): Element | null {
  let active: Element | null = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function renderHelp(root: ShadowRoot, board: Board, host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  const win = doc.defaultView ?? window;
  const text = (key: string, en: string, id: string): string =>
    tOr(key, board, board.locale === 'en' ? en : id);

  const backdrop = doc.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.hidden = true;

  const dialog = doc.createElement('div');
  dialog.className = 'dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'shortcut-help-title');
  dialog.tabIndex = -1;
  backdrop.append(dialog);

  const header = doc.createElement('div');
  header.className = 'header';
  const title = doc.createElement('h2');
  title.id = 'shortcut-help-title';
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'close';
  header.append(title, closeButton);

  const body = doc.createElement('div');
  body.className = 'body';
  // The list can scroll, so it takes focus for arrow-key and Page Up/Down scrolling (WCAG 2.1.1).
  body.tabIndex = 0;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', 'shortcut-help-title');
  const hint = doc.createElement('p');
  hint.className = 'hint';
  dialog.append(header, body, hint);
  root.append(backdrop);

  let lastActiveElement: HTMLElement | null = null;

  function section(heading: string, entries: readonly ShortcutHelpEntry[]): void {
    if (entries.length === 0) return;
    const h3 = doc.createElement('h3');
    h3.textContent = heading;
    const list = doc.createElement('dl');
    for (const entry of entries) {
      const dt = doc.createElement('dt');
      dt.textContent = entry.label;
      const dd = doc.createElement('dd');
      for (const shortcut of entry.shortcuts) {
        const kbd = doc.createElement('kbd');
        kbd.textContent = shortcut;
        dd.append(kbd);
      }
      list.append(dt, dd);
    }
    body.append(h3, list);
  }

  function populate(): void {
    title.textContent = text('shortcuts.title', 'Keyboard shortcuts', 'Pintasan keyboard');
    closeButton.textContent = text('shortcuts.close', 'Close', 'Tutup');
    hint.textContent = text(
      'shortcuts.hint',
      'Press ? to open this panel, Esc to close it.',
      'Tekan ? untuk membuka panel ini, Esc untuk menutup.',
    );
    body.replaceChildren();
    const { tools, commands } = buildShortcutHelp(board);
    section(text('shortcuts.tools', 'Tools', 'Alat'), tools);
    section(text('shortcuts.commands', 'Commands', 'Perintah'), commands);
    if (tools.length === 0 && commands.length === 0) {
      const empty = doc.createElement('p');
      empty.className = 'empty';
      empty.textContent = text('shortcuts.empty', 'No shortcuts yet', 'Belum ada pintasan');
      body.append(empty);
    }
  }

  function open(): void {
    if (!backdrop.hidden) return;
    lastActiveElement = deepActiveElement(doc) as HTMLElement | null;
    populate();
    backdrop.hidden = false;
    closeButton.focus();
  }

  function close(): void {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
    lastActiveElement = null;
  }

  const helpEl = host as unknown as ShortcutHelpElement;
  helpEl.open = open;
  helpEl.close = close;
  Object.defineProperty(helpEl, 'isOpen', { get: () => !backdrop.hidden, configurable: true });

  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  dialog.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog: the close button and the list take turns.
      e.preventDefault();
      (root.activeElement === closeButton ? body : closeButton).focus();
    }
  });

  const onGlobalKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '?' && !isTextInput(e.composedPath?.()[0] ?? e.target)) {
      if (isTextInput(deepActiveElement(doc))) return;
      e.preventDefault();
      if (backdrop.hidden) open();
      else close();
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
 * Creates the `<kujam-shortcut-help>` custom element class for a window (BOARD-1409).
 *
 * @internal
 */
export function createShortcutHelpClass(win: UiWindow): new () => KujamUiElement {
  return createElementClass(win, { css: HELP_CSS, render: renderHelp });
}
