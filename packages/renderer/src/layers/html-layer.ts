/**
 * HTML layer management, single camera transform, and viewport virtualization (BOARD-804).
 */

import type {
  Board,
  BoxBounds,
  ChangeEvent,
  ElementDataState,
  ElementHtmlView,
  ElementRecord,
} from '@kujam/core';
import { comparePaintOrder } from './render-canvas.js';

declare module '@kujam/core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ElementHtmlHost extends HTMLElement {}
}

/** Margin in board units around the viewport to prevent pop-in during panning. */
export const HTML_VIEWPORT_MARGIN = 150;

/** Active entry for a mounted HTML element view. */
interface ActiveHtmlEntry {
  host: HTMLElement;
  /** The element's view, or `null` while a placeholder is shown. */
  view: ElementHtmlView<unknown, unknown> | null;
  /** Record and data the view last rendered, to call `update` only when they change. */
  element: ElementRecord;
  data: unknown;
  /** Data status of the placeholder on screen, or `null`. */
  shown: string | null;
  errored?: boolean;
}

const PLACEHOLDER_STYLE: Partial<CSSStyleDeclaration> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  boxSizing: 'border-box',
  padding: '8px',
  borderRadius: '8px',
  fontSize: '12px',
  textAlign: 'center',
  overflow: 'hidden',
};

function resetPlaceholderStyle(host: HTMLElement): void {
  host.className = '';
  for (const key of [...Object.keys(PLACEHOLDER_STYLE), 'fontFamily', 'color', 'backgroundColor']) {
    (host.style as unknown as Record<string, string>)[key] = '';
  }
  cancelAnimations(host);
}

/** Stops the loading pulse; a cancelled animation rejects `finished`, which is expected. */
function cancelAnimations(host: HTMLElement): void {
  for (const animation of host.getAnimations?.() ?? []) {
    animation.finished?.catch(() => {});
    animation.cancel();
  }
}

/** Lets nodes marked `data-board-interactive` take pointer events inside a pass-through host. */
function enableInteractive(host: HTMLElement): void {
  for (const node of host.querySelectorAll<HTMLElement>('[data-board-interactive]')) {
    if (node.style.pointerEvents !== 'auto') node.style.pointerEvents = 'auto';
  }
}

const DEFAULT_LABELS: Readonly<Record<string, { id: string; en: string }>> = {
  loading: { id: '', en: '' },
  forbidden: { id: 'Tidak punya akses', en: 'No access' },
  'not-found': { id: 'Tidak ditemukan', en: 'Not found' },
  error: { id: 'Gagal memuat', en: 'Could not load' },
};

/** The element's own placeholder label, or the built-in one. */
function placeholderLabel(
  def: { placeholder?(reason: never): { label: string } } | undefined,
  status: string,
  locale: string,
): string {
  try {
    const own = def?.placeholder?.(status as never)?.label;
    // An empty label falls back to the built-in one.
    if (typeof own === 'string' && own !== '') return own;
  } catch {
    // Fall back to the built-in label.
  }
  const labels = DEFAULT_LABELS[status];
  return labels ? (locale === 'en' ? labels.en : labels.id) : '';
}

/**
 * Bounds for positioning an active editor in board coordinates.
 *
 * @public
 */
export interface EditorBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rotation?: number;
}

/**
 * Controller for the DOM HTML layer (BOARD-804).
 *
 * Synchronizes a single wrapper with the camera (`translate() scale()`), virtualizes HTML
 * elements by attaching/detaching them when entering/leaving the viewport margin, ensures stacking
 * order matches the fractional index hierarchy, and hosts active text editors.
 *
 * @internal
 */
export class HtmlLayer {
  readonly cameraHost: HTMLDivElement;
  readonly elementsHost: HTMLDivElement;
  readonly editorHost: HTMLDivElement;
  private readonly mountedViews = new Map<string, ActiveHtmlEntry>();
  private readonly erroredElements = new Set<string>();

