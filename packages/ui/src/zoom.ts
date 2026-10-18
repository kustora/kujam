/**
 * Zoom and history controls (BOARD-1404).
 *
 * - `<kujam-zoom-control>`: zoom out, the zoom percentage (a menu with 50%, 100%, 200%, and zoom
 *   to fit), and zoom in. Buttons step through fixed zoom levels and are disabled at the zoom
 *   range limits.
 * - `<kujam-history-control>`: undo and redo, disabled when there is nothing to undo or redo.
 */

import type { Board, ZoomRange } from '@kujam/core';
import { createElementClass, type UiWindow } from './base.js';
import { CONTROL_CSS, createMenu, labelButton, shortcutFor, type MenuEntry } from './controls.js';
import { createIcon } from './icons.js';
import { t } from './i18n.js';

/**
 * Zoom levels the zoom buttons step through, within the board's zoom range.
 *
 * @public
 */
export const ZOOM_STEPS: readonly number[] = Object.freeze([
  0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8,
]);

/** Relative tolerance so a zoom that is a step up to rounding counts as that step. */
const EPSILON = 1e-3;

/**
 * Next zoom level from `zoom` in a direction (BOARD-1404): the nearest step strictly above or
 * below, clamped to `range`.
 *
 * @public
 */
export function nextZoomStep(zoom: number, direction: 1 | -1, range: Readonly<ZoomRange>): number {
  const next =
    direction > 0
      ? (ZOOM_STEPS.find((step) => step > zoom * (1 + EPSILON)) ?? range.max)
      : ([...ZOOM_STEPS].reverse().find((step) => step < zoom * (1 - EPSILON)) ?? range.min);
  return Math.min(range.max, Math.max(range.min, next));
}

/** Zoom as a whole percentage, for example `125%`. */
function percent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

const CONTROL_STYLES = `
  :host {
    display: inline-block;
    position: relative;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: var(--kujam-ui-radius-lg);
    background: var(--kujam-ui-surface);
    border: 1px solid var(--kujam-ui-border);
    box-shadow: var(--kujam-ui-shadow-float);
  }
  .item {
    position: relative;
  }
  .btn {
    display: grid;
    place-items: center;
    min-width: 28px;
    height: 28px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--kujam-ui-radius-md);
    background: transparent;
    color: var(--kujam-ui-ink-muted);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
    transition: background-color var(--kujam-ui-motion), color var(--kujam-ui-motion);
  }
  .btn:hover {
    background: var(--kujam-ui-surface-hover);
    color: var(--kujam-ui-ink);
  }
  .btn:disabled {
    color: var(--kujam-ui-ink-disabled);
    background: transparent;
    cursor: default;
  }
  .percent {
    min-width: 52px;
    color: var(--kujam-ui-ink);
  }
  ${CONTROL_CSS}
  .menu {
    left: auto;
    right: 0;
    transform: none;
  }
  /* These controls sit at the screen edges: align edge tooltips inward so they stay on screen. */
  .group > .item:first-child > .tip {
    left: 0;
    transform: none;
  }
  .group > .item:last-child > .tip {
    left: auto;
    right: 0;
    transform: none;
  }
`;

function makeGroup(root: ShadowRoot, doc: Document, label: string): HTMLElement {
  const group = doc.createElement('div');
  group.className = 'group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  root.append(group);
  return group;
}

function makeButton(doc: Document, parent: HTMLElement, name: string): HTMLButtonElement {
  const wrap = doc.createElement('div');
  wrap.className = 'item';
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.dataset.control = name;
  wrap.append(button);
  parent.append(wrap);
  return button;
}

