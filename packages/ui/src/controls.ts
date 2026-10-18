/**
 * Building blocks shared by the UI components (BOARD-1402, BOARD-1404): tooltips, accessible
 * names with shortcuts, and popover menus with keyboard support.
 */

import type { Board } from '@kujam/core';

/** First shortcut bound to `target` (`tool:<id>` or a command ID), formatted for the platform. */
export function shortcutFor(board: Board, target: string): string | undefined {
  const binding = board.keybindings.forTarget(target)[0];
  return binding ? board.keybindings.format(binding.shortcut) : undefined;
}

/** Accessible name: label plus shortcut, as DESIGN.md asks for tool buttons. */
export function accessibleName(label: string, shortcut: string | undefined): string {
  return shortcut ? `${label} (${shortcut})` : label;
}

/**
 * Visual tooltip placed after a button. Hidden from assistive technology, since the button's
 * accessible name already carries the label and shortcut.
 */
export function createTooltip(
  doc: Document,
  label: string,
  shortcut: string | undefined,
): HTMLElement {
  const tip = doc.createElement('span');
  tip.className = 'tip';
  tip.setAttribute('aria-hidden', 'true');
  tip.textContent = label;
  if (shortcut) {
    const kbd = doc.createElement('kbd');
    kbd.textContent = shortcut;
    tip.append(kbd);
  }
  return tip;
}

/** Sets a button's accessible name and replaces its tooltip when the name changed. */
export function labelButton(
  button: HTMLButtonElement,
  label: string,
  shortcut: string | undefined,
): void {
  const name = accessibleName(label, shortcut);
  if (button.getAttribute('aria-label') === name) return;
  button.setAttribute('aria-label', name);
  const oldTip = button.nextElementSibling;
  if (oldTip?.classList.contains('tip')) oldTip.remove();
  button.after(createTooltip(button.ownerDocument, label, shortcut));
}

/** One entry of a {@link PopupMenu}. */
export interface MenuEntry {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string | undefined;
  readonly icon?: Node | null;
  /** For radio menus: whether this entry is the current choice. */
  readonly checked?: boolean;
  readonly disabled?: boolean;
  select(): void;
}

/** Popover menu anchored to a button. */
export interface PopupMenu {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  /** Replaces the entries. */
  setEntries(entries: readonly MenuEntry[]): void;
  /** Opens the menu and focuses the checked entry, `focusId`, or the first enabled entry. */
  open(focusId?: string): void;
  /** Closes the menu; with `focusAnchor`, moves focus back to the anchor button. */
  close(focusAnchor?: boolean): void;
}

/**
 * Creates a popover menu for `anchor`, appended to `wrap` (the anchor's positioned wrapper).
 * Arrow keys, Home, and End move between entries; Escape closes and returns focus to the anchor;
 * Tab closes. Closing on outside clicks is left to the component, which knows its host.
 */
export function createMenu(
  doc: Document,
  options: {
    readonly id: string;
    readonly label: string;
    readonly anchor: HTMLButtonElement;
    readonly wrap: HTMLElement;
    /** `true` for a choice between entries (`menuitemradio`). */
    readonly radio: boolean;
  },
): PopupMenu {
  const { anchor, wrap } = options;
  const element = doc.createElement('div');
  element.className = 'menu';
  element.hidden = true;
  element.id = options.id;
  element.setAttribute('role', 'menu');
  element.setAttribute('aria-label', options.label);
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'false');
  anchor.setAttribute('aria-controls', element.id);
  wrap.append(element);

  const items = (): HTMLButtonElement[] =>
    [...element.querySelectorAll<HTMLButtonElement>('.option')].filter((b) => !b.disabled);

  element.addEventListener('keydown', (e) => {
    const list = items();
    const index = list.indexOf(e.target as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (index + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      menu.close(true);
      return;
    } else if (e.key === 'Tab') {
      menu.close();
      return;
    }
    if (next >= 0 && list.length > 0) {
      e.preventDefault();
      list[next]!.focus();
    }
  });

  const menu: PopupMenu = {
    element,
    get isOpen() {
      return !element.hidden;
    },
    setEntries(entries) {
      element.replaceChildren();
      for (const entry of entries) {
        const el = doc.createElement('button');
        el.type = 'button';
        el.className = 'option';
        el.tabIndex = -1;
        el.dataset.id = entry.id;
        el.disabled = Boolean(entry.disabled);
        el.setAttribute('role', options.radio ? 'menuitemradio' : 'menuitem');
        if (options.radio) el.setAttribute('aria-checked', String(Boolean(entry.checked)));
        el.setAttribute('aria-label', accessibleName(entry.label, entry.shortcut));
        if (entry.icon) el.append(entry.icon);
        const text = doc.createElement('span');
        text.textContent = entry.label;
        el.append(text);
        if (entry.shortcut) {
          const kbd = doc.createElement('kbd');
          kbd.setAttribute('aria-hidden', 'true');
          kbd.textContent = entry.shortcut;
          el.append(kbd);
        }
        el.addEventListener('click', () => {
          menu.close(true);
          entry.select();
        });
        element.append(el);
      }
    },
    open(focusId) {
      element.hidden = false;
      wrap.classList.add('open');
      anchor.setAttribute('aria-expanded', 'true');
      const list = items();
      const target =
        list.find((b) => b.getAttribute('aria-checked') === 'true') ??
        list.find((b) => b.dataset.id === focusId) ??
        list[0];
      target?.focus();
    },
    close(focusAnchor = false) {
      if (element.hidden) return;
      element.hidden = true;
      wrap.classList.remove('open');
      anchor.setAttribute('aria-expanded', 'false');
      if (focusAnchor) anchor.focus();
    },
  };
  return menu;
}

/** Styles for tooltips and popover menus; components include it in their CSS. */
export const CONTROL_CSS = `
  .tip {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    border-radius: var(--kujam-ui-radius-md);
    background: var(--kujam-ui-surface-inverse);
    color: var(--kujam-ui-on-inverse);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--kujam-ui-motion);
  }
  .tip kbd {
    margin-left: 6px;
    font: inherit;
    opacity: 0.7;
  }
  button:hover + .tip,
  button:focus-visible + .tip {
    opacity: 1;
  }
  .open > .tip {
    opacity: 0;
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    min-width: 160px;
    padding: 4px;
    border-radius: var(--kujam-ui-radius-lg);
    background: var(--kujam-ui-surface);
    border: 1px solid var(--kujam-ui-border);
    box-shadow: var(--kujam-ui-shadow-pop);
  }
  .menu[hidden] {
    display: none;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--kujam-ui-radius-md);
    background: transparent;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .option:hover,
  .option:focus-visible {
    background: var(--kujam-ui-surface-hover);
  }
  .option:disabled {
    color: var(--kujam-ui-ink-disabled);
    background: transparent;
    cursor: default;
  }
  .option[aria-checked='true'] {
    color: var(--kujam-ui-focus-ring);
  }
  .option kbd {
    margin-left: auto;
    padding-left: 16px;
    font: inherit;
    color: var(--kujam-ui-ink-muted);
  }
`;