  constructor(
    private readonly board: Board,
    private readonly htmlLayer: HTMLDivElement,
  ) {
    const doc = htmlLayer.ownerDocument;

    // Single camera transform wrapper (BOARD-804)
    this.cameraHost = doc.createElement('div');
    this.cameraHost.dataset.kujamHtmlCamera = '';
    this.cameraHost.style.position = 'absolute';
    this.cameraHost.style.left = '0';
    this.cameraHost.style.top = '0';
    this.cameraHost.style.transformOrigin = '0 0';
    this.cameraHost.style.willChange = 'transform';
    this.cameraHost.style.pointerEvents = 'none';

    // Sub-container for virtualized custom elements
    this.elementsHost = doc.createElement('div');
    this.elementsHost.dataset.kujamHtmlElements = '';
    this.elementsHost.style.position = 'absolute';
    this.elementsHost.style.inset = '0';
    this.elementsHost.style.pointerEvents = 'none';

    // Sub-container for active text editors
    this.editorHost = doc.createElement('div');
    this.editorHost.dataset.kujamHtmlEditor = '';
    this.editorHost.style.position = 'absolute';
    this.editorHost.style.inset = '0';
    this.editorHost.style.pointerEvents = 'none';

    this.cameraHost.append(this.elementsHost, this.editorHost);
    this.htmlLayer.appendChild(this.cameraHost);

    this.syncCamera();
  }

  /**
   * Updates the camera wrapper's CSS transform to match the current camera state.
   */
  syncCamera(): void {
    const { x, y, zoom } = this.board.camera.get();
    this.cameraHost.style.transform = `translate(${-x * zoom}px, ${-y * zoom}px) scale(${zoom})`;
  }

  /**
   * Mounts an active DOM editor in the HTML camera layer.
   */
  mountEditor(editor: HTMLElement, bounds: EditorBounds): () => void {
    editor.style.position = 'absolute';
    editor.style.left = `${bounds.x}px`;
    editor.style.top = `${bounds.y}px`;
    editor.style.width = `${bounds.w}px`;
    editor.style.height = `${bounds.h}px`;
    editor.style.transformOrigin = '0 0';
    if (bounds.rotation) {
      editor.style.transform = `rotate(${bounds.rotation}deg)`;
    }
    editor.style.pointerEvents = 'auto';

    this.editorHost.appendChild(editor);

    return () => {
      editor.remove();
    };
  }

