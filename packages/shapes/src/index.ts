/**
 * `@kujam/shapes` — Built-in elements and tools for `@kujam/core` boards.
 *
 * All built-in elements and tools are defined with `defineElement`, `defineTool`, and
 * `definePlugin` from `@kujam/core` — the same public API as custom plugins, with no internal
 * shortcuts (BOARD-601, BOARD-602).
 *
 * @packageDocumentation
 */

import { definePlugin } from '@kujam/core';
import { DEFAULT_BRUSHES } from './brushes.js';
import { drawElement } from './elements/draw.js';
import { geoElement } from './elements/geo.js';
import { stickyElement } from './elements/sticky.js';
import { textElement } from './elements/text.js';
import { drawTool } from './tools/draw.js';
import { eraserTool } from './tools/eraser.js';
import { ellipseTool, geoTool, rectangleTool } from './tools/geo.js';
import { handTool } from './tools/hand.js';
import { selectTool } from './tools/select.js';
import { stickyTool } from './tools/sticky.js';
import { textTool } from './tools/text.js';

export { DEFAULT_BRUSHES, highlighterBrush, penBrush } from './brushes.js';
export { stickyElement } from './elements/sticky.js';
export { drawElement, MAX_DRAW_POINTS } from './elements/draw.js';
export { chunkPoints, simplifyPoints } from './elements/stroke-utils.js';
export { textElement } from './elements/text.js';
export { geoElement, geoGeometry, GEO_KINDS, type GeoKind } from './elements/geo.js';
export {
  DRAG_THRESHOLD_PX,
  HANDLE_TOLERANCE_PX,
  HIT_TOLERANCE_PX,
  ROTATE_HANDLE_OFFSET_PX,
  selectTool,
  type SelectToolData,
} from './tools/select.js';
export { handTool, type HandToolData } from './tools/hand.js';
export { createBoxTool, type BoxToolOptions } from './tools/box-tool.js';
export { stickyTool } from './tools/sticky.js';
export { textTool } from './tools/text.js';
export { createGeoTool, geoTool, rectangleTool, ellipseTool } from './tools/geo.js';
export {
  createDrawTool,
  drawTool,
  type ActiveStroke,
  type DrawToolData,
  type DrawToolOptions,
} from './tools/draw.js';
export {
  createEraserTool,
  eraserTool,
  type EraserToolData,
  type EraserToolOptions,
} from './tools/eraser.js';
export { COLOR_KEYS, STICKY_COLORS, type ColorKey, type StickyColor } from './colors.js';
export {
  EMPTY_RICH_TEXT,
  LINK_URL_SCHEMES,
  MAX_LINK_LENGTH,
  MAX_LIST_INDENT,
  MAX_RICH_TEXT_LENGTH,
  richTextSchema,
  richTextToPlainText,
  type RichText,
} from './richtext.js';

/**
 * Built-in elements plugin for release 0.1 (`sticky`, `draw`, `text`, `geo`) with the `pen` and
 * `highlighter` brushes used by `draw` (BOARD-603), ready to install via
 * `createBoard({ plugins: [defaultElements, defaultTools] })` or `createElementRegistry(defaultElements)`.
 * Connectors, frames, images, and groups follow in 0.2 (BOARD-1101, BOARD-1105, BOARD-1103, BOARD-1104).
 *
 * @public
 */
export const defaultElements = definePlugin({
  id: 'default-elements',
  elements: Object.freeze([stickyElement, drawElement, textElement, geoElement] as const),
  brushes: DEFAULT_BRUSHES,
});

/**
 * Built-in tools plugin, ready to install via `createBoard({ plugins: [defaultElements, defaultTools] })`.
 * Contains navigation, selection, and creation tools (BOARD-502, BOARD-913) with standard shortcuts.
 *
 * @public
 */
export const defaultTools = definePlugin({
  id: 'default-tools',
  tools: Object.freeze([
    selectTool,
    handTool,
    stickyTool,
    drawTool,
    textTool,
    geoTool,
    rectangleTool,
    ellipseTool,
    eraserTool,
  ] as const),
  keybindings: {
    v: 'tool:select',
    h: 'tool:hand',
    s: 'tool:sticky',
    p: 'tool:draw',
    t: 'tool:text',
    r: 'tool:rectangle',
    o: 'tool:ellipse',
    e: 'tool:eraser',
  },
});

/**
 * Built-in element types provided by `@kujam/shapes`, in the same order as
 * `defaultElements.elements`.
 *
 * @public
 */
export const DEFAULT_ELEMENT_TYPES = ['sticky', 'draw', 'text', 'geo'] as const;

/**
 * String type for built-in elements.
 *
 * @public
 */
export type DefaultElementType = (typeof DEFAULT_ELEMENT_TYPES)[number];

/**
 * Built-in tool IDs.
 *
 * @public
 */
export const DEFAULT_TOOL_IDS = [
  'select',
  'hand',
  'sticky',
  'draw',
  'geo',
  'rectangle',
  'ellipse',
  'connector',
  'text',
  'frame',
  'eraser',
] as const;

/**
 * String type for built-in tool IDs.
 *
 * @public
 */
export type DefaultToolId = (typeof DEFAULT_TOOL_IDS)[number];
