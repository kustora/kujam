/**
 * `@kujam/ui` — Framework-free Web Components UI (toolbar, minimap, command palette).
 *
 * @packageDocumentation
 */

import type { Board } from '@kujam/core';
import type { KujamUiElement, UiWindow } from './base.js';
import { createToolbarClass } from './toolbar.js';

export type { KujamUiElement } from './base.js';
export { buildToolbarItems, type ToolbarItem, type ToolbarOption } from './toolbar.js';
export { UI_ICON_NAMES } from './icons.js';
export { uiToken, type UiTokenName } from './theme.js';

/**
 * Tag names of the UI elements.
 *
 * @public
 */
export const UI_TAGS = Object.freeze({ toolbar: 'kujam-toolbar' } as const);

/**
 * Registers the UI custom elements in a window's `customElements` (BOARD-1401). Safe to call
 * more than once; tags that are already defined are left alone.
 *
 * @param win - Window to define the elements in. Defaults to the global `window`.
 * @throws `Error` when there is no window with `customElements` (for example on a server).
 * @public
 */
export function defineUiElements(win?: Window): void {
  const target = (win ?? (typeof window === 'undefined' ? undefined : window)) as
    UiWindow | undefined;
  if (!target?.customElements || !target.HTMLElement) {
    throw new Error('defineUiElements membutuhkan window dengan customElements.');
  }
  if (!target.customElements.get(UI_TAGS.toolbar)) {
    target.customElements.define(UI_TAGS.toolbar, createToolbarClass(target));
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
  /** The main toolbar element. */
  readonly toolbar: KujamUiElement;
  /** Removes the UI elements. Safe to call more than once. */
  unmount(): void;
}

/**
 * Mounts the default UI over a board: the main toolbar at the bottom center (BOARD-1402).
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

  const toolbar = doc.createElement(UI_TAGS.toolbar) as KujamUiElement;
  toolbar.board = board;
  Object.assign(toolbar.style, {
    position: 'absolute',
    left: '50%',
    bottom: '20px',
    transform: 'translateX(-50%)',
    zIndex: '30',
  });
  container.append(toolbar);

  return {
    toolbar,
    unmount() {
      toolbar.board = null;
      toolbar.remove();
    },
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'kujam-toolbar': KujamUiElement;
  }
}
