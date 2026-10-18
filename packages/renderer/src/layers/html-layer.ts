/**
 * HTML layer management, single camera transform, and viewport virtualization (BOARD-804).
 */

import type { Board, BoxBounds, ChangeEvent, ElementHtmlView, ElementRecord } from '@kujam/core';
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
  view: ElementHtmlView<unknown, unknown>;
  element: ElementRecord;
  errored?: boolean;
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
      const existing = this.mountedViews.get(el.id);

      if (existing) {
        if (existing.errored) {
          if (!this.erroredElements.has(el.id)) {
            // Error was cleared by an element change: remove placeholder and remount
            existing.host.remove();
            this.mountedViews.delete(el.id);
          } else {
            // Still in error: keep placeholder and update position
            this.updateHostStyle(existing.host, el);
            continue;
          }
        } else {
          // Element already mounted: update host styles if needed and call view.update
          this.updateHostStyle(existing.host, el);
          existing.element = el;
          try {
            existing.view.update(el, undefined);
          } catch (error) {
            this.erroredElements.add(el.id);
            existing.errored = true;
            const message = `Kesalahan saat memperbarui elemen HTML "${el.id}" (${el.type}): ${error instanceof Error ? error.message : String(error)}`;
            this.board.reportError('render-error', message, { elementId: el.id, type: el.type, error });
            this.renderErrorPlaceholder(existing.host, el);
          }
          continue;
        }
      }

      // Element entering viewport or being remounted after an error was resolved
      const def = this.board.elements.get(el.type);
      if (!def?.render?.html) continue;

      const host = this.elementsHost.ownerDocument.createElement('div');
      host.dataset.kujamElementId = el.id;
      host.dataset.kujamElementType = el.type;
      host.style.position = 'absolute';
      this.updateHostStyle(host, el);
      host.style.pointerEvents = 'auto';

      if (this.erroredElements.has(el.id)) {
        this.renderErrorPlaceholder(host, el);
        const view: ElementHtmlView<unknown, unknown> = {
          update: () => {},
          destroy: () => {},
        };
        this.elementsHost.appendChild(host);
        this.mountedViews.set(el.id, { host, view, element: el, errored: true });
        continue;
      }

      try {
        const view = def.render.html(
          host,
          el as never,
          undefined,
          this.board.elementContext,
        ) as ElementHtmlView<unknown, unknown>;

        this.elementsHost.appendChild(host);
        this.mountedViews.set(el.id, { host, view, element: el, errored: false });
      } catch (error) {
        this.erroredElements.add(el.id);
        const message = `Kesalahan saat memasang elemen HTML "${el.id}" (${el.type}): ${error instanceof Error ? error.message : String(error)}`;
        this.board.reportError('render-error', message, { elementId: el.id, type: el.type, error });
        this.renderErrorPlaceholder(host, el);
        const view: ElementHtmlView<unknown, unknown> = {
          update: () => {},
          destroy: () => {},
        };
        this.elementsHost.appendChild(host);
        this.mountedViews.set(el.id, { host, view, element: el, errored: true });
      }
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
        try {
          entry.view.destroy();
        } catch {
          // Ignore destroy errors during unmount cleanup
        }
        entry.host.remove();
        this.mountedViews.delete(id);
      }
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
      entry.view.destroy();
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
