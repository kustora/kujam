/**
 * Main toolbar `<kujam-toolbar>` (BOARD-1402).
 *
 * Shows the built-in tools that are registered on the board, in DESIGN.md order, then the
 * `toolbarItems` of installed plugins after a separator. Tools with several variants (shapes) are
 * one button with a popover menu. The toolbar is a single tab stop with roving focus (arrow keys,
 * Home, End); every button has its label and shortcut in its accessible name.
 */

import type { Board } from '@kujam/core';
import { createElementClass, type UiWindow } from './base.js';
import { createIcon } from './icons.js';
import { t, type UiStringKey } from './i18n.js';
import { CONTROL_CSS, createMenu, labelButton, shortcutFor, type PopupMenu } from './controls.js';

/**
 * A variant inside a toolbar item's popover, for example one shape.
 *
 * @public
 */
export interface ToolbarOption {
  readonly id: string;
  readonly label: string;
  readonly icon: string | undefined;
  /** Formatted shortcut, for example `R`. */
  readonly shortcut: string | undefined;
  readonly toolId: string;
}

/**
 * One button of the toolbar.
 *
 * @public
 */
export interface ToolbarItem {
  readonly id: string;
  readonly label: string;
  readonly icon: string | undefined;
  /** Formatted shortcut, for example `V` or `⌘K`. */
  readonly shortcut: string | undefined;
  /** Tool activated by the button (single tools and plugin tool items). */
  readonly toolId: string | undefined;
  /** Command run by the button (plugin command items). */
  readonly commandId: string | undefined;
  /** Variants shown in a popover; the button activates the last chosen one. */
  readonly options: readonly ToolbarOption[] | undefined;
  /** `tools` for built-in tools, `plugins` for plugin items (after a separator). */
  readonly section: 'tools' | 'plugins';
}

interface BuiltIn {
  readonly id: string;
  readonly label: UiStringKey;
  readonly icon: string;
  /** Tool IDs shown as variants in a popover, in order. */
  readonly variants?: readonly { readonly toolId: string; readonly label: UiStringKey }[];
}

/** Built-in tools in DESIGN.md toolbar order; missing tools are skipped. */
const BUILT_INS: readonly BuiltIn[] = [
  { id: 'select', label: 'tool.select', icon: 'select' },
  { id: 'hand', label: 'tool.hand', icon: 'hand' },
  { id: 'sticky', label: 'tool.sticky', icon: 'sticky' },
  { id: 'draw', label: 'tool.draw', icon: 'draw' },
  {
    id: 'shape',
    label: 'tool.shape',
    icon: 'shape',
    variants: [
      { toolId: 'rectangle', label: 'tool.rectangle' },
      { toolId: 'ellipse', label: 'tool.ellipse' },
    ],
  },
  { id: 'text', label: 'tool.text', icon: 'text' },
  { id: 'eraser', label: 'tool.eraser', icon: 'eraser' },
];

/**
 * Toolbar items for a board (BOARD-1402): registered built-in tools, then plugin `toolbarItems`
 * sorted by group, order, and ID. Plugin items for tools that are not registered, or that the
 * built-in part already shows, are left out.
 *
 * @public
 */