  /**
   * Synchronizes virtualized HTML elements with the current viewport and document.
   *
   * Views are created when an element enters the viewport (plus margin) and destroyed when it
   * leaves, is deleted, or the renderer unmounts. `update` runs only when the record or its
   * resolved data changed, never for camera moves (BOARD-1201). While data loads, failed, or is
   * not allowed, the host shows a placeholder of the same size instead (BOARD-1202).
   */
  updateElements(): void {
    this.syncCamera();

    const viewport = this.board.camera.viewport;
    if (viewport.width <= 0 || viewport.height <= 0) {
      this.clearAll();
      return;
    }

    const viewportBounds = this.board.camera.getViewportBounds();
    const queryBounds: BoxBounds = {
      minX: viewportBounds.minX - HTML_VIEWPORT_MARGIN,
      minY: viewportBounds.minY - HTML_VIEWPORT_MARGIN,
      maxX: viewportBounds.maxX + HTML_VIEWPORT_MARGIN,
      maxY: viewportBounds.maxY + HTML_VIEWPORT_MARGIN,
    };

    // Find elements intersecting expanded viewport that define render.html
    const candidates = this.board
      .query({ inBounds: queryBounds })
      .filter((el) => Boolean(this.board.elements.get(el.type)?.render?.html));

    const visibleIds = new Set<string>();
    const doc = this.board.getDocument();

    // Sort visible elements by layer paint order (hierarchical frame index)
    const sorted = [...candidates].sort((a, b) => comparePaintOrder(doc, a, b));

    for (const el of sorted) {
      visibleIds.add(el.id);
      const def = this.board.elements.get(el.type);
      if (!def?.render?.html) continue;

      let entry = this.mountedViews.get(el.id);
      if (entry?.errored && !this.erroredElements.has(el.id)) {
        // The error was cleared by an element change: start over.
        entry.host.remove();
        this.mountedViews.delete(el.id);
        entry = undefined;
      }
      if (!entry) {
        const host = this.elementsHost.ownerDocument.createElement('div');
        host.dataset.kujamElementId = el.id;
        host.dataset.kujamElementType = el.type;
        host.style.position = 'absolute';
        // Pointer events reach the board's tools through the host; only nodes marked
        // `data-board-interactive` take them (BOARD-1201).
        host.style.pointerEvents = 'none';
        this.elementsHost.appendChild(host);
        entry = { host, view: null, element: el, data: undefined, shown: null };
        this.mountedViews.set(el.id, entry);
      }
      this.updateHostStyle(entry.host, el);

      if (this.erroredElements.has(el.id)) {
        if (!entry.errored) {
          this.destroyView(entry);
          entry.errored = true;
          this.renderErrorPlaceholder(entry.host, el);
        }
        continue;
      }

      const state: ElementDataState = def.resolve
        ? this.board.getElementData(el.id)
        : { status: 'ready', data: undefined };

      if (state.status === 'ready') {
        if (!entry.view) this.mountView(entry, el, state.data);
        else if (entry.element !== el || entry.data !== state.data) this.updateView(entry, el, state.data);
      } else if (state.status === 'loading' && entry.view) {
        // Reloading after an invalidate: keep the last data on screen until the new data arrives.
        if (entry.element !== el) this.updateView(entry, el, entry.data);
      } else {
        this.destroyView(entry);
        this.renderDataPlaceholder(entry, el, state);
      }
      entry.element = el;
    }

    // Reorder DOM children to strictly preserve layer paint order
    for (const el of sorted) {
      const entry = this.mountedViews.get(el.id);
      if (entry && entry.host.parentElement === this.elementsHost) {
        this.elementsHost.appendChild(entry.host);
      }
    }

    // Unmount and destroy elements that left the viewport or were deleted
    for (const [id, entry] of this.mountedViews.entries()) {
      if (!visibleIds.has(id)) {
        this.destroyView(entry);
        entry.host.remove();
        this.mountedViews.delete(id);
      }
    }
  }

  /** Calls `render.html` for an element whose data is ready. */
  private mountView(entry: ActiveHtmlEntry, el: ElementRecord, data: unknown): void {
    const def = this.board.elements.get(el.type);
    if (!def?.render?.html) return;
    entry.host.replaceChildren();
    resetPlaceholderStyle(entry.host);
    entry.shown = null;
    try {
      entry.view = def.render.html(
        entry.host,
        el as never,
        data as never,
        this.board.elementContext,
      ) as ElementHtmlView<unknown, unknown>;
      entry.element = el;
      entry.data = data;
      enableInteractive(entry.host);
    } catch (error) {
      this.fail(entry, el, 'memasang', error);
    }
  }

  private updateView(entry: ActiveHtmlEntry, el: ElementRecord, data: unknown): void {
    try {
      entry.view?.update(el, data);
      entry.element = el;
      entry.data = data;
      enableInteractive(entry.host);
    } catch (error) {
      this.fail(entry, el, 'memperbarui', error);
    }
  }

  /** Isolates a throwing view (BOARD-810, BOARD-1206): only this element shows an error. */
  private fail(entry: ActiveHtmlEntry, el: ElementRecord, verb: string, error: unknown): void {
    this.destroyView(entry);
    this.erroredElements.add(el.id);
    entry.errored = true;
    const message = `Kesalahan saat ${verb} elemen HTML "${el.id}" (${el.type}): ${error instanceof Error ? error.message : String(error)}`;
    this.board.reportError('render-error', message, { elementId: el.id, type: el.type, error });
    this.renderErrorPlaceholder(entry.host, el);
  }

