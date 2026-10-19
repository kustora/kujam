/**
 * `@kujam/ui` — Framework-free Web Components UI (toolbar, minimap, command palette).
 *
 * @packageDocumentation
 */

import type { Board } from '@kujam/core';
import type { KujamUiElement, UiWindow } from './base.js';
import { createCommandPaletteClass } from './command-palette.js';
import { createMinimapClass } from './minimap.js';
import { createSelectionToolbarClass } from './selection-toolbar.js';
import { createToolbarClass } from './toolbar.js';
import { createHistoryControlClass, createZoomControlClass } from './zoom.js';

export type { KujamUiElement } from './base.js';
export {
  createCommandPaletteClass,
  type CommandPaletteItem,
  type CommandPaletteSource,
} from './command-palette.js';
export { createMinimapClass, MINIMAP_SIZE } from './minimap.js';
export {
  buildToolbarItems,
  type ToolbarItem,
  type ToolbarOption,
  type ToolbarStyleGroup,
  type ToolbarStyleOption,
} from './toolbar.js';
export { UI_ICON_NAMES } from './icons.js';
export { nextZoomStep, ZOOM_STEPS } from '@kujam/core';
export { uiToken, type UiTokenName } from './theme.js';

/**
 * Tag names of the UI elements.
 *
 * @public
 */
export const UI_TAGS = Object.freeze({
  toolbar: 'kujam-toolbar',
  zoom: 'kujam-zoom-control',
  history: 'kujam-history-control',
  selection: 'kujam-selection-toolbar',
  commandPalette: 'kujam-command-palette',
  minimap: 'kujam-minimap',
} as const);

/**
 * Registers the UI custom elements in a window's `customElements` (BOARD-1401, BOARD-1403). Safe
 * to call more than once; tags that are already defined are left alone.
 *
 * @param win - Window to define the elements in. Defaults to the global `window`.
 * @throws `Error` when there is no window with `customElements` (for example on a server).
 * @public
 */
export function defineUiElements(win?: Window): void {
  const target = (win ?? (typeof window === 'undefined' ? undefined : window)) as
    | UiWindow
    | undefined;
  if (!target?.customElements || !target.HTMLElement) {
    throw new Error('defineUiElements membutuhkan window dengan customElements.');
  }
  const factories = {
    [UI_TAGS.toolbar]: createToolbarClass,
    [UI_TAGS.zoom]: createZoomControlClass,
    [UI_TAGS.history]: createHistoryControlClass,
    [UI_TAGS.selection]: createSelectionToolbarClass,
    [UI_TAGS.commandPalette]: createCommandPaletteClass,
    [UI_TAGS.minimap]: createMinimapClass,
  };
  for (const [tag, create] of Object.entries(factories)) {
    if (!target.customElements.get(tag)) target.customElements.define(tag, create(target));
  }
}

/**
 * Options for {@link mountDefaultUi}.
 *
 * @public
 */
export interface MountUiOptions {
  readonly board: Board;
  /**
   * Element the UI floats over, usually the board view's container. Its position is set to
   * `relative` when it is `static`, so the UI can be placed inside it.
   */
  readonly container: HTMLElement;
}

/**
 * Handle returned by {@link mountDefaultUi}.
 *
 * @public
 */
export interface MountedUi {
  /** The main toolbar element, at the bottom center. */
  readonly toolbar: KujamUiElement;
  /** The zoom control, at the bottom right (BOARD-1404). */
  readonly zoom: KujamUiElement;
  /** The undo and redo control, at the bottom left (BOARD-1404). */
  readonly history: KujamUiElement;
  /** Contextual selection toolbar floating above the selection (BOARD-1403). */
  readonly selection: KujamUiElement;
  /** The minimap element, at the bottom right above zoom control (BOARD-1406). */
  readonly minimap: KujamUiElement;
  /** The command palette overlay element (BOARD-1405). */
  readonly commandPalette: KujamUiElement;
  /** Removes the UI elements. Safe to call more than once. */
  unmount(): void;
}

/**
 * Mounts the default UI over a board: the main toolbar at the bottom center (BOARD-1402), the
 * zoom control at the bottom right, undo/redo at the bottom left (BOARD-1404), the
 * contextual selection toolbar above the active selection (BOARD-1403), the minimap above the
 * zoom control (BOARD-1406), and the command palette dialog overlay (BOARD-1405).
 *
 * @example
 * ```ts
 * const view = mountRenderer(board, container);
 * const ui = mountDefaultUi({ board, container });
 * // later
 * ui.unmount();
 * ```
 * @public
 */
export function mountDefaultUi(options: MountUiOptions): MountedUi {
  const { board, container } = options;
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error('Container wajib berada di dokumen yang punya window.');
  defineUiElements(win);

  const position = win.getComputedStyle(container).position;
  if (!position || position === 'static') {
    container.style.position = 'relative';
  }

  const place = (tag: string, style: Partial<CSSStyleDeclaration>): KujamUiElement => {
    const el = doc.createElement(tag) as KujamUiElement;
    el.board = board;
    Object.assign(el.style, { position: 'absolute', bottom: '20px', zIndex: '30' }, style);
    container.append(el);
    return el;
  };
  const toolbar = place(UI_TAGS.toolbar, { left: '50%', transform: 'translateX(-50%)' });
  const zoom = place(UI_TAGS.zoom, { right: '20px' });
  const minimap = place(UI_TAGS.minimap, { bottom: '80px', right: '20px' });
  const history = place(UI_TAGS.history, { left: '20px' });
  const selection = place(UI_TAGS.selection, { bottom: 'auto', zIndex: '25' });
  const commandPalette = place(UI_TAGS.commandPalette, {
    position: 'fixed',
    inset: '0',
    bottom: 'auto',
    left: 'auto',
    right: 'auto',
    top: 'auto',
    pointerEvents: 'none',
    zIndex: '1000',
  });

  return {
    toolbar,
    zoom,
    history,
    selection,
    minimap,
    commandPalette,
    unmount() {
      for (const el of [toolbar, zoom, history, selection, minimap, commandPalette]) {
        el.board = null;
        el.remove();
      }
    },
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'kujam-toolbar': KujamUiElement;
    'kujam-zoom-control': KujamUiElement;
    'kujam-history-control': KujamUiElement;
    'kujam-selection-toolbar': KujamUiElement;
    'kujam-command-palette': KujamUiElement;
    'kujam-minimap': KujamUiElement;
  }
}
