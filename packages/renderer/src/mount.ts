/**
 * `mountRenderer` and the three-layer skeleton (BOARD-801, ADR-003).
 *
 * The view stacks three layers inside one root element: the main Canvas 2D (elements), the HTML
 * layer (custom elements rendered as DOM), and the overlay canvas (selection, handles, snap
 * guides). A visually hidden accessibility tree sits between the HTML layer and the overlay
 * (BOARD-1901). It follows the container size with a `ResizeObserver`, reports that size to
 * `board.camera.setViewport`, and coalesces render requests into one `requestAnimationFrame`.
 *
 * Every browser API is taken from the container's own window, and nothing is shared between
 * views, so several boards (or iframes) on one page never affect each other.
 */

import type { Board, ThemeDefinition, ThemeMode, ViewportSize } from '@kujam/core';
import { HtmlLayer, type EditorBounds } from './layers/html-layer.js';
import { attachInput } from './input/input.js';
import { attachClipboard } from './input/clipboard.js';
import { CanvasRenderer, type RenderStats } from './layers/render-canvas.js';
import { OverlayRenderer, type OverlayRenderStats } from './layers/overlay.js';
import { assertBackground, type BoardBackground } from './layers/background.js';
import { A11yTree } from './a11y/a11y-tree.js';

export type { RenderStats } from './layers/render-canvas.js';
export type { OverlayRenderStats } from './layers/overlay.js';
export type { EditorBounds } from './layers/html-layer.js';
export type { BoardBackground } from './layers/background.js';

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
  /**
   * When `true`, enables visual debug overlays (dirty rectangles and element counts)
   * and tracks render statistics (BOARD-802).
   */
  readonly debug?: boolean;
  /**
   * Initial whiteboard theme mode or custom theme definition (BOARD-1006).
   * When provided, updates `board.setTheme(theme)`.
   */
  readonly theme?: ThemeMode | ThemeDefinition;
  /**
   * Board background pattern: `none`, `dots`, or `grid` (BOARD-1007). Defaults to `dots`, with
   * the theme's `canvas.gridDot` color and `canvas.gridSpacing`.
   */
  readonly background?: BoardBackground;
  /**
   * Called when pasted board content is rejected (BOARD-906): a `ContentError` for a read-only
   * board, the element limit, or a permission hook, or an `InvalidDocumentError` /
   * `MigrationError` for invalid content. The board is unchanged.
   */
  readonly onClipboardError?: (error: unknown) => void;
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
  /**
   * Camera wrapper inside the HTML layer; transforms with the camera in board units (BOARD-804).
   */
  readonly htmlCamera: HTMLDivElement;
  /**
   * Visually hidden accessibility tree between the HTML layer and the overlay (BOARD-1901): a
   * `role="list"` with one item per element near the viewport, in reading order. Receives no
   * pointer events.
   *
   * @beta
   */
  readonly a11y: HTMLDivElement;
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
  /** Enables or disables visual debug overlays and render stats tracking (BOARD-802). */
  debug: boolean;
  /** Render performance and culling statistics from the last rendered frame (BOARD-802). */
  readonly stats: Readonly<RenderStats>;
  /** Statistics from the last rendered overlay frame (BOARD-805). */
  readonly overlayStats: Readonly<OverlayRenderStats>;
  /**
   * Mounts an active DOM editor (e.g. text or rich text editor) inside the HTML camera layer (BOARD-804).
   * The editor is positioned in board coordinates and moves automatically with camera pan and zoom.
   *
   * @returns Unmount callback that removes the editor from the layer. When the editor has focus at
   *   that moment, focus returns to the selected element's accessibility item, or to the view.
   */
  mountEditor(editor: HTMLElement, bounds: EditorBounds): () => void;
  /**
   * Schedules a render on the next animation frame. Several calls before that frame produce one
   * render. No effect after unmount.
   */
  requestRender(): void;
  /** Active whiteboard theme (BOARD-1006). */
  readonly theme: Readonly<ThemeDefinition>;
  /** Changes the active whiteboard theme (BOARD-1006). */
  setTheme(theme: ThemeMode | ThemeDefinition): void;
  /**
   * Board background pattern (BOARD-1007). Assigning a new value repaints the view.
   *
   * @throws `RangeError` when assigned a value other than `none`, `dots`, or `grid`.
   */
  background: BoardBackground;
  /**
   * Removes the DOM layers and releases the `ResizeObserver`, board listeners, and any pending
   * animation frame. Safe to call more than once. Also runs automatically when the board is
   * disposed.
   */
  unmount(): void;
}

/** Window APIs the renderer needs; taken from the container's own window. */
type ViewWindow = Window & typeof globalThis;

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

/** Maximum canvas backing store area in pixels before Safari iOS drops or crashes the canvas (ADR-003, BOARD-803). */
export const SAFARI_MAX_CANVAS_PIXELS = 16_777_216;