function renderZoom(root: ShadowRoot, board: Board, host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  const locale = board.locale;
  const group = makeGroup(root, doc, t('zoom', locale));

  const zoomOut = makeButton(doc, group, 'zoom-out');
  zoomOut.append(createIcon(doc, 'minus', 16)!);
  labelButton(zoomOut, t('zoomOut', locale), undefined);

  const level = makeButton(doc, group, 'zoom-level');
  level.classList.add('percent');
  const menu = createMenu(doc, {
    id: 'kujam-zoom-menu',
    label: t('zoomOptions', locale),
    anchor: level,
    wrap: level.parentElement!,
    radio: false,
  });

  const zoomIn = makeButton(doc, group, 'zoom-in');
  zoomIn.append(createIcon(doc, 'plus', 16)!);
  labelButton(zoomIn, t('zoomIn', locale), undefined);

  const step = (direction: 1 | -1): void => {
    board.camera.zoomTo(nextZoomStep(board.camera.get().zoom, direction, board.camera.zoomRange));
  };
  zoomOut.addEventListener('click', () => step(-1));
  zoomIn.addEventListener('click', () => step(1));

  function entries(): MenuEntry[] {
    const range = board.camera.zoomRange;
    const preset = (zoom: number): MenuEntry => ({
      id: `zoom-${zoom}`,
      label: percent(zoom),
      disabled: zoom < range.min || zoom > range.max,
      select: () => board.camera.zoomTo(zoom),
    });
    return [
      preset(0.5),
      preset(1),
      preset(2),
      {
        id: 'zoom-to-fit',
        label: t('zoomToFit', locale),
        shortcut: shortcutFor(board, 'camera.zoom-to-fit'),
        disabled: board.query().length === 0,
        select: () => void board.camera.zoomToFit(),
      },
    ];
  }

  level.addEventListener('click', () => {
    if (menu.isOpen) {
      menu.close();
      return;
    }
    menu.setEntries(entries());
    menu.open();
  });
  level.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || (e.key === 'ArrowDown' && e.altKey)) {
      e.preventDefault();
      menu.setEntries(entries());
      menu.open();
    }
  });

  const onPointerDown = (e: Event): void => {
    if (menu.isOpen && !e.composedPath().includes(host)) menu.close();
  };
  doc.addEventListener('pointerdown', onPointerDown, true);

  function sync(): void {
    const { zoom } = board.camera.get();
    const range = board.camera.zoomRange;
    const text = percent(zoom);
    if (level.textContent !== text) level.textContent = text;
    labelButton(level, t('zoomLevel', locale).replace('{percent}', text), undefined);
    zoomOut.disabled = zoom <= range.min * (1 + EPSILON);
    zoomIn.disabled = zoom >= range.max * (1 - EPSILON);
  }
  sync();
  const off = board.on('camera', sync);
  return () => {
    off();
    doc.removeEventListener('pointerdown', onPointerDown, true);
  };
}

function renderHistory(root: ShadowRoot, board: Board, host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  const locale = board.locale;
  const group = makeGroup(root, doc, t('history', locale));

  const undo = makeButton(doc, group, 'undo');
  undo.append(createIcon(doc, 'undo', 16)!);
  labelButton(undo, t('undo', locale), shortcutFor(board, 'history.undo'));
  undo.addEventListener('click', () => board.undo());

  const redo = makeButton(doc, group, 'redo');
  redo.append(createIcon(doc, 'redo', 16)!);
  labelButton(redo, t('redo', locale), shortcutFor(board, 'history.redo'));
  redo.addEventListener('click', () => board.redo());

  function sync(): void {
    undo.disabled = !board.history.canUndo;
    redo.disabled = !board.history.canRedo;
  }
  sync();
  return board.on('history', sync);
}

/**
 * Creates the `<kujam-zoom-control>` class for a window.
 *
 * @internal
 */
export function createZoomControlClass(win: UiWindow) {
  return createElementClass(win, { css: CONTROL_STYLES, render: renderZoom });
}

/**
 * Creates the `<kujam-history-control>` class for a window.
 *
 * @internal
 */
export function createHistoryControlClass(win: UiWindow) {
  return createElementClass(win, { css: CONTROL_STYLES, render: renderHistory });
}
