/**
 * `@kujam/renderer` — Three-layer renderer (main Canvas 2D, HTML layer, and overlay) for `@kujam/core`.
 *
 * @packageDocumentation
 */

export {
  mountRenderer,
  clampPixelRatio,
  SAFARI_MAX_CANVAS_PIXELS,
  type BoardBackground,
  type BoardView,
  type EditorBounds,
  type OverlayRenderStats,
  type RendererLayers,
  type RendererOptions,
  type RenderStats,
} from './mount.js';
export { LodManager, LOD_HYSTERESIS_BUFFER } from './layers/lod.js';
export {
  ThumbnailCache,
  type DrawTextOptions,
  type DrawThumbnailOptions,
} from './layers/thumbnail-cache.js';
export { MIN_GRID_SCREEN_SPACING } from './layers/background.js';
export {
  OverlayRenderer,
  BRUSH_FILL_COLOR,
  BRUSH_STROKE_COLOR,
  CONNECTOR_HANDLE_RADIUS_PX,
  DEFAULT_COLLAB_COLORS,
  DEFAULT_CURSOR_INACTIVITY_MS,
  HANDLE_SIZE_PX,
  HOVER_STROKE_COLOR,
  ROTATE_HANDLE_OFFSET_PX,
  ROTATE_HANDLE_RADIUS_PX,
  SELECTION_COLOR,
  SELECTION_LINE_WIDTH,
  SNAP_GUIDE_COLOR,
  type ConnectorPreviewOverlay,
  type ConnectorSnapOverlay,
  type RemoteCursor,
  type RemoteSelection,
} from './layers/overlay.js';