/**
 * Clamps the desired pixel ratio so that the resulting backing canvas area
 * does not exceed the Safari iOS 16.7M pixel memory limit (BOARD-803).
 *
 * @public
 */
export function clampPixelRatio(
  width: number,
  height: number,
  desiredRatio: number,
  maxPixels = SAFARI_MAX_CANVAS_PIXELS,
): number {
  if (width <= 0 || height <= 0 || desiredRatio <= 0) return desiredRatio;
  const area = width * desiredRatio * (height * desiredRatio);
  if (area <= maxPixels) {
    return desiredRatio;
  }
  const maxRatio = Math.sqrt(Math.max(0, maxPixels - 2048) / (width * height));
  return Math.max(1, maxRatio);
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

function listenDprChange(win: ViewWindow | null, onChange: (newDpr: number) => void): () => void {
  if (!win || typeof win.matchMedia !== 'function') return () => {};

  let currentDpr = win.devicePixelRatio || 1;
  let mediaQuery: MediaQueryList | null = null;

  const handleChange = () => {
    update();
    onChange(win.devicePixelRatio || 1);
  };

  const update = () => {
    mediaQuery?.removeEventListener?.('change', handleChange);
    currentDpr = win.devicePixelRatio || 1;
    mediaQuery = win.matchMedia(`(resolution: ${currentDpr}dppx)`);
    mediaQuery?.addEventListener?.('change', handleChange);
  };

  update();
  return () => {
    mediaQuery?.removeEventListener?.('change', handleChange);
  };
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
  let targetPixelRatio = resolvePixelRatio(options, win);
  let effectivePixelRatio = targetPixelRatio;

  const initialBackground =
    options.background === undefined ? 'dots' : assertBackground(options.background);

  if (options.theme !== undefined) {
    board.setTheme(options.theme);
  }

  const root = doc.createElement('div');
  root.dataset.kujamViewport = '';
  root.className = 'kujam-board-root';
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.overflow = 'hidden';
  root.style.backgroundColor = board.theme.canvas.background;

  const canvas = createLayer(doc, 'canvas', 'canvas', true);
  const html = createLayer(doc, 'div', 'html', false);
  html.className = 'kujam-html-layer';
  const a11y = createLayer(doc, 'div', 'a11y', false);
  const overlay = createLayer(doc, 'canvas', 'overlay', false);
  // The canvases carry no semantics; the a11y layer describes their content (BOARD-1901).
  canvas.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('aria-hidden', 'true');
  root.append(canvas, html, a11y, overlay);
  container.appendChild(root);

  const htmlLayer = new HtmlLayer(board, html);
  const layers: RendererLayers = Object.freeze({
    root,
    canvas,
    html,
    htmlCamera: htmlLayer.cameraHost,
    a11y,
    overlay,
  });
  const a11yTree = new A11yTree(board, root, a11y, { interactive: htmlLayer.elementsHost });
  const overlayRenderer = new OverlayRenderer(board);
  let overlayStats: Readonly<OverlayRenderStats> = Object.freeze({
    rendered: false,
    selectedCount: 0,
    hasBrush: false,
    hasActiveStroke: false,
    guidesCount: 0,
    hoveredId: null,
  });

  const detachInput = attachInput(board, layers, {
    onHover(id) {
      if (overlayRenderer.setHovered(id)) {
        scheduleRender();
      }
    },
    onEvent() {
      if (board.toolState !== 'idle') {
        scheduleRender();
      }
    },
    filterKey: (e) => a11yTree.filterKey(e),
    afterKey: (e) => a11yTree.afterKey(e),
  });
  const detachClipboard = attachClipboard(board, root, { onError: options.onClipboardError });
  let size: Readonly<ViewportSize> = Object.freeze({ width: 0, height: 0 });
  let mounted = true;
  let frame: number | null = null;

  let debug = Boolean(options.debug);
  const canvasRenderer = new CanvasRenderer(board);
  canvasRenderer.background = initialBackground;

  function updateEffectivePixelRatio(): void {
    effectivePixelRatio = clampPixelRatio(size.width, size.height, targetPixelRatio);
  }

  function draw(): void {
    // Without a 2D context (unsupported environment, or a lost context) there is nothing to draw.
    const main = canvas.getContext('2d');
    if (main) {
      canvasRenderer.render(canvas, main, effectivePixelRatio, debug);
    }
    htmlLayer.updateElements();
    a11yTree.frame();
    const top = overlay.getContext('2d');
    if (top) {
      overlayStats = overlayRenderer.render(overlay, top, effectivePixelRatio);
    }
  }

  function onFrame(): void {
    frame = null;
    if (mounted) draw();
  }

  function scheduleRender(): void {
    if (!mounted || frame !== null) return;
    frame = win?.requestAnimationFrame
      ? win.requestAnimationFrame(onFrame)
      : (setTimeout(onFrame, 16) as unknown as number);
  }

  function requestRender(): void {
    canvasRenderer.markAllDirty();
    scheduleRender();
  }

  function cancelFrame(): void {
    if (frame === null) return;
    if (win?.cancelAnimationFrame) win.cancelAnimationFrame(frame);
    else clearTimeout(frame);
    frame = null;
  }

  function setBackingSize(target: HTMLCanvasElement, width: number, height: number): void {
    const w = Math.round(width * effectivePixelRatio);
    const h = Math.round(height * effectivePixelRatio);
    // Assigning `width`/`height` clears the canvas, so only do it on an actual change.
    if (target.width !== w) target.width = w;
    if (target.height !== h) target.height = h;
  }

  function resize(width: number, height: number): void {
    if (!mounted) return;
    const next = { width: cssLength(width), height: cssLength(height) };
    if (next.width === size.width && next.height === size.height) return;
    size = Object.freeze(next);
    updateEffectivePixelRatio();
    setBackingSize(canvas, size.width, size.height);
    setBackingSize(overlay, size.width, size.height);
    board.camera.setViewport(size);
    canvasRenderer.markAllDirty();
    scheduleRender();
  }

  // The root fills the container's content box and has no padding or border, so its client size
  // is the view size.
  resize(root.clientWidth, root.clientHeight);
  a11yTree.syncNow();

  const Observer = win?.ResizeObserver;
  const observer = Observer
    ? new Observer((entries) => {
        const rect = entries[entries.length - 1]?.contentRect;
        if (rect) resize(rect.width, rect.height);
      })
    : null;
  observer?.observe(root);

  const unsubscribers = [
    board.on('camera', () => {
      canvasRenderer.markAllDirty();
      a11yTree.onCamera();
      scheduleRender();
    }),
    board.on('page', () => {
      canvasRenderer.markAllDirty();
      htmlLayer.clearAll();
      a11yTree.onPage();
      scheduleRender();
    }),
    board.on('change', (event) => {
      canvasRenderer.markChange(event);
      htmlLayer.onChange(event);
      a11yTree.onChange(event);
      scheduleRender();
    }),
    board.on('selection', (event) => {
      a11yTree.onSelection(event.ids);
      scheduleRender();
    }),
    board.on('tool', scheduleRender),
    board.on('theme', (theme) => {
      root.style.backgroundColor = theme.canvas.background;
      canvasRenderer.markAllDirty();
      a11yTree.onTheme();
      scheduleRender();
    }),
    board.on('dispose', unmount),
  ];

  if (options.pixelRatio === undefined && win) {
    const detachDpr = listenDprChange(win, (newDpr) => {
      if (!mounted) return;
      targetPixelRatio = newDpr;
      updateEffectivePixelRatio();
      setBackingSize(canvas, size.width, size.height);
      setBackingSize(overlay, size.width, size.height);
      canvasRenderer.markAllDirty();
      scheduleRender();
    });
    unsubscribers.push(detachDpr);
  }

  function unmount(): void {
    if (!mounted) return;
    mounted = false;
    cancelFrame();
    observer?.disconnect();
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
    detachInput();
    detachClipboard();
    a11yTree.dispose();
    htmlLayer.dispose();
    root.remove();
    if ((container as { __kujamView?: unknown }).__kujamView === view) {
      delete (container as { __kujamView?: unknown }).__kujamView;
    }
    if ((root as { __kujamView?: unknown }).__kujamView === view) {
      delete (root as { __kujamView?: unknown }).__kujamView;
    }
  }

  scheduleRender();

  const view: BoardView = {
    board,
    container,
    layers,
    get size() {
      return size;
    },
    get pixelRatio() {
      return effectivePixelRatio;
    },
    get mounted() {
      return mounted;
    },
    get debug() {
      return debug;
    },
    set debug(value: boolean) {
      debug = Boolean(value);
      canvasRenderer.markAllDirty();
      scheduleRender();
    },
    get stats() {
      return canvasRenderer.stats;
    },
    get overlayStats() {
      return overlayStats;
    },
    get theme() {
      return board.theme;
    },
    setTheme(theme: ThemeMode | ThemeDefinition): void {
      board.setTheme(theme);
    },
    get background() {
      return canvasRenderer.background;
    },
    set background(value: BoardBackground) {
      const next = assertBackground(value);
      if (next === canvasRenderer.background) return;
      canvasRenderer.background = next;
      canvasRenderer.markAllDirty();
      scheduleRender();
    },
    mountEditor(editor, bounds) {
      const remove = htmlLayer.mountEditor(editor, bounds);
      return () => {
        // Closing a focused editor (Esc) would drop focus to the page body: keep it on the
        // edited element instead (BOARD-1902).
        const hadFocus = editor.contains(doc.activeElement);
        remove();
        if (hadFocus && mounted) a11yTree.restoreFocus();
      };
    },
    requestRender,
    unmount,
  };

  (container as { __kujamView?: BoardView }).__kujamView = view;
  (root as { __kujamView?: BoardView }).__kujamView = view;

  return view;
}
