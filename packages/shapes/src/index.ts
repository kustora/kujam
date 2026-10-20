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
import { connectorElement, registerConnectorBoard } from './elements/connector.js';
import { drawElement } from './elements/draw.js';
import { geoElement } from './elements/geo.js';
import { stickyElement } from './elements/sticky.js';
import { textElement } from './elements/text.js';
import { connectorTool } from './tools/connector.js';
import { drawTool } from './tools/draw.js';
import { eraserTool } from './tools/eraser.js';
import { frameTool } from './tools/frame.js';
import { ellipseTool, geoTool, rectangleTool } from './tools/geo.js';
import { groupElement } from './elements/group.js';
import { frameElement } from './elements/frame.js';
import { imageElement } from './elements/image.js';
import { handTool } from './tools/hand.js';
import { selectTool } from './tools/select.js';
import { stickyTool } from './tools/sticky.js';
import { textTool } from './tools/text.js';

export { DEFAULT_BRUSHES, highlighterBrush, penBrush } from './brushes.js';
export { stickyElement } from './elements/sticky.js';
export { drawElement, MAX_DRAW_POINTS } from './elements/draw.js';
export {
  chunkPoints,
  cutStrokePoints,
  distanceToSegment,
  segmentDistance,
  simplifyPoints,
} from './elements/stroke-utils.js';
export { textElement } from './elements/text.js';
export { geoElement, geoGeometry, GEO_KINDS, type GeoKind } from './elements/geo.js';
export {
  connectorElement,
  connectorPropsSchema,
  computeConnectorGeometry,
  computeElementConnectorRoute,
  registerConnectorBoard,
  renderConnectorCanvas,
  resolveConnectorRouteOptions,
  type ConnectorProps,
} from './elements/connector.js';
export {
  ARROWHEAD_STYLES,
  CARDINAL_ANCHORS,
  CARDINAL_SIDES,
  CONNECTOR_STYLES,
  DEFAULT_ELBOW_CLEARANCE,
  SNAP_ANCHOR_TOLERANCE_PX,
  computeConnectorRoute,
  drawArrowhead,
  findSnapAnchor,
  normalizeConnectorBounds,
  resolveAnchorSide,
  resolveAnchorWorldPoint,
  simplifyOrthogonalPoints,
  type AnchorSide,
  type ArrowheadStyle,
  type ConnectorBend,
  type ConnectorDash,
  type ConnectorPreview,
  type ConnectorRouteOptions,
  type ConnectorRouteResult,
  type ConnectorSnapTarget,
  type ConnectorStyle,
} from './elements/connector-routing.js';
export { DRAW_THICKNESSES, GEO_STROKE_WIDTHS } from './styles.js';
export {
  DRAG_THRESHOLD_PX,
  HANDLE_TOLERANCE_PX,
  HIT_TOLERANCE_PX,
  ROTATE_HANDLE_OFFSET_PX,
  selectTool,
  type SelectHandle,
  type SelectToolData,
} from './tools/select.js';
export { handTool, type HandToolData } from './tools/hand.js';
export { createBoxTool, type BoxToolOptions } from './tools/box-tool.js';
export { stickyTool } from './tools/sticky.js';
export { textTool } from './tools/text.js';
export { createGeoTool, geoTool, rectangleTool, ellipseTool } from './tools/geo.js';
export {
  connectorTool,
  DEFAULT_CONNECTOR_LENGTH,
  type ConnectorToolData,
  type ConnectorToolState,
} from './tools/connector.js';
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
  type EraserMode,
  type EraserTargets,
  type EraserToolData,
  type EraserToolOptions,
} from './tools/eraser.js';
export {
  COLOR_KEYS,
  createTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  STICKY_COLORS,
  STICKY_TEXT_COLOR,
  COLOR_VALUES,
  STICKY_COLOR_VALUES,
  type ColorKey,
  type CustomThemeOverrides,
  type StickyColor,
  type ThemeCanvasTokens,
  type ThemeDefinition,
  type ThemeMode,
  type ThemeSelectionTokens,
  type ThemeTypographyTokens,
} from './colors.js';
export {
  EMPTY_RICH_TEXT,
  LINK_URL_SCHEMES,
  MAX_LINK_LENGTH,
  MAX_LIST_INDENT,
  MAX_RICH_TEXT_LENGTH,
  isRichTextEmpty,
  normalizeRichText,
  richTextSchema,
  richTextToPlainText,
  sanitizeLink,
  validateRichText,
  type RichText,
  type RichTextAttributes,
  type RichTextOp,
} from './richtext.js';
export {
  drawRichText,
  formatFont,
  layoutRichText,
  layoutStickyText,
  type DrawRichTextOptions,
  type ListMarker,
  type StickyLayoutOptions,
  type TextLayout,
  type TextLayoutLine,
  type TextLayoutOptions,
  type TextRun,
} from './text/layout.js';
export { groupElement, groupPropsSchema, type GroupProps } from './elements/group.js';
export {
  DEFAULT_FRAME_SIZE,
  FRAME_FILLS,
  frameElement,
  framePropsSchema,
  type FrameFill,
  type FrameProps,
} from './elements/frame.js';
export { frameTool } from './tools/frame.js';
export {
  attachTextEditor,
  domToRichText,
  richTextToDom,
  sanitizePastedHtml,
  STICKY_TAB_GAP,
  type TextEditorAttachment,
  type TextEditorHost,
  type TextEditorOptions,
} from './text/editor.js';

export {
  clearImageCache,
  DEFAULT_IMAGE_SIZE,
  imageCropSchema,
  imageElement,
  imagePropsSchema,
  type ImageCrop,
  type ImageProps,
} from './elements/image.js';

/**
 * Built-in elements plugin (`sticky`, `draw`, `text`, `geo`, `connector`, `group`, `frame`, `image`) with the `pen` and
 * `highlighter` brushes used by `draw` (BOARD-603, BOARD-1101, BOARD-1103, BOARD-1104, BOARD-1105), ready to install via
 * `createBoard({ plugins: [defaultElements, defaultTools] })` or `createElementRegistry(defaultElements)`.
 *
 * @public
 */
export const defaultElements = definePlugin({
  id: 'default-elements',
  elements: Object.freeze([
    stickyElement,
    drawElement,
    textElement,
    geoElement,
    connectorElement,
    groupElement,
    frameElement,
    imageElement,
  ] as const),
  brushes: DEFAULT_BRUSHES,
  setup: (board) => registerConnectorBoard(board),
});

/**
 * Built-in tools plugin, ready to install via `createBoard({ plugins: [defaultElements, defaultTools] })`.
 * Contains navigation, selection, and creation tools (BOARD-502, BOARD-913, BOARD-1101, BOARD-1105) with standard shortcuts.
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
    connectorTool,
    frameTool,
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
    l: 'tool:connector',
    f: 'tool:frame',
    e: 'tool:eraser',
  },
  setup: (board) => registerConnectorBoard(board),
});

/**
 * Built-in element types provided by `@kujam/shapes`, in the same order as
 * `defaultElements.elements`.
 *
 * @public
 */
export const DEFAULT_ELEMENT_TYPES = [
  'sticky',
  'draw',
  'text',
  'geo',
  'connector',
  'group',
  'frame',
  'image',
] as const;

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
