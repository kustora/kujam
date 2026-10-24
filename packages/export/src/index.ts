/**
 * `@kujam/export` — Utilities for exporting board documents to JSON, PNG, SVG, PDF, and plain text.
 *
 * @packageDocumentation
 */

export {
  exportJSON,
  ImportError,
  importJSON,
  type ExportJSONOptions,
  type ImportErrorCode,
  type ImportJSONOptions,
  type ImportResult,
} from './json.js';
export {
  ExportError,
  type ExportErrorCode,
  type ExportWarning,
  type ExportWarningCode,
} from './errors.js';
export type { ExportCanvasFactory, ExportCanvasTarget, ExportFetch } from './environment.js';
export {
  exportSVG,
  type ExportFontFace,
  type ExportScopeOptions,
  type ExportSVGOptions,
  type SvgExportResult,
} from './svg.js';
export {
  exportPNG,
  MAX_EXPORT_CANVAS_SIDE,
  type ExportPNGOptions,
  type PngExportResult,
} from './png.js';
export { exportPDF, type ExportPDFOptions, type PdfExportResult } from './pdf.js';
export { exportText, type ExportTextOptions } from './text.js';
export {
  exportImage,
  listExportFormats,
  type BuiltInImageFormat,
  type ExportFormatInfo,
  type ExportImageOptions,
  type ExportImageResult,
  type PluginExportResult,
} from './image.js';
export { createThumbnail, type ThumbnailOptions, type ThumbnailResult } from './thumbnail.js';