export function buildToolbarItems(board: Board): ToolbarItem[] {
  const locale = board.locale;
  const items: ToolbarItem[] = [];
  const shown = new Set<string>();

  for (const builtIn of BUILT_INS) {
    if (builtIn.variants) {
      const options: ToolbarOption[] = builtIn.variants
        .filter((v) => board.tools.get(v.toolId))
        .map((v) => ({
          id: v.toolId,
          label: t(v.label, locale),
          icon: v.toolId,
          shortcut: shortcutFor(board, `tool:${v.toolId}`),
          toolId: v.toolId,
        }));
      if (options.length === 0) continue;
      for (const option of options) shown.add(option.toolId);
      if (options.length === 1) {
        const only = options[0]!;
        items.push({ ...only, commandId: undefined, options: undefined, section: 'tools' });
        continue;
      }
      items.push({
        id: builtIn.id,
        label: t(builtIn.label, locale),
        icon: builtIn.icon,
        shortcut: undefined,
        toolId: undefined,
        commandId: undefined,
        options,
        section: 'tools',
      });
      continue;
    }
    if (!board.tools.get(builtIn.id)) continue;
    shown.add(builtIn.id);
    items.push({
      id: builtIn.id,
      label: t(builtIn.label, locale),
      icon: builtIn.icon,
      shortcut: shortcutFor(board, `tool:${builtIn.id}`),
      toolId: builtIn.id,
      commandId: undefined,
      options: undefined,
      section: 'tools',
    });
  }

  const pluginItems = board.plugins
    .list()
    .flatMap((plugin) => plugin.toolbarItems ?? [])
    .filter((item) => {
      if (item.toolId !== undefined)
        return !!board.tools.get(item.toolId) && !shown.has(item.toolId);
      return item.commandId !== undefined && board.commands.has(item.commandId);
    })
    .sort(
      (a, b) =>
        (a.group ?? '').localeCompare(b.group ?? '') ||
        (a.order ?? 0) - (b.order ?? 0) ||
        a.id.localeCompare(b.id),
    );
  for (const item of pluginItems) {
    items.push({
      id: item.id,
      label: item.label,
      icon: item.icon,
      shortcut: shortcutFor(board, item.toolId ? `tool:${item.toolId}` : item.commandId!),
      toolId: item.toolId,
      commandId: item.toolId ? undefined : item.commandId,
      options: undefined,
      section: 'plugins',
    });
  }
  return items;
}

const CSS = `
  :host {
    display: inline-block;
    position: relative;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: var(--kujam-ui-radius-xl);
    background: var(--kujam-ui-surface);
    border: 1px solid var(--kujam-ui-border);
    box-shadow: var(--kujam-ui-shadow-float);
  }
  .item {
    position: relative;
  }
  .tool {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: var(--kujam-ui-radius-lg);
    background: transparent;
    color: var(--kujam-ui-ink-muted);
    cursor: pointer;
    transition: background-color var(--kujam-ui-motion), color var(--kujam-ui-motion);
  }
  .tool:hover {
    background: var(--kujam-ui-surface-hover);
    color: var(--kujam-ui-ink);
  }
  .tool[aria-pressed='true'] {
    background: var(--kujam-ui-surface-inverse);
    color: var(--kujam-ui-on-inverse);
  }
  .tool:disabled {
    color: var(--kujam-ui-ink-disabled);
    cursor: default;
    background: transparent;
  }
  .fallback {
    font-weight: 600;
    font-size: 14px;
  }
  .caret {
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-bottom: 4px solid currentColor;
    opacity: 0.7;
  }
  .sep {
    width: 1px;
    height: 24px;
    margin: 0 4px;
    background: var(--kujam-ui-border-strong);
  }
  ${CONTROL_CSS}
`;

interface RenderedItem {
  readonly item: ToolbarItem;
  readonly button: HTMLButtonElement;
  readonly menu: PopupMenu | null;
}

