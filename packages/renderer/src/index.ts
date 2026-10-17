/**
 * `@kujam/renderer` — Three-layer renderer (main Canvas 2D, HTML layer, and overlay) for `@kujam/core`.
 *
 * @packageDocumentation
 */

import type { Board } from '@kujam/core';

/**
 * Handle for a board view instance mounted in the DOM.
 *
 * @public
 */
export interface BoardView {
  readonly container: HTMLElement;
  requestRender(): void;
  unmount(): void;
}

/**
 * Mounts the three-layer board renderer into a DOM container element.
 *
 * @public
 */
export function mountRenderer(board: Board, container: HTMLElement): BoardView {
  const root = document.createElement('div');
  root.dataset.kujamViewport = 'true';
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.overflow = 'hidden';

  const mainCanvas = document.createElement('canvas');
  mainCanvas.dataset.kujamLayer = 'canvas-main';
  mainCanvas.style.position = 'absolute';
  mainCanvas.style.inset = '0';
  mainCanvas.style.width = '100%';
  mainCanvas.style.height = '100%';

  const htmlLayer = document.createElement('div');
  htmlLayer.dataset.kujamLayer = 'html-elements';
  htmlLayer.style.position = 'absolute';
  htmlLayer.style.inset = '0';
  htmlLayer.style.pointerEvents = 'none';

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.dataset.kujamLayer = 'canvas-overlay';
  overlayCanvas.style.position = 'absolute';
  overlayCanvas.style.inset = '0';
  overlayCanvas.style.width = '100%';
  overlayCanvas.style.height = '100%';
  overlayCanvas.style.pointerEvents = 'none';

  root.append(mainCanvas, htmlLayer, overlayCanvas);
  container.appendChild(root);

  void board;

  return {
    container,
    requestRender(): void {
      // Dirty-rect render frame scheduling
    },
    unmount(): void {
      root.remove();
    },
  };
}
