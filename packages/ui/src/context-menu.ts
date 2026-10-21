/**
 * Default context menu component `<kujam-context-menu>` (BOARD-1408).
 *
 * Displays context menu items from renderer events (BOARD-912) floating at the cursor,
 * with full keyboard accessibility (Arrow keys, Home, End, Enter, Escape) and auto-clamping
 * to viewport/container edges.
 */

import type { Board, ContextMenuEvent, ContextMenuItem } from '@kujam/core';
import { createElementClass, type KujamUiElement, type UiWindow } from './base.js';
import { createIcon } from './icons.js';
import { t } from './i18n.js';

/**
 * Context menu custom element interface (BOARD-1408).
 *
 * @public
 */
export interface ContextMenuElement extends KujamUiElement {
  /** Opens the context menu with the given event data. */
  open(event: ContextMenuEvent): void;
  /** Closes the context menu overlay. */
  close(): void;
  /** Whether the context menu is currently open. */
  readonly isOpen: boolean;
}

const CONTEXT_MENU_CSS = `
  :host {
    display: block;
    position: absolute;
    z-index: 50;
    pointer-events: auto;
  }
  :host([hidden]) {
    display: none !important;
  }
  .menu {
    display: flex;
    flex-direction: column;
    min-width: 180px;
    max-width: 280px;
    padding: 4px;
    border-radius: var(--kujam-ui-radius-lg);
    background: var(--kujam-ui-surface);
    border: 1px solid var(--kujam-ui-border);
    box-shadow: var(--kujam-ui-shadow-float);
    user-select: none;
    outline: none;
  }
  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--kujam-ui-radius-md);
    background: transparent;
    color: var(--kujam-ui-ink);
    font: var(--kujam-ui-font);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--kujam-ui-motion), color var(--kujam-ui-motion);
    outline: none;
  }
  .menu-item:hover,
  .menu-item:focus-visible {
    background: var(--kujam-ui-surface-hover);
    color: var(--kujam-ui-ink);
  }
  .menu-item:disabled {
    color: var(--kujam-ui-ink-disabled);
    background: transparent;
    cursor: default;
    pointer-events: none;
  }
  .menu-item.danger {
    color: #E5484D;
  }
  .menu-item.danger:hover,
  .menu-item.danger:focus-visible {
    background: rgba(229, 72, 77, 0.1);
    color: #E5484D;
  }
  .item-left {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-icon {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  .item-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-shortcut {
    font-family: inherit;
    font-size: 11px;
    color: var(--kujam-ui-ink-muted);
    flex-shrink: 0;
  }
  .separator {
    height: 1px;
    margin: 4px 2px;
    background: var(--kujam-ui-border);
  }
`;

/**
 * Creates the `<kujam-context-menu>` element class for `win` (BOARD-1408).
 *
 * @internal
 */