/** Renders the toolbar for a board; returns the cleanup. */
function renderToolbar(root: ShadowRoot, board: Board, host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  /** Last chosen variant per popover item. */
  const choice = new Map<string, ToolbarOption>();
  const rendered: RenderedItem[] = [];

  const bar = doc.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-orientation', 'horizontal');
  bar.setAttribute('aria-label', t('toolbar', board.locale));
  root.append(bar);

  function iconOrLetter(icon: string | undefined, label: string): Node {
    const svg = createIcon(doc, icon);
    if (svg) return svg;
    const span = doc.createElement('span');
    span.className = 'fallback';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = label.trim().charAt(0).toUpperCase();
    return span;
  }

  function currentVariant(item: ToolbarItem): ToolbarOption {
    const options = item.options!;
    return options.find((o) => o.toolId === board.tool) ?? choice.get(item.id) ?? options[0]!;
  }

  function openMenu(): PopupMenu | undefined {
    return rendered.find((r) => r.menu?.isOpen)?.menu ?? undefined;
  }

  function closeMenus(): void {
    for (const r of rendered) r.menu?.close();
  }

  for (const item of buildToolbarItems(board)) {
    if (item.section === 'plugins' && rendered.every((r) => r.item.section !== 'plugins')) {
      const sep = doc.createElement('div');
      sep.className = 'sep';
      sep.setAttribute('role', 'separator');
      sep.setAttribute('aria-orientation', 'vertical');
      bar.append(sep);
    }
    const wrap = doc.createElement('div');
    wrap.className = 'item';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'tool';
    button.tabIndex = -1;
    button.dataset.item = item.id;
    wrap.append(button);
    bar.append(wrap);

    let menu: PopupMenu | null = null;
    if (item.options) {
      const popup = createMenu(doc, {
        id: `kujam-menu-${item.id}`,
        label: item.label,
        anchor: button,
        wrap,
        radio: true,
      });
      menu = popup;
      button.addEventListener('click', () => {
        if (popup.isOpen) popup.close();
        else if (item.options!.some((o) => o.toolId === board.tool)) {
          closeMenus();
          popup.open();
        } else board.setTool(currentVariant(item).toolId);
      });
      button.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || (e.key === 'ArrowDown' && e.altKey)) {
          e.preventDefault();
          closeMenus();
          popup.open();
        }
      });
    } else {
      button.addEventListener('click', () => {
        if (item.toolId) board.setTool(item.toolId);
        else if (item.commandId) board.run(item.commandId);
      });
    }
    rendered.push({ item, button, menu });
  }

  /** Updates icons, labels, pressed and disabled states, menus, and the roving tab stop. */
  function sync(): void {
    for (const { item, button, menu } of rendered) {
      let label = item.label;
      let shortcut = item.shortcut;
      let icon = item.icon;
      if (item.options) {
        const variant = currentVariant(item);
        icon = variant.icon;
        shortcut = variant.shortcut;
        label = `${item.label}: ${variant.label}`;
        if (!menu!.isOpen) {
          menu!.setEntries(
            item.options.map((option) => ({
              id: option.toolId,
              label: option.label,
              shortcut: option.shortcut,
              icon: iconOrLetter(option.icon, option.label),
              checked: option.toolId === variant.toolId,
              select: () => {
                choice.set(item.id, option);
                board.setTool(option.toolId);
              },
            })),
          );
        }
      }
      if (button.dataset.icon !== icon || !button.firstChild) {
        button.dataset.icon = icon ?? '';
        button.replaceChildren(iconOrLetter(icon, label));
        if (item.options) {
          const caret = doc.createElement('span');
          caret.className = 'caret';
          caret.setAttribute('aria-hidden', 'true');
          button.append(caret);
        }
      }
      labelButton(button, label, shortcut);

      if (item.commandId) {
        button.disabled = !board.commands.isEnabled(item.commandId);
        button.removeAttribute('aria-pressed');
      } else {
        const pressed = item.options
          ? item.options.some((o) => o.toolId === board.tool)
          : board.tool === item.toolId;
        button.setAttribute('aria-pressed', String(pressed));
      }
    }
    // One tab stop: keep the focused button, else the active tool, else the first button.
    const focused = rendered.find((r) => r.button.tabIndex === 0 && !r.button.disabled);
    const active = rendered.find((r) => r.button.getAttribute('aria-pressed') === 'true');
    const stop = focused ?? active ?? rendered.find((r) => !r.button.disabled);
    for (const r of rendered) r.button.tabIndex = r === stop ? 0 : -1;
  }

  bar.addEventListener('keydown', (e) => {
    if (openMenu()?.element.contains(e.target as Node)) return;
    const enabled = rendered.filter((r) => !r.button.disabled);
    const index = enabled.findIndex((r) => r.button === e.target);
    if (index < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    closeMenus();
    for (const r of rendered) r.button.tabIndex = -1;
    enabled[next]!.button.tabIndex = 0;
    enabled[next]!.button.focus();
  });

  // Close an open menu on a pointer down anywhere outside the toolbar.
  const onPointerDown = (e: Event): void => {
    if (openMenu() && !e.composedPath().includes(host)) closeMenus();
  };
  doc.addEventListener('pointerdown', onPointerDown, true);

  sync();
  const offs = [board.on('tool', sync)];
  // Command availability can depend on the selection and the document; tools only on the tool.
  if (rendered.some((r) => r.item.commandId)) {
    offs.push(board.on('selection', sync), board.on('change', sync));
  }
  return () => {
    for (const off of offs) off();
    doc.removeEventListener('pointerdown', onPointerDown, true);
  };
}

/**
 * Creates the `<kujam-toolbar>` class for a window.
 *
 * @internal
 */
export function createToolbarClass(win: UiWindow) {
  return createElementClass(win, { css: CSS, render: renderToolbar });
}
