/**
 * Errors and warnings of the image, PDF, and text exports (BOARD-1702, BOARD-1703, BOARD-1705,
 * BOARD-1707).
 */

/**
 * Codes for {@link ExportError}.
 *
 * - `nothing-to-export`: no element matches the scope (empty page, unknown IDs).
 * - `frame-not-found`: `frameId` is not a frame of the board.
 * - `invalid-options`: an option has the wrong type or range.
 * - `unsupported-format`: no built-in or plugin exporter for the format.
 * - `unsupported-environment`: the environment lacks what the format needs (a 2D canvas for PNG).
 *
 * @beta
 */
export type ExportErrorCode =
  | 'nothing-to-export'
  | 'frame-not-found'
  | 'invalid-options'
  | 'unsupported-format'
  | 'unsupported-environment';

/**
 * Error thrown when an export cannot run at all. Problems with single elements are reported as
 * {@link ExportWarning}s instead, and the export still completes.
 *
 * @beta
 */
export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

/**
 * Codes for {@link ExportWarning}.
 *
 * - `image-unavailable`: an image asset could not be resolved; a placeholder was drawn.
 * - `image-cors`: a cross-origin image could not be read (CORS) or fetched; a placeholder was
 *   drawn (PNG), or the image is referenced by URL instead of embedded (SVG).
 * - `font-not-embedded`: a font face could not be fetched for embedding; it is referenced instead.
 * - `scale-reduced`: the requested scale exceeded the maximum canvas size and was lowered.
 * - `render-error`: an element's renderer or exporter threw; a placeholder was drawn.
 * - `raster-unavailable`: a custom element without `export.svg` could not be captured as an
 *   image (no canvas in this environment), so its `render.canvas` was recorded as vectors.
 * - `tainted`: a custom element drew a cross-origin image that made the canvas unreadable; custom
 *   canvas elements were redrawn as placeholders.
 * - `html-only`: an element only renders HTML (no `render.canvas` or `export.svg`); a placeholder
 *   was drawn.
 * - `unknown-type`: the element type is not registered; a placeholder was drawn.
 * - `data-unavailable`: external data was not ready (loading, forbidden, not found, or failed); a
 *   placeholder was drawn.
 * - `sanitized`: unsafe parts of a custom element's `export.svg` were removed.
 * - `text-not-selectable`: some text uses characters the standard PDF font cannot encode; it is
 *   visible in the page image but left out of the selectable text layer (BOARD-1705).
 *
 * @beta
 */
export type ExportWarningCode =
  | 'image-unavailable'
  | 'image-cors'
  | 'font-not-embedded'
  | 'scale-reduced'
  | 'render-error'
  | 'raster-unavailable'
  | 'tainted'
  | 'html-only'
  | 'unknown-type'
  | 'data-unavailable'
  | 'sanitized'
  | 'text-not-selectable';

/**
 * Non-fatal problem found during an export.
 *
 * @beta
 */
export interface ExportWarning {
  readonly code: ExportWarningCode;
  /** Human-readable explanation (Indonesian, like the other package messages). */
  readonly message: string;
  /** Element the warning is about, when it is about one element. */
  readonly elementId?: string;
}
