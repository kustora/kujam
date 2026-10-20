/**
 * Base for the UI custom elements (BOARD-1401).
 *
 * Classes are created per window by a factory instead of at module load, so importing
 * `@kujam/ui` is safe without a DOM (SSR, Node, workers) and the elements can be defined in another
 * window such as an iframe. Each element:
 *
 * - renders into an open Shadow DOM styled only with `--kujam-ui-*` custom properties;
 * - adopts its styles as a Constructable Stylesheet, so a strict Content Security Policy without
 *   `style-src 'unsafe-inline'` works (BOARD-2006); only browsers without `adoptedStyleSheets` fall
 *   back to a `<style>` element, which such a policy blocks;
 * - receives its board through the `board` property and listens to it only while connected;
 * - follows the board theme by reflecting `board.theme.mode` to `data-theme` on the host.
 */

import type { Board } from '@kujam/core';
import { BASE_CSS } from './theme.js';

/** Window whose DOM classes the elements extend. */
export type UiWindow = Window & typeof globalThis;

/**
 * Common shape of every `@kujam/ui` element.
 *
 * @public
 */
export interface KujamUiElement extends HTMLElement {
  /**
   * Board the element controls. The element listens to it while connected to the document;
   * assigning another board (or `null`) moves the listeners.
   */
  board: Board | null;
}

/** Hooks a concrete element implements. */
export interface ElementHooks {
  /** Component styles, appended after the shared base styles. */
  readonly css: string;
  /**
   * Renders for `board` into `root` and subscribes to what it needs. Returns a cleanup that
   * removes the subscriptions. `root` is emptied before every call.
   */
  render(root: ShadowRoot, board: Board, host: HTMLElement): () => void;
}

/**
 * Creates a custom element class for `win` from `hooks`.
 *
 * @internal
 */
export function createElementClass(win: UiWindow, hooks: ElementHooks): new () => KujamUiElement {
  const css = BASE_CSS + hooks.css;
  // One sheet per element class and window, shared by every instance; created on first use.
  let sheet: CSSStyleSheet | null | undefined;

  return class extends win.HTMLElement implements KujamUiElement {
    #board: Board | null = null;
    #cleanup: (() => void) | null = null;
    readonly #root: ShadowRoot;

    constructor() {
      super();
      this.#root = this.attachShadow({ mode: 'open' });
      if (sheet === undefined) sheet = createSheet(win, css);
      if (sheet) this.#root.adoptedStyleSheets = [sheet];
    }

    get board(): Board | null {
      return this.#board;
    }

    set board(board: Board | null) {
      if (board === this.#board) return;
      this.#unbind();
      this.#board = board ?? null;
      if (this.isConnected) this.#bind();
    }

    connectedCallback(): void {
      this.#bind();
    }

    disconnectedCallback(): void {
      this.#unbind();
    }

    #bind(): void {
      const board = this.#board;
      if (!board || this.#cleanup) return;
      this.#root.replaceChildren();
      if (board.disposed) return;

      if (!sheet) {
        const style = this.ownerDocument.createElement('style');
        style.textContent = css;
        this.#root.append(style);
      }

      const applyTheme = (): void => {
        this.dataset.theme = board.theme.mode;
      };
      applyTheme();
      const offTheme = board.on('theme', applyTheme);
      const offDispose = board.on('dispose', () => this.#unbind());
      const offRender = hooks.render(this.#root, board, this);
      this.#cleanup = () => {
        offTheme();
        offDispose();
        offRender();
      };
    }

    #unbind(): void {
      const cleanup = this.#cleanup;
      this.#cleanup = null;
      cleanup?.();
      this.#root.replaceChildren();
    }
  };
}

/**
 * Constructs a stylesheet with `css` in `win`, or `null` when the browser lacks Constructable
 * Stylesheets. CSP does not apply to constructed sheets, unlike `<style>` elements.
 */
function createSheet(win: UiWindow, css: string): CSSStyleSheet | null {
  if (!win.CSSStyleSheet || !win.ShadowRoot || !('adoptedStyleSheets' in win.ShadowRoot.prototype))
    return null;
  try {
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet;
  } catch {
    return null;
  }
}