  private destroyView(entry: ActiveHtmlEntry): void {
    const view = entry.view;
    entry.view = null;
    entry.data = undefined;
    if (!view) return;
    try {
      view.destroy();
    } catch {
      // A throwing destroy must not stop other elements from cleaning up.
    }
  }

  /** Same-size placeholder for loading, missing, forbidden, or failed data (BOARD-1202). */
  private renderDataPlaceholder(
    entry: ActiveHtmlEntry,
    el: ElementRecord,
    state: Exclude<ElementDataState, { status: 'ready' }>,
  ): void {
    if (entry.shown === state.status) return;
    entry.shown = state.status;
    const host = entry.host;
    const doc = host.ownerDocument;
    const def = this.board.elements.get(el.type);
    cancelAnimations(host);
    host.replaceChildren();
    host.className = `kujam-data-placeholder kujam-data-${state.status}`;
    Object.assign(host.style, PLACEHOLDER_STYLE, {
      fontFamily: this.board.theme.typography.fontFamily,
      color: this.board.theme.mode === 'dark' ? '#B4B8C0' : '#4A4F59',
      backgroundColor: this.board.theme.mode === 'dark' ? '#2A2D34' : '#ECEAE3',
    });
    const label = placeholderLabel(def, state.status, this.board.locale);
    if (label) {
      const text = doc.createElement('span');
      text.textContent = label;
      host.append(text);
    }
    if (state.status === 'loading') {
      // Subtle pulse; the Web Animations API needs no stylesheet (CSP, BOARD-2006).
      if (typeof host.animate === 'function' && !this.board.camera.reducedMotion) {
        host.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], {
          duration: 1400,
          iterations: Infinity,
        });
      }
    } else if (state.status === 'error') {
      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.textContent = this.board.locale === 'en' ? 'Try again' : 'Coba lagi';
      retry.dataset.boardInteractive = '';
      retry.style.pointerEvents = 'auto';
      retry.style.font = 'inherit';
      retry.style.cursor = 'pointer';
      retry.addEventListener('click', (e) => {
        e.stopPropagation();
        this.board.reloadElementData(el.id);
      });
      host.append(retry);
    }
  }

  /**
   * Cleans up error state when elements are changed or removed.
   */
  onChange(event: ChangeEvent): void {
    for (const update of Object.values(event.updated)) {
      this.erroredElements.delete(update.after.id);
    }
    for (const rec of Object.values(event.removed)) {
      this.erroredElements.delete(rec.id);
    }
  }

  private renderErrorPlaceholder(host: HTMLElement, el: ElementRecord): void {
    cancelAnimations(host);
    host.replaceChildren();
    host.className = 'kujam-render-error';
    host.style.border = '1px dashed #ef4444';
    host.style.backgroundColor = 'rgba(239, 68, 68, 0.12)';
    host.style.color = '#ef4444';
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.justifyContent = 'center';
    host.style.fontFamily = this.board.theme.typography.fontFamily;
    host.style.fontSize = '12px';
    host.style.boxSizing = 'border-box';
    host.style.padding = '4px';
    host.textContent = `⚠️ ${el.type}`;
  }

  private updateHostStyle(host: HTMLElement, el: ElementRecord): void {
    host.style.left = `${el.x}px`;
    host.style.top = `${el.y}px`;
    host.style.width = `${el.w}px`;
    host.style.height = `${el.h}px`;
    host.style.transformOrigin = '0 0';
    host.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
    host.style.opacity = el.opacity !== undefined && el.opacity < 1 ? `${el.opacity}` : '';
  }

  /** Clears and destroys all active views (e.g. page change or unmount). */
  clearAll(): void {
    for (const entry of this.mountedViews.values()) {
      this.destroyView(entry);
      entry.host.remove();
    }
    this.mountedViews.clear();
  }

  /** Disposes the HTML layer on view unmount. */
  dispose(): void {
    this.clearAll();
    this.cameraHost.remove();
  }
}
