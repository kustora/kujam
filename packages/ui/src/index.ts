/**
 * `@kujam/ui` — Framework-free Web Components UI (toolbar, minimap, command palette).
 *
 * @packageDocumentation
 */

import type { Board } from '@kujam/core';

/**
 * Options for mounting the built-in UI shell.
 *
 * @public
 */
export interface MountUiOptions {
  board: Board;
  container: HTMLElement;
}

/**
 * Mounts the Web Components UI on the board container.
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
