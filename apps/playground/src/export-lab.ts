/**
 * Export lab logic (BOARD-2413): options kept in the query string, the export scope, and one call
 * that runs `@kujam/export` for PNG, SVG, plain text, or JSON and returns a downloadable file.
 * The scenario in `scenarios/export-lab.ts` only builds the UI around it.
 */

import type { Board } from '@kujam/core';
import { exportJSON, exportPNG, exportSVG, exportText, type ExportWarning } from '@kujam/export';
import type { ScenarioState } from './scenario.js';

export const LAB_FORMATS = ['png', 'svg', 'text', 'json'] as const;
export type LabFormat = (typeof LAB_FORMATS)[number];

export const LAB_SCOPES = ['board', 'selection', 'frame'] as const;
export type LabScope = (typeof LAB_SCOPES)[number];

/** `theme` uses the board theme's canvas color, `transparent` none, anything else is a CSS color. */
export type LabBackground = 'theme' | 'transparent' | string;

export interface LabOptions {
  readonly format: LabFormat;
  readonly scope: LabScope;
  /** Frame exported with the `frame` scope. */
  readonly frameId: string | null;
  /** PNG: 1 to 4 pixels per board unit. SVG: size multiplier. */
  readonly scale: number;
  readonly background: LabBackground;
  /** Space around the content in board units; `null` keeps the package default. */
  readonly padding: number | null;
}

export const DEFAULT_LAB_OPTIONS: LabOptions = Object.freeze({
  format: 'png',
  scope: 'board',
  frameId: null,
  scale: 2,
  background: 'theme',
  padding: null,
});

export const LAB_SCALES = [1, 2, 3, 4] as const;

const COLOR = /^#[0-9a-f]{6}$/i;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Reads the lab options from the query string, falling back to the defaults for bad values. */
export function readLabOptions(state: ScenarioState): LabOptions {
  const scale = Number(state.get('scale'));
  const padding = state.get('padding');
  const paddingValue = padding === null || padding === '' ? null : Number(padding);
  const background = state.get('bg');
  return {
    format: pick(state.get('format'), LAB_FORMATS, DEFAULT_LAB_OPTIONS.format),
    scope: pick(state.get('scope'), LAB_SCOPES, DEFAULT_LAB_OPTIONS.scope),
    frameId: state.get('frame') || null,
    scale: (LAB_SCALES as readonly number[]).includes(scale) ? scale : DEFAULT_LAB_OPTIONS.scale,
    background:
      background === 'theme' ||
      background === 'transparent' ||
      (background && COLOR.test(background))
        ? background
        : DEFAULT_LAB_OPTIONS.background,
    padding:
      paddingValue !== null &&
      Number.isFinite(paddingValue) &&
      paddingValue >= 0 &&
      paddingValue <= 512
        ? paddingValue
        : null,
  };
}

/** Stores the options in the query string; default values are left out to keep the URL short. */
export function writeLabOptions(state: ScenarioState, options: LabOptions): void {
  const d = DEFAULT_LAB_OPTIONS;
  state.set('format', options.format === d.format ? null : options.format);
  state.set('scope', options.scope === d.scope ? null : options.scope);
  state.set('frame', options.scope === 'frame' ? options.frameId : null);
  state.set('scale', options.scale === d.scale ? null : String(options.scale));
  state.set('bg', options.background === d.background ? null : options.background);
  state.set('padding', options.padding === null ? null : String(options.padding));
}

