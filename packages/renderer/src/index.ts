/**
 * `@kujam/renderer` — Renderer tiga lapisan (Canvas 2D utama, lapisan HTML, dan overlay) untuk `@kujam/core`.
 *
 * @packageDocumentation
 */

import type { Board } from '@kujam/core';

/**
 * Pegangan (handle) untuk instance tampilan papan yang terpasang di DOM.
 *
 * @public
 */
export interface BoardView {
  readonly container: HTMLElement;
  requestRender(): void;
  unmount(): void;
}

/**
 * Memasang renderer papan tiga lapisan ke dalam elemen kontainer DOM.
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
      // Penjadwalan dirty-rect frame render
    },
    unmount(): void {
      root.remove();
    },
  };
}

