import { defineBrush, type BrushDefinition } from '@kujam/core';

/**
 * Default pen (BOARD-603): pressure-sensitive and lightly smoothed. Its ID is core's
 * `DEFAULT_BRUSH_ID`, so strokes with an unknown brush are drawn with it.
 *
 * @beta
 */
export const penBrush = defineBrush({
  id: 'pen',
  label: 'brush.pen',
  strokeOptions: {
    size: 4,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    taper: 0,
    simulatePressure: true,
  },
  blend: 'source-over',
});

/**
 * Highlighter (BOARD-603): wide, constant width, and blended with `multiply` so text under it
 * stays readable.
 *
 * @beta
 */
export const highlighterBrush = defineBrush({
  id: 'highlighter',
  label: 'brush.highlighter',
  strokeOptions: {
    size: 16,
    thinning: 0,
    smoothing: 0.5,
    streamline: 0.5,
    taper: 0,
    simulatePressure: false,
  },
  blend: 'multiply',
});

/**
 * Built-in brushes, registered by the `defaultElements` plugin.
 *
 * @beta
 */
export const DEFAULT_BRUSHES = Object.freeze([penBrush, highlighterBrush] as const);

/**
 * Brush for a stroke when no board context is available (thumbnails, tests): a built-in brush, or
 * the pen for any other ID.
 *
 * @internal
 */
export function builtInBrush(id: string): BrushDefinition {
  return DEFAULT_BRUSHES.find((brush) => brush.id === id) ?? penBrush;
}
