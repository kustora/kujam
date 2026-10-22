/**
 * PNG export (BOARD-1703).
 *
 * Elements are painted directly onto a 2D canvas with their own `render.canvas` (the same code
 * as on screen, so text uses the page's loaded fonts), at 1x to 4x. Everything that could taint
 * the canvas is read with CORS first:
 *
 * - images of the built-in image element are fetched and decoded before painting; when that
 *   fails, a placeholder is drawn and a warning returned;
 * - images custom elements draw with `drawThumbnail(url)` are preloaded the same way;
 * - custom `export.svg` fragments are sanitized, their images embedded, and rasterized;
 * - if a custom element still taints the canvas (for example `drawImage` of its own cross-origin
 *   image), the picture is painted again with custom canvas elements as placeholders.
 *
 * Canvas size limits are respected by lowering the scale, with a warning.
 */

import type { AnyElementDefinition, Board, ElementRecord } from '@kujam/core';
import { SAFARI_MAX_CANVAS_PIXELS, ThumbnailCache } from '@kujam/renderer';
import {
  defaultCanvasFactory,
  defaultFetch,
  loadImageElement,
  type ExportCanvasTarget,
  type ExportFetch,
} from './environment.js';
import { ExportError, type ExportWarning } from './errors.js';
import { paintScene } from './paint.js';
import {
  BUILTIN_VECTOR_TYPES,
  buildScene,
  elementMode,
  loadSceneData,
  pushWarning,
  type ExportData,
} from './scene.js';
import {
  buildFragment,
  CAPTURE_MARGIN,
  checkScale,
  embedRemainingImages,
  prepareImages,
  prewarmThumbnails,
  resolveBackground,
  type ExportScopeOptions,
} from './svg.js';
import { el as node, fmt, serializeSvg } from './svg/xml.js';

/**
 * Default maximum width or height of the export canvas, in pixels (BOARD-1703).
 *
 * @beta
 */
export const MAX_EXPORT_CANVAS_SIDE = 16_384;

/**
 * Options for {@link exportPNG}.
 *
 * @beta
 */
export interface ExportPNGOptions extends ExportScopeOptions {
  /** Pixels per board unit, from `1` to `4`. Defaults to `1`. */
  readonly scale?: number;
  /** Maximum canvas width or height in pixels. Defaults to {@link MAX_EXPORT_CANVAS_SIDE}. */
  readonly maxCanvasSide?: number;
  /**
   * Maximum canvas area in pixels. Defaults to the renderer's `SAFARI_MAX_CANVAS_PIXELS`
   * (16,777,216), the lowest limit among supported browsers.
   */
  readonly maxCanvasPixels?: number;
}

/**
 * Result of {@link exportPNG}.
 *
 * @beta
 */
export interface PngExportResult {
  readonly format: 'png';
  readonly mimeType: 'image/png';
  /** The PNG file. */
  readonly data: Blob;
  /** Pixel size of the image. */
  readonly width: number;
  readonly height: number;
  /** Scale actually used; lower than requested when the canvas limits were hit. */
  readonly scale: number;
  readonly warnings: readonly ExportWarning[];
}

/** Scale that fits `w × h` board units into the canvas limits. */
export function fitScale(
  w: number,
  h: number,
  scale: number,
  maxSide: number,
  maxPixels: number,
): number {
  const fitted = Math.min(scale, maxSide / w, maxSide / h, Math.sqrt(maxPixels / (w * h)));
  // Round down a little so rounding up the pixel size never crosses a limit.
  return fitted < scale ? Math.floor(fitted * 1000) / 1000 : scale;
}

/**
 * Exports the board (or a selection, or one frame) as a PNG image (BOARD-1703). Needs a 2D canvas
 * (browsers, or `createCanvas` in other environments).
 *
 * @throws {@link ExportError} `nothing-to-export`, `frame-not-found`, `invalid-options`, or
 *   `unsupported-environment` when no canvas can be created.
 * @beta
 */
