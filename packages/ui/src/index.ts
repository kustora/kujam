/**
 * `@kujam/ui` — Komponen UI Web Components tanpa framework (toolbar, minimap, command palette).
 *
 * @packageDocumentation
 */

import type { Board } from '@kujam/core';

/**
 * Opsi pemasangan shell UI bawaan.
 *
 * @public
 */
export interface MountUiOptions {
  board: Board;
  container: HTMLElement;
}

/**
 * Memasang komponen UI Web Components pada kontainer papan.
 *
 * @public
 */
export function mountDefaultUi(options: MountUiOptions): { unmount(): void } {
  const bar = document.createElement('div');
  bar.dataset.kujamUi = 'toolbar';
  options.container.appendChild(bar);

  return {
    unmount(): void {
      bar.remove();
    },
  };
}