/** Frames on the current page, by name, for the scope picker. */
export function listFrames(board: Board): { id: string; name: string }[] {
  return board
    .query({ type: 'frame' })
    .map((el) => ({ id: el.id, name: String((el.props as { name?: unknown }).name ?? el.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface LabResult {
  readonly format: LabFormat;
  readonly blob: Blob;
  /** Text content for text, JSON, and SVG (its source). */
  readonly text: string | null;
  /** Pixel size for PNG and SVG. */
  readonly width: number | null;
  readonly height: number | null;
  /** PNG scale actually used; lower than requested when the canvas limits were hit. */
  readonly scale: number | null;
  readonly warnings: readonly ExportWarning[];
  readonly fileName: string;
  readonly ms: number;
}

/** Thrown for a scope that cannot be exported, such as an empty selection. */
export class LabScopeError extends Error {}

interface Scope {
  readonly ids?: readonly string[];
  readonly frameId?: string;
  readonly label: string;
}

function resolveScope(board: Board, options: LabOptions): Scope {
  if (options.scope === 'selection') {
    if (board.selection.length === 0) {
      throw new LabScopeError('Seleksi kosong: pilih elemen di papan dulu.');
    }
    return { ids: board.selection, label: 'seleksi' };
  }
  if (options.scope === 'frame') {
    const frame = options.frameId ? board.getElement(options.frameId) : undefined;
    if (!frame || frame.type !== 'frame') {
      throw new LabScopeError('Frame tidak ditemukan: pilih frame dari daftar.');
    }
    const name = String((frame.props as { name?: unknown }).name ?? 'frame');
    return { frameId: frame.id, label: `frame-${slug(name)}` };
  }
  return { label: 'papan' };
}

function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .slice(0, 40) || 'frame'
  );
}

const EXTENSION: Record<LabFormat, string> = { png: 'png', svg: 'svg', text: 'txt', json: 'json' };

export function labFileName(format: LabFormat, scopeLabel: string): string {
  return `kujam-${scopeLabel}.${EXTENSION[format]}`;
}

/** Functions the lab calls; replaced in tests. */
export interface LabExporters {
  exportPNG: typeof exportPNG;
  exportSVG: typeof exportSVG;
  exportText: typeof exportText;
  exportJSON: typeof exportJSON;
}

const DEFAULT_EXPORTERS: LabExporters = { exportPNG, exportSVG, exportText, exportJSON };

/** Runs one export with the lab options. */
export async function runLabExport(
  board: Board,
  options: LabOptions,
  exporters: LabExporters = DEFAULT_EXPORTERS,
  now: () => number = () => performance.now(),
): Promise<LabResult> {
  const scope = resolveScope(board, options);
  const started = now();
  const fileName = labFileName(options.format, scope.label);
  const where = { ids: scope.ids, frameId: scope.frameId };
  const image = {
    ...where,
    background:
      options.background === 'theme'
        ? true
        : options.background === 'transparent'
          ? false
          : options.background,
    ...(options.padding === null ? {} : { padding: options.padding }),
  };

  switch (options.format) {
    case 'png': {
      const result = await exporters.exportPNG(board, { ...image, scale: options.scale });
      return {
        format: 'png',
        blob: result.data,
        text: null,
        width: result.width,
        height: result.height,
        scale: result.scale,
        warnings: result.warnings,
        fileName,
        ms: now() - started,
      };
    }
    case 'svg': {
      const result = await exporters.exportSVG(board, { ...image, scale: options.scale });
      return {
        format: 'svg',
        blob: new Blob([result.data], { type: result.mimeType }),
        text: result.data,
        width: result.width,
        height: result.height,
        scale: null,
        warnings: result.warnings,
        fileName,
        ms: now() - started,
      };
    }
    case 'text': {
      const text = exporters.exportText(board, where);
      return textResult('text', text, 'text/plain;charset=utf-8', fileName, now() - started);
    }
    case 'json': {
      // A frame's JSON is the frame with its content.
      const ids = scope.frameId ? [scope.frameId] : scope.ids;
      const doc = exporters.exportJSON(board, ids ? { ids } : {});
      const text = JSON.stringify(doc, null, 2);
      return textResult('json', text, 'application/json', fileName, now() - started);
    }
  }
}

function textResult(
  format: 'text' | 'json',
  text: string,
  type: string,
  fileName: string,
  ms: number,
): LabResult {
  return {
    format,
    blob: new Blob([text], { type }),
    text,
    width: null,
    height: null,
    scale: null,
    warnings: [],
    fileName,
    ms,
  };
}

/** `1.2 KB`-style size for the result header. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