export async function exportPNG(
  board: Board,
  options: ExportPNGOptions = {},
): Promise<PngExportResult> {
  const requested = checkScale(options.scale, 'scale', 1, 4, 1);
  const maxSide = checkScale(
    options.maxCanvasSide,
    'maxCanvasSide',
    1,
    1_000_000,
    MAX_EXPORT_CANVAS_SIDE,
  );
  const maxPixels = checkScale(
    options.maxCanvasPixels,
    'maxCanvasPixels',
    1,
    1e12,
    SAFARI_MAX_CANVAS_PIXELS,
  );
  const dataTimeout = checkScale(options.dataTimeout, 'dataTimeout', 0, 600_000, 3000);
  const background = resolveBackground(board, options.background);
  const fetchFn = options.fetch ?? defaultFetch();
  const createCanvas = options.createCanvas ?? defaultCanvasFactory;

  const scene = buildScene(board, options);
  const warnings: ExportWarning[] = [];
  const { bounds } = scene;
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const scale = fitScale(bw, bh, requested, maxSide, maxPixels);
  if (scale < requested) {
    pushWarning(warnings, {
      code: 'scale-reduced',
      message: `Ukuran ${Math.round(bw * requested)}×${Math.round(bh * requested)} px melebihi batas canvas; skala diturunkan dari ${requested} ke ${scale}.`,
    });
  }
  const width = Math.max(1, Math.round(bw * scale));
  const height = Math.max(1, Math.round(bh * scale));

  const data = await loadSceneData(board, scene.elements, dataTimeout);
  const mode = (el: ElementRecord, def: AnyElementDefinition | undefined) =>
    elementMode(el, def, data.get(el.id), false);

  const images = await prepareImages(
    board,
    scene.elements,
    mode,
    { fetch: fetchFn, embed: false, decode: true },
    warnings,
  );
  const fragments = await rasterizeFragments(
    board,
    scene.elements,
    mode,
    data,
    scale,
    fetchFn,
    warnings,
  );
  const thumbnails = new ThumbnailCache();
  const custom = scene.elements.filter(
    (el) => !BUILTIN_VECTOR_TYPES.has(el.type) && board.elements.get(el.type)?.render?.canvas,
  );
  if (custom.length > 0) {
    await prewarmThumbnails(board, custom, data, false, thumbnails, fetchFn, warnings);
  }

  const paint = (customAsPlaceholder: boolean): ExportCanvasTarget => {
    const target = createCanvas(width, height);
    if (!target) {
      throw new ExportError(
        'unsupported-environment',
        'Canvas 2D tidak tersedia; ekspor PNG membutuhkan browser atau opsi createCanvas.',
      );
    }
    const ctx = target.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    paintScene(ctx, board, scene, {
      scale,
      originX: bounds.minX,
      originY: bounds.minY,
      compact: false,
      data,
      mode,
      images: new Map(
        [...images].map(([id, img]) => [
          id,
          img?.image ? { image: img.image, w: img.w, h: img.h } : null,
        ]),
      ),
      fragments,
      fragmentMargin: CAPTURE_MARGIN,
      thumbnailCache: thumbnails,
      customAsPlaceholder,
      warnings,
    });
    return target;
  };

  let blob: Blob;
  try {
    blob = await paint(false).toBlob('image/png');
  } catch (error) {
    if (error instanceof ExportError) throw error;
    // SecurityError: a custom element tainted the canvas. Paint again without them.
    pushWarning(warnings, {
      code: 'tainted',
      message:
        'Elemen kustom menggambar gambar lintas origin tanpa CORS; elemen kustom berbasis canvas diganti placeholder.',
    });
    blob = await paint(true).toBlob('image/png');
  }
  return { format: 'png', mimeType: 'image/png', data: blob, width, height, scale, warnings };
}

/** Sanitized `export.svg` fragments rendered to images, by element ID. */
async function rasterizeFragments(
  board: Board,
  elements: readonly ElementRecord[],
  mode: (el: ElementRecord, def: AnyElementDefinition | undefined) => string,
  data: ReadonlyMap<string, ExportData>,
  scale: number,
  fetchFn: ExportFetch | undefined,
  warnings: ExportWarning[],
): Promise<Map<string, CanvasImageSource | null>> {
  const out = new Map<string, CanvasImageSource | null>();
  let count = 0;
  for (const el of elements) {
    const def = board.elements.get(el.type);
    if (!def || mode(el, def) !== 'svg') continue;
    const nodes = buildFragment(board, el, def, data.get(el.id), `kjp${++count}`, true, warnings);
    if (!nodes) {
      out.set(el.id, null);
      continue;
    }
    // Images inside an SVG image never load from the network: embed them first.
    await embedRemainingImages(nodes, { embed: true, strict: true, fetch: fetchFn }, warnings);
    const m = CAPTURE_MARGIN;
    const w = el.w + m * 2;
    const h = el.h + m * 2;
    const svg = serializeSvg(
      node(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: Math.max(1, Math.round(w * scale)),
          height: Math.max(1, Math.round(h * scale)),
          viewBox: `${fmt(-m)} ${fmt(-m)} ${fmt(w)} ${fmt(h)}`,
          'font-family': board.theme.typography.fontFamily,
        },
        nodes,
      ),
    );
    const image =
      typeof Blob === 'function'
        ? await loadImageElement(new Blob([svg], { type: 'image/svg+xml' }))
        : null;
    if (!image) {
      pushWarning(warnings, {
        code: 'raster-unavailable',
        elementId: el.id,
        message: `export.svg elemen "${el.id}" (${el.type}) tidak dapat dirasterisasi; memakai render.canvas atau placeholder.`,
      });
    }
    out.set(el.id, image);
  }
  return out;
}
