/**
 * PDF export, one frame per page (BOARD-1705).
 *
 * Every page is the PNG export of one frame (BOARD-1703), so the PDF looks exactly like the image
 * export, with an invisible text layer on top so text stays selectable and searchable. The text
 * layer comes from the SVG export (BOARD-1702), which records every `fillText` with its position:
 * each run is written in a standard PDF font with text render mode "invisible", positioned and
 * stretched to cover the drawn text. Text the standard font cannot encode (outside Windows-1252,
 * for example Arabic or CJK) is left out of the text layer and reported; it is still visible in
 * the image.
 *
 * `pdf-lib` (MIT) is loaded with a dynamic `import()` only when a PDF is exported, so it does not
 * add to the main bundle.
 */

import type { Board, ElementRecord } from '@kujam/core';
import type * as PdfLibModule from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { ExportCanvasFactory, ExportFetch } from './environment.js';
import { createTextMeasurer } from './environment.js';
import { ExportError, type ExportWarning } from './errors.js';
import { exportPNG, MAX_EXPORT_CANVAS_SIDE } from './png.js';
import { pushWarning } from './scene.js';
import { checkScale, renderSvg } from './svg.js';
import type { Matrix } from './svg/svg-context.js';
import type { SvgNode } from './svg/xml.js';

/** PDF points per board unit: board units are CSS pixels (96 per inch), PDF has 72 per inch. */
const POINTS_PER_UNIT = 0.75;

/** Distance from the `dominant-baseline` the SVG export writes to the alphabetic baseline, in em. */
const BASELINE_SHIFT: Readonly<Record<string, number>> = {
  'text-before-edge': 0.8,
  hanging: 0.8,
  central: 0.35,
  ideographic: -0.2,
  'text-after-edge': -0.2,
};

/** Parts of the SVG tree that are never drawn directly. */
const SKIPPED_TAGS = new Set(['defs', 'clipPath', 'title', 'style', 'mask', 'pattern']);

/**
 * Options for {@link exportPDF}.
 *
 * @beta
 */
export interface ExportPDFOptions {
  /**
   * Frames to export, one page each, in this order. Defaults to every frame of the page in
   * `board.frames.list()` order. A page without frames is exported as one page with all its
   * content.
   */
  readonly frameIds?: readonly string[];
  /** Page whose frames are exported; defaults to the current page. */
  readonly pageId?: string;
  /** Pixels per board unit of the page images, from `1` to `4`. Defaults to `2`. */
  readonly scale?: number;
  /** Maximum page image width or height in pixels. Defaults to {@link MAX_EXPORT_CANVAS_SIDE}. */
  readonly maxCanvasSide?: number;
  /** Maximum page image area in pixels. Defaults to the PNG export's default. */
  readonly maxCanvasPixels?: number;
  /**
   * Background: `true` (default) for the theme's canvas background, `false` for transparent, or a
   * CSS color.
   */
  readonly background?: boolean | string;
  /** Adds the invisible text layer that keeps text selectable. Defaults to `true`. */
  readonly selectableText?: boolean;
  /** Document title (PDF metadata). */
  readonly title?: string;
  /**
   * Milliseconds to wait for elements whose external data is still loading before drawing them as
   * placeholders. Defaults to `3000`.
   */
  readonly dataTimeout?: number;
  /** Fetch used to read images (defaults to the global `fetch`). */
  readonly fetch?: ExportFetch;
  /** Canvas factory for the page images (defaults to `OffscreenCanvas` or a `<canvas>`). */
  readonly createCanvas?: ExportCanvasFactory;
}

/**
 * Result of {@link exportPDF}.
 *
 * @beta
 */
export interface PdfExportResult {
  readonly format: 'pdf';
  readonly mimeType: 'application/pdf';
  /** The PDF file. */
  readonly data: Blob;
  /** Number of pages (frames) in the PDF. */
  readonly pageCount: number;
  readonly warnings: readonly ExportWarning[];
}

type PdfLib = typeof PdfLibModule;

