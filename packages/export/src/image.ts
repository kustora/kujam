/**
 * Unified image export API (BOARD-1707): `exportImage(board, { format, ... })` for the built-in
 * `svg` and `png` formats and for formats added by plugins through `definePlugin({ exporters })`.
 */

import type { Board, PluginExporter } from '@kujam/core';
import { ExportError, type ExportWarning } from './errors.js';
import { exportPNG, type ExportPNGOptions, type PngExportResult } from './png.js';
import { exportSVG, type ExportSVGOptions, type SvgExportResult } from './svg.js';

/**
 * Formats built into `@kujam/export`.
 *
 * @beta
 */
export type BuiltInImageFormat = 'png' | 'svg';

/**
 * Options for {@link exportImage}: the options of the chosen format plus `format`. Plugin
 * exporters receive the whole object (including `format`) as their `options`.
 *
 * @beta
 */
export type ExportImageOptions =
  | ({ readonly format: 'svg' } & ExportSVGOptions)
  | ({ readonly format: 'png' } & ExportPNGOptions)
  | ({ readonly format: string } & ExportSVGOptions & ExportPNGOptions & Record<string, unknown>);

/**
 * Result of a plugin exporter through {@link exportImage}.
 *
 * @beta
 */
export interface PluginExportResult {
  readonly format: string;
  /** MIME type of `data` when it is a `Blob`, otherwise `''`. */
  readonly mimeType: string;
  /** Whatever the plugin exporter returned (awaited). */
  readonly data: unknown;
  readonly warnings: readonly ExportWarning[];
}

/**
 * Result of {@link exportImage}.
 *
 * @beta
 */
export type ExportImageResult = SvgExportResult | PngExportResult | PluginExportResult;

/**
 * An export format available on a board.
 *
 * @beta
 */
export interface ExportFormatInfo {
  readonly format: string;
  /** Label or i18n key; built-in formats use their upper-case name. */
  readonly label: string;
  /** `'built-in'`, or the ID of the plugin that provides it. */
  readonly source: string;
}

const BUILT_IN: readonly ExportFormatInfo[] = Object.freeze([
  Object.freeze({ format: 'png', label: 'PNG', source: 'built-in' }),
  Object.freeze({ format: 'svg', label: 'SVG', source: 'built-in' }),
]);

/** Plugin exporters installed on the board, first registration of a format wins. */
function pluginExporters(board: Board): Map<string, { exporter: PluginExporter; plugin: string }> {
  const out = new Map<string, { exporter: PluginExporter; plugin: string }>();
  for (const plugin of board.plugins.list()) {
    for (const exporter of plugin.exporters ?? []) {
      if (BUILT_IN.some((f) => f.format === exporter.format) || out.has(exporter.format)) continue;
      out.set(exporter.format, { exporter, plugin: plugin.id });
    }
  }
  return out;
}

/**
 * Export formats available on `board` (BOARD-1707): `png` and `svg`, then the formats of the
 * installed plugins' `exporters` in installation order. A plugin cannot replace a built-in
 * format; when two plugins register the same format, the first one wins.
 *
 * @beta
 */
export function listExportFormats(board: Board): readonly ExportFormatInfo[] {
  const plugins = [...pluginExporters(board)].map(([format, { exporter, plugin }]) =>
    Object.freeze({ format, label: exporter.label ?? format, source: plugin }),
  );
  return Object.freeze([...BUILT_IN, ...plugins]);
}

/**
 * Exports the board as an image (BOARD-1707), as in the PRD:
 * `exportImage(board, { ids, frameId, format: 'png' | 'svg', scale, background })`.
 *
 * `format: 'svg'` runs {@link exportSVG} and `format: 'png'` runs {@link exportPNG}; any other
 * format is looked up among the plugin `exporters` and called as `exporter.export(board, options)`.
 *
 * @throws {@link ExportError} `unsupported-format` when no exporter handles `format`, plus the
 *   errors of the chosen exporter.
 * @beta
 */
export function exportImage(
  board: Board,
  options: { readonly format: 'svg' } & ExportSVGOptions,
): Promise<SvgExportResult>;
/**
 * Exports the board as PNG; see {@link exportPNG}.
 *
 * @beta
 */
export function exportImage(
  board: Board,
  options: { readonly format: 'png' } & ExportPNGOptions,
): Promise<PngExportResult>;
/**
 * Exports the board in any registered format; see {@link listExportFormats}.
 *
 * @beta
 */
export function exportImage(board: Board, options: ExportImageOptions): Promise<ExportImageResult>;
export async function exportImage(
  board: Board,
  options: ExportImageOptions,
): Promise<ExportImageResult> {
  const format = (options as { format?: unknown })?.format;
  if (typeof format !== 'string' || format === '') {
    throw new ExportError('invalid-options', 'Opsi format wajib berupa string, misalnya "png".');
  }
  if (format === 'svg') return exportSVG(board, options as ExportSVGOptions);
  if (format === 'png') return exportPNG(board, options as ExportPNGOptions);
  const entry = pluginExporters(board).get(format);
  if (!entry) {
    throw new ExportError(
      'unsupported-format',
      `Format ekspor "${format}" tidak tersedia. Format yang tersedia: ${listExportFormats(board)
        .map((f) => f.format)
        .join(', ')}.`,
    );
  }
  const data: unknown = await entry.exporter.export(board, options);
  const mimeType = typeof Blob === 'function' && data instanceof Blob ? data.type : '';
  return { format, mimeType, data, warnings: [] };
}
