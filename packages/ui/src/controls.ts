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

/** Accessible name: label plus shortcut, as tool buttons require. */
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

/** A labelled group of menu entries, for menus with several choices (BOARD-1402). */
export interface MenuGroup {
  readonly id: string;
  readonly label: string;
  /**
   * `swatches` lays the entries out as a grid of color swatches, `icons` as a grid of icon-only
   * buttons (the label becomes the tooltip and accessible name). Defaults to `list`.
   */
  readonly layout?: 'list' | 'swatches' | 'icons';
  /** Swatches per row. Defaults to 5. */
  readonly columns?: number;
}

/** One entry of a {@link PopupMenu}. */
export interface MenuEntry {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string | undefined;
  readonly icon?: Node | null;
  /** Group the entry belongs to; consecutive entries of one group share a `role="group"`. */
  readonly group?: MenuGroup;
  /** CSS color of a swatch entry; its label is then only its accessible name and tooltip. */
  readonly swatch?: string;
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % list.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
      next = (index - 1 + list.length) % list.length;
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
      let parent: HTMLElement = element;
      let group: MenuGroup | undefined;
      for (const entry of entries) {
        if (entry.group?.id !== group?.id) {
          group = entry.group;
          parent = element;
          if (group) {
            parent = doc.createElement('div');
            parent.className = 'group';
            parent.dataset.group = group.id;
            parent.setAttribute('role', 'group');
            parent.setAttribute('aria-label', group.label);
            const heading = doc.createElement('div');
            heading.className = 'group-label';
            heading.setAttribute('aria-hidden', 'true');
            heading.textContent = group.label;
            const body = doc.createElement('div');
            body.className =
              group.layout === 'swatches'
                ? 'swatches'
                : group.layout === 'icons'
                  ? 'icons'
                  : 'entries';
            if (group.columns) body.style.setProperty('--kujam-ui-columns', String(group.columns));
            parent.append(heading, body);
            element.append(parent);
            parent = body;
          }
        }
        const el = doc.createElement('button');
        el.type = 'button';
        el.className = entry.swatch === undefined ? 'option' : 'option swatch';
        el.tabIndex = -1;
        el.dataset.id = entry.id;
        el.disabled = Boolean(entry.disabled);
        const isRadio = options.radio;
        const isCheckbox = !isRadio && entry.checked !== undefined;
        el.setAttribute(
          'role',
          isRadio ? 'menuitemradio' : isCheckbox ? 'menuitemcheckbox' : 'menuitem',
        );
        if (isRadio || isCheckbox) {
          el.setAttribute('aria-checked', String(Boolean(entry.checked)));
        }
        el.setAttribute('aria-label', accessibleName(entry.label, entry.shortcut));
        if (entry.swatch !== undefined) {
          el.title = entry.label;
          el.style.setProperty('--kujam-ui-swatch', entry.swatch);
        } else if (group?.layout === 'icons' && entry.icon) {
          el.classList.add('icon-only');
          el.title = entry.shortcut ? `${entry.label} (${entry.shortcut})` : entry.label;
          el.append(entry.icon);
        } else {
          if (entry.icon) el.append(entry.icon);
          const text = doc.createElement('span');
          text.textContent = entry.label;
          el.append(text);
        }
        if (entry.shortcut && !el.classList.contains('icon-only')) {
          const kbd = doc.createElement('kbd');
          kbd.setAttribute('aria-hidden', 'true');
          kbd.textContent = entry.shortcut;
          el.append(kbd);
        }
        el.addEventListener('click', () => {
          menu.close(true);
          entry.select();
        });
        parent.append(el);
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
  .group + .group {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--kujam-ui-border);
  }
  .group-label {
    padding: 4px 8px;
    color: var(--kujam-ui-ink-muted);
  }
  .entries {
    display: flex;
    flex-direction: column;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(var(--kujam-ui-columns, 5), 32px);
    gap: 4px;
    padding: 4px;
  }
  .icons {
    display: grid;
    grid-template-columns: repeat(var(--kujam-ui-columns, 6), 36px);
    gap: 2px;
    padding: 2px;
  }
  .option.icon-only {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
  }
  .option.swatch {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
  }
  .option.swatch::before {
    content: '';
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--kujam-ui-swatch);
    box-shadow: inset 0 0 0 1px var(--kujam-ui-border-strong);
  }
  .option.swatch[aria-checked='true']::before {
    box-shadow:
      inset 0 0 0 1px var(--kujam-ui-border-strong),
      0 0 0 2px var(--kujam-ui-surface),
      0 0 0 4px var(--kujam-ui-focus-ring);
  }
  .option kbd {
    margin-left: auto;
    padding-left: 16px;
    font: inherit;
    color: var(--kujam-ui-ink-muted);
  }
`;
