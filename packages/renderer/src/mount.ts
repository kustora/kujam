/**
 * `mountRenderer` and the three-layer skeleton (BOARD-801, ADR-003).
 *
 * The view stacks three layers inside one root element: the main Canvas 2D (elements), the HTML
 * layer (custom elements rendered as DOM), and the overlay canvas (selection, handles, snap
 * guides). It follows the container size with a `ResizeObserver`, reports that size to
 * `board.camera.setViewport`, and coalesces render requests into one `requestAnimationFrame`.
 *
 * Every browser API is taken from the container's own window, and nothing is shared between
 * views, so several boards (or iframes) on one page never affect each other.
 */

import type { Board, ViewportSize } from '@kujam/core';

/**
 * Options for {@link mountRenderer}.
 *
 * @public
 */
export interface RendererOptions {
  /**
   * Device pixel ratio for the canvas backing stores. Defaults to the container window's
   * `devicePixelRatio` (1 when unavailable).
   */
  // TODO(BOARD-803): follow DPR changes and cap the canvas area (about 16 million pixels, ADR-003).
  readonly pixelRatio?: number;
}

/**
 * DOM layers of a mounted view, bottom to top. Owned by the renderer: read them, but do not move
 * or remove them.
 *
 * @public
 */
export interface RendererLayers {
  /** Root element appended to the container; fills the container and clips its content. */
  readonly root: HTMLDivElement;
  /** Main Canvas 2D for elements. */
  readonly canvas: HTMLCanvasElement;
  /** Layer for elements rendered as DOM (`render.html`). */
  readonly html: HTMLDivElement;
  /** Overlay canvas for selection, handles, the selection box, and snap guides. */
  readonly overlay: HTMLCanvasElement;
}

/**
 * Handle for a board view mounted in the DOM.
 *
 * @public
 */
export interface BoardView {
  /** The board this view renders. */
  readonly board: Board;
  /** The element the view was mounted into. */
  readonly container: HTMLElement;
  /** The view's DOM layers. */
  readonly layers: RendererLayers;
  /** Last measured size of the view in CSS pixels; also reported to `board.camera.setViewport`. */
  readonly size: Readonly<ViewportSize>;
  /** Device pixel ratio used for the canvas backing stores. */
  readonly pixelRatio: number;
  /** `false` after {@link BoardView.unmount}, or after the board was disposed. */
  readonly mounted: boolean;
  /**
   * Schedules a render on the next animation frame. Several calls before that frame produce one
   * render. No effect after unmount.
   */
  requestRender(): void;
  /**
   * Removes the DOM layers and releases the `ResizeObserver`, board listeners, and any pending
   * animation frame. Safe to call more than once. Also runs automatically when the board is
   * disposed.
   */
  unmount(): void;
}

/** Window APIs the renderer needs; taken from the container's own window. */
type ViewWindow = Window & typeof globalThis;

/** Board events that change what is drawn. */
const RENDER_EVENTS = ['change', 'camera', 'selection', 'page', 'tool'] as const;

function createLayer<K extends 'div' | 'canvas'>(
  doc: Document,
  tag: K,
  name: string,
  interactive: boolean,
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  el.dataset.kujamLayer = name;
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  if (!interactive) el.style.pointerEvents = 'none';
  return el;
}

