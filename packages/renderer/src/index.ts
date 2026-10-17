/**
 * `@kujam/renderer` — Three-layer renderer (main Canvas 2D, HTML layer, and overlay) for `@kujam/core`.
 *
 * @packageDocumentation
 */

export {
  mountRenderer,
  clampPixelRatio,
  SAFARI_MAX_CANVAS_PIXELS,
  type BoardView,
  type EditorBounds,
  type OverlayRenderStats,
  type RendererLayers,
  type RendererOptions,
  type RenderStats,
} from './mount.js';
export {
  OverlayRenderer,
  HANDLE_SIZE_PX,
  ROTATE_HANDLE_OFFSET_PX,
  ROTATE_HANDLE_RADIUS_PX,
  SELECTION_COLOR,
  SNAP_GUIDE_COLOR,
  type RemoteCursor,
} from './overlay.js';