async function loadPdfLib(): Promise<PdfLib> {
  try {
    return await import('pdf-lib');
  } catch {
    throw new ExportError(
      'unsupported-environment',
      'Library pdf-lib tidak dapat dimuat; ekspor PDF tidak tersedia.',
    );
  }
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Parses the `transform` syntax the SVG export writes: `translate`, `rotate`, `scale`, `matrix`. */
export function parseTransform(value: string | undefined): Matrix {
  let m = IDENTITY;
  if (!value) return m;
  for (const [, fn, raw] of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const args = raw!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (args.some((n) => !Number.isFinite(n))) continue;
    let t: Matrix | undefined;
    if (fn === 'translate') t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
    else if (fn === 'scale') t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
    else if (fn === 'matrix' && args.length === 6) t = args as Matrix;
    else if (fn === 'rotate') {
      const rad = ((args[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const [cx = 0, cy = 0] = args.slice(1);
      t = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [
        1,
        0,
        0,
        1,
        -cx,
        -cy,
      ]);
    }
    if (t) m = multiply(m, t);
  }
  return m;
}

/** One `<text>` run of the SVG export, with its transform into board coordinates. */
export interface TextRun {
  readonly text: string;
  readonly matrix: Matrix;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** CSS `font` shorthand, for measuring the drawn width. */
  readonly font: string;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly baseline: string | undefined;
  /** Width forced by `textLength`, when the run was squeezed into a maximum width. */
  readonly length: number | undefined;
}

/** Collects the text runs of an SVG export tree in drawing order. */
export function collectTextRuns(root: SvgNode): TextRun[] {
  const runs: TextRun[] = [];
  const visit = (node: SvgNode, parent: Matrix) => {
    if (SKIPPED_TAGS.has(node.tag)) return;
    const matrix = multiply(parent, parseTransform(node.attrs.transform));
    if (node.tag === 'text') {
      const text = node.children.filter((c): c is string => typeof c === 'string').join('');
      const size = Number(node.attrs['font-size']);
      if (text.trim() !== '' && Number.isFinite(size) && size > 0) {
        const anchor = node.attrs['text-anchor'];
        const length = Number(node.attrs.textLength);
        runs.push({
          text,
          matrix,
          x: Number(node.attrs.x) || 0,
          y: Number(node.attrs.y) || 0,
          size,
          font: [
            node.attrs['font-style'] ?? '',
            node.attrs['font-weight'] ?? '',
            `${size}px`,
            node.attrs['font-family'] ?? 'sans-serif',
          ]
            .filter(Boolean)
            .join(' '),
          anchor: anchor === 'middle' || anchor === 'end' ? anchor : 'start',
          baseline: node.attrs['dominant-baseline'],
          length: Number.isFinite(length) && length > 0 ? length : undefined,
        });
      }
      return;
    }
    for (const child of node.children) if (typeof child !== 'string') visit(child, matrix);
  };
  visit(root, IDENTITY);
  return runs;
}

/** Board box covered by an SVG export, from its `viewBox`. */
function viewBoxOf(root: SvgNode): { x: number; y: number; w: number; h: number } {
  const [x = 0, y = 0, w = 1, h = 1] = (root.attrs.viewBox ?? '').split(/\s+/).map(Number);
  return { x, y, w, h };
}

interface TextLayerContext {
  readonly lib: PdfLib;
  readonly page: PDFPage;
  readonly font: PDFFont;
  readonly box: { x: number; y: number; w: number; h: number };
  readonly measure: ((text: string, font: string) => number) | undefined;
  readonly warnings: ExportWarning[];
}

/** Writes the runs as invisible text over the page image. */
function drawTextLayer(runs: readonly TextRun[], ctx: TextLayerContext): void {
  const { lib, page, font, box, warnings } = ctx;
  const k = POINTS_PER_UNIT;
  // Board coordinates (y down) to PDF page coordinates (points, y up).
  const toPage: Matrix = [k, 0, 0, -k, -box.x * k, (box.y + box.h) * k];
  let skipped = 0;
  for (const run of runs) {
    try {
      font.encodeText(run.text);
    } catch {
      skipped++;
      continue;
    }
    const pdfWidth = font.widthOfTextAtSize(run.text, run.size);
    const measured = ctx.measure?.(run.text, run.font);
    const drawnWidth = run.length ?? (measured !== undefined && measured > 0 ? measured : pdfWidth);
    const stretch = pdfWidth > 0 ? drawnWidth / pdfWidth : 1;
    const dx = run.anchor === 'middle' ? -drawnWidth / 2 : run.anchor === 'end' ? -drawnWidth : 0;
    const dy = (run.baseline ? (BASELINE_SHIFT[run.baseline] ?? 0) : 0) * run.size;
    const [ox, oy] = [run.x + dx, run.y + dy];
    // Text origin in board coordinates; runs outside the page (clipped by the frame) are left out.
    const bx = run.matrix[0] * ox + run.matrix[2] * oy + run.matrix[4];
    const by = run.matrix[1] * ox + run.matrix[3] * oy + run.matrix[5];
    if (bx < box.x - 1 || by < box.y - 1 || bx > box.x + box.w + 1 || by > box.y + box.h + 1) {
      continue;
    }
    // Glyph space: at the origin, y flipped back up, stretched to the drawn width.
    const glyph = multiply(multiply(toPage, run.matrix), [stretch, 0, 0, -1, ox, oy]);
    page.pushOperators(
      lib.pushGraphicsState(),
      lib.concatTransformationMatrix(...glyph),
      lib.setTextRenderingMode(lib.TextRenderingMode.Invisible),
    );
    page.drawText(run.text, { x: 0, y: 0, size: run.size, font });
    page.pushOperators(lib.popGraphicsState());
  }
  if (skipped > 0) {
    pushWarning(warnings, {
      code: 'text-not-selectable',
      message: `${skipped} potong teks memakai karakter di luar font PDF standar; teks itu tetap terlihat tetapi tidak bisa dipilih.`,
    });
  }
}

function resolveFrames(board: Board, options: ExportPDFOptions): (ElementRecord | null)[] {
  if (options.frameIds !== undefined) {
    if (!Array.isArray(options.frameIds) || options.frameIds.length === 0) {
      throw new ExportError(
        'invalid-options',
        'Opsi frameIds pada exportPDF wajib berupa array ID frame yang tidak kosong.',
      );
    }
    return options.frameIds.map((id) => {
      const frame = typeof id === 'string' ? board.getElement(id) : undefined;
      if (frame?.type !== 'frame') {
        throw new ExportError('frame-not-found', `Frame "${String(id)}" tidak ditemukan.`);
      }
      return frame;
    });
  }
  const frames = board.frames.list(options.pageId);
  return frames.length > 0 ? [...frames] : [null];
}

/**
 * Exports frames as a PDF, one frame per page in `board.frames.list()` order (BOARD-1705). Each
 * page is the frame's PNG export, sized like the frame (one board unit is 0.75 pt), with an
 * invisible text layer so text can be selected and searched. A page without frames becomes a
 * one-page PDF of all its content. Needs a 2D canvas (browsers, or `createCanvas` elsewhere).
 *
 * `pdf-lib` is loaded on demand, so the PDF code is only downloaded when this runs.
 *
 * @throws {@link ExportError} `nothing-to-export`, `frame-not-found`, `invalid-options`, or
 *   `unsupported-environment` when no canvas can be created or `pdf-lib` cannot be loaded.
 * @beta
 */
export async function exportPDF(
  board: Board,
  options: ExportPDFOptions = {},
): Promise<PdfExportResult> {
  const scale = checkScale(options.scale, 'scale', 1, 4, 2);
  const frames = resolveFrames(board, options);
  const lib = await loadPdfLib();
  const pdf = await lib.PDFDocument.create();
  pdf.setCreator('kujam');
  if (typeof options.title === 'string' && options.title !== '') pdf.setTitle(options.title);
  const selectable = options.selectableText !== false;
  const font = selectable ? await pdf.embedFont(lib.StandardFonts.Helvetica) : undefined;
  const measure = selectable ? createTextMeasurer() : undefined;
  const warnings: ExportWarning[] = [];

  for (const frame of frames) {
    const scope = {
      frameId: frame?.id,
      pageId: frame ? undefined : options.pageId,
      background: options.background,
      dataTimeout: options.dataTimeout,
      fetch: options.fetch,
      createCanvas: options.createCanvas,
    };
    const png = await exportPNG(board, {
      ...scope,
      scale,
      maxCanvasSide: options.maxCanvasSide ?? MAX_EXPORT_CANVAS_SIDE,
      maxCanvasPixels: options.maxCanvasPixels,
    });
    for (const warning of png.warnings) pushWarning(warnings, warning);

    // The SVG export of the same scope gives the page box and the text positions. Custom elements
    // are recorded as vectors so their text is found too, and images are not fetched again.
    const svg = await renderSvg(board, { ...scope, images: 'url', customElements: 'vector' });
    const box = viewBoxOf(svg.root);
    const page = pdf.addPage([box.w * POINTS_PER_UNIT, box.h * POINTS_PER_UNIT]);
    const image = await pdf.embedPng(new Uint8Array(await png.data.arrayBuffer()));
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    if (font) {
      drawTextLayer(collectTextRuns(svg.root), { lib, page, font, box, measure, warnings });
    }
  }

  const bytes = await pdf.save();
  return {
    format: 'pdf',
    mimeType: 'application/pdf',
    data: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    pageCount: frames.length,
    warnings,
  };
}