function resolvePixelRatio(options: RendererOptions, win: ViewWindow | null): number {
  if (options.pixelRatio !== undefined) {
    const ratio = options.pixelRatio;
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) {
      throw new RangeError('Opsi pixelRatio wajib berupa angka berhingga lebih dari 0.');
    }
    return ratio;
  }
  const ratio = win?.devicePixelRatio;
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/** Clamps a measured length to a finite, non-negative number of CSS pixels. */
function cssLength(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Mounts the three-layer board renderer into a DOM container element (BOARD-801).
 *
 * The container keeps its own styles; the renderer appends one root element that fills it, so the
 * container needs a size (for example `width: 100%; height: 100%` inside a sized parent).
 *
 * @example
 * ```ts
 * const board = createBoard({ plugins: [defaultElements, defaultTools] });
 * const view = mountRenderer(board, document.getElementById('board')!);
 * // later
 * view.unmount();
 * ```
 *
 * @throws `TypeError` when `container` is not a DOM element, `RangeError` for an invalid
 *   `pixelRatio`, or `Error` when the board is already disposed.
 * @public
 */
export function mountRenderer(
  board: Board,
  container: HTMLElement,
  options: RendererOptions = {},
): BoardView {
  if (board.disposed) throw new Error('Papan sudah di-dispose.');
  const doc = (container as Partial<HTMLElement> | null)?.ownerDocument;
  if (!doc || typeof container.appendChild !== 'function') {
    throw new TypeError('Argumen container pada mountRenderer wajib berupa elemen DOM.');
  }
  const win = doc.defaultView as ViewWindow | null;
  const pixelRatio = resolvePixelRatio(options, win);

  const root = doc.createElement('div');
  root.dataset.kujamViewport = '';
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.overflow = 'hidden';

  // TODO(BOARD-806): pointer, wheel, and keyboard input are attached to the main canvas.
  const canvas = createLayer(doc, 'canvas', 'canvas', true);
  // TODO(BOARD-804): one wrapper inside this layer follows the camera with a single `transform`.
  const html = createLayer(doc, 'div', 'html', false);
  const overlay = createLayer(doc, 'canvas', 'overlay', false);
  root.append(canvas, html, overlay);
  container.appendChild(root);

  const layers: RendererLayers = Object.freeze({ root, canvas, html, overlay });
  let size: Readonly<ViewportSize> = Object.freeze({ width: 0, height: 0 });
  let mounted = true;
  let frame: number | null = null;

  function draw(): void {
    // Without a 2D context (unsupported environment, or a lost context) there is nothing to draw.
    const main = canvas.getContext('2d');
    if (main) {
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.clearRect(0, 0, canvas.width, canvas.height);
      // TODO(BOARD-802): draw visible elements with dirty rects and viewport culling.
    }
    const top = overlay.getContext('2d');
    if (top) {
      top.setTransform(1, 0, 0, 1, 0, 0);
      top.clearRect(0, 0, overlay.width, overlay.height);
      // TODO(BOARD-805): draw the selection, handles, selection box, and snap guides.
    }
  }

  function onFrame(): void {
    frame = null;
    if (mounted) draw();
  }

  function requestRender(): void {
    if (!mounted || frame !== null) return;
    frame = win?.requestAnimationFrame
      ? win.requestAnimationFrame(onFrame)
      : (setTimeout(onFrame, 16) as unknown as number);
  }

  function cancelFrame(): void {
    if (frame === null) return;
    if (win?.cancelAnimationFrame) win.cancelAnimationFrame(frame);
    else clearTimeout(frame);
    frame = null;
  }

  function setBackingSize(target: HTMLCanvasElement, width: number, height: number): void {
    const w = Math.round(width * pixelRatio);
    const h = Math.round(height * pixelRatio);
    // Assigning `width`/`height` clears the canvas, so only do it on an actual change.
    if (target.width !== w) target.width = w;
    if (target.height !== h) target.height = h;
  }

  function resize(width: number, height: number): void {
    if (!mounted) return;
    const next = { width: cssLength(width), height: cssLength(height) };
    if (next.width === size.width && next.height === size.height) return;
    size = Object.freeze(next);
    setBackingSize(canvas, size.width, size.height);
    setBackingSize(overlay, size.width, size.height);
    board.camera.setViewport(size);
    requestRender();
  }

  // The root fills the container's content box and has no padding or border, so its client size
  // is the view size.
  resize(root.clientWidth, root.clientHeight);

  const Observer = win?.ResizeObserver;
  const observer = Observer
    ? new Observer((entries) => {
        const rect = entries[entries.length - 1]?.contentRect;
        if (rect) resize(rect.width, rect.height);
      })
    : null;
  observer?.observe(root);

  const unsubscribers = RENDER_EVENTS.map((type) => board.on(type, requestRender));
  unsubscribers.push(board.on('dispose', unmount));

  function unmount(): void {
    if (!mounted) return;
    mounted = false;
    cancelFrame();
    observer?.disconnect();
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
    root.remove();
  }

  requestRender();

  return {
    board,
    container,
    layers,
    get size() {
      return size;
    },
    pixelRatio,
    get mounted() {
      return mounted;
    },
    requestRender,
    unmount,
  };
}
