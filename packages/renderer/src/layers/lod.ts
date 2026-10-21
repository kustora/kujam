/**
 * Level-of-detail (LOD) threshold controller with hysteresis (BOARD-809, BOARD-1204).
 */

import type { ElementDefinition, ElementRecord } from '@kujam/core';

/**
 * Buffer factor above `lod.compactBelowZoom` required to switch back from compact to HTML.
 * (e.g. 5% buffer: switch to compact if zoom < threshold; switch back to HTML if zoom > threshold * 1.05).
 *
 * @public
 */
export const LOD_HYSTERESIS_BUFFER = 1.05;

/**
 * Manages element level-of-detail state and hysteresis switching between HTML and Canvas (BOARD-809).
 *
 * @public
 */
export class LodManager {
  private readonly compactIds = new Set<string>();

  constructor(private readonly hysteresisBuffer = LOD_HYSTERESIS_BUFFER) {}

  /**
   * Determines whether an element should be drawn in its compact canvas representation.
   *
   * Hysteresis rules:
   * - Elements that do NOT define `render.canvas` are NEVER compact (BOARD-809: they stay in HTML at all zoom levels).
   * - Elements without `compactBelowZoom` are NEVER compact.
   * - A normal element switches to compact when `zoom < threshold`.
   * - A compact element switches back to normal only when `zoom > threshold * hysteresisBuffer`.
   */
  isCompact(el: ElementRecord, def: ElementDefinition | undefined, zoom: number): boolean {
    if (!def?.render?.canvas) return false;
    const threshold = def.lod?.compactBelowZoom;
    if (threshold === undefined || threshold <= 0) return false;

    const wasCompact = this.compactIds.has(el.id);
    let compact: boolean;
    if (wasCompact) {
      compact = zoom <= threshold * this.hysteresisBuffer;
    } else {
      compact = zoom < threshold;
    }

    if (compact) {
      this.compactIds.add(el.id);
    } else {
      this.compactIds.delete(el.id);
    }
    return compact;
  }

  /**
   * Checks whether the element with `id` is currently registered as compact.
   */
  isCompactId(id: string): boolean {
    return this.compactIds.has(id);
  }

  /**
   * Removes an element ID from the compact tracking set (e.g. on element deletion).
   */
  delete(id: string): boolean {
    return this.compactIds.delete(id);
  }

  /**
   * Clears all compact state tracking (e.g. on page change or unmount).
   */
  clear(): void {
    this.compactIds.clear();
  }
}