export function createContextMenuClass(win: UiWindow): new () => ContextMenuElement {
  return createElementClass(win, {
    css: CONTEXT_MENU_CSS,
    render(root, board, host) {
      host.hidden = true;
      const doc = host.ownerDocument;

      const menuWrap = doc.createElement('div');
      menuWrap.className = 'menu';
      menuWrap.setAttribute('role', 'menu');
      menuWrap.setAttribute('aria-label', t('contextMenu', board));
      menuWrap.tabIndex = -1;
      root.append(menuWrap);

      let currentItems: readonly ContextMenuItem[] = [];

      function getEnabledButtons(): HTMLButtonElement[] {
        return [...menuWrap.querySelectorAll<HTMLButtonElement>('.menu-item:not([disabled])')];
      }

      function closeMenu(): void {
        if (host.hidden) return;
        host.hidden = true;
        menuWrap.replaceChildren();
        currentItems = [];
      }

      function openMenu(event: ContextMenuEvent): void {
        if (event.defaultPrevented || event.items.length === 0) return;
        currentItems = event.items;
        menuWrap.replaceChildren();

        for (const item of currentItems) {
          if (item.separator) {
            const sep = doc.createElement('div');
            sep.className = 'separator';
            sep.setAttribute('role', 'separator');
            menuWrap.append(sep);
            continue;
          }

          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = `menu-item${item.danger ? ' danger' : ''}`;
          btn.setAttribute('role', 'menuitem');
          btn.dataset.id = item.id;
          btn.disabled = Boolean(item.disabled);

          const left = doc.createElement('span');
          left.className = 'item-left';

          if (item.icon) {
            const iconEl = doc.createElement('span');
            iconEl.className = 'item-icon';
            const svg = createIcon(doc, item.icon as never);
            if (svg) iconEl.append(svg);
            left.append(iconEl);
          }

          const label = doc.createElement('span');
          label.className = 'item-label';
          label.textContent = item.label;
          left.append(label);
          btn.append(left);

          if (item.shortcut) {
            const kbd = doc.createElement('kbd');
            kbd.className = 'item-shortcut';
            kbd.textContent = item.shortcut;
            btn.append(kbd);
          }

          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            item.run();
          });

          menuWrap.append(btn);
        }

        // Show temporarily to measure
        host.hidden = false;
        host.style.visibility = 'hidden';

        const parent = host.offsetParent as HTMLElement | null;
        const parentRect = parent ? parent.getBoundingClientRect() : {
          left: 0,
          top: 0,
          width: win.innerWidth,
          height: win.innerHeight,
        };

        const targetClient = event.client ?? {
          x: parentRect.left + event.screen.x,
          y: parentRect.top + event.screen.y,
        };

        const menuWidth = menuWrap.offsetWidth || 200;
        const menuHeight = menuWrap.offsetHeight || 250;

        let posX = targetClient.x - parentRect.left;
        let posY = targetClient.y - parentRect.top;

        if (posX + menuWidth > parentRect.width) {
          posX = Math.max(8, posX - menuWidth);
        }
        if (posY + menuHeight > parentRect.height) {
          posY = Math.max(8, posY - menuHeight);
        }

        host.style.left = `${posX}px`;
        host.style.top = `${posY}px`;
        host.style.visibility = 'visible';

        // Focus first enabled item
        const first = getEnabledButtons()[0];
        if (first) {
          first.focus();
        } else {
          menuWrap.focus();
        }
      }

      // Keyboard navigation
      menuWrap.addEventListener('keydown', (e) => {
        const buttons = getEnabledButtons();
        const currentIndex = buttons.indexOf(doc.activeElement as HTMLButtonElement);

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (buttons.length > 0) {
            const next = (currentIndex + 1) % buttons.length;
            buttons[next]?.focus();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (buttons.length > 0) {
            const prev = (currentIndex - 1 + buttons.length) % buttons.length;
            buttons[prev]?.focus();
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          buttons[0]?.focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          buttons[buttons.length - 1]?.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeMenu();
        }
      });

      // Outside pointer click dismisses menu
      const onDocumentPointerDown = (e: PointerEvent): void => {
        if (host.hidden) return;
        if (!e.composedPath().includes(host)) {
          closeMenu();
        }
      };

      win.addEventListener('pointerdown', onDocumentPointerDown, { capture: true });

      // Board subscriptions
      const unbindContextMenu = board.on('contextmenu', (event) => {
        openMenu(event);
      });

      const unbindCamera = board.on('camera', () => {
        closeMenu();
      });

      // Expose imperative API
      Object.assign(host, {
        open: openMenu,
        close: closeMenu,
      });
      Object.defineProperty(host, 'isOpen', {
        get() {
          return !host.hidden;
        },
        configurable: true,
      });

      return () => {
        win.removeEventListener('pointerdown', onDocumentPointerDown, { capture: true });
        unbindContextMenu();
        unbindCamera();
        closeMenu();
      };
    },
  }) as unknown as new () => ContextMenuElement;
}
