/**
 * Client-side thumbnail (BOARD-1708): a small picture of the board for board lists, made in the
 * browser (for example when the board is closed) when the server cannot render thumbnails
 * because no Node canvas is installed (BOARD-1804).
 *
 * Fast by design: one synchronous paint with every element's compact render (`render.canvas`
 * with `lod.compact: true`, BOARD-1204), no network, no waiting for external data. Elements whose
 * data or images are not loaded yet are drawn as placeholders or skipped, never awaited.
 */

import type { AnyElementDefinition, Board, ElementRecord } from '@kujam/core';
import { defaultCanvasFactory, type ExportCanvasFactory } from './environment.js';
import { ExportError, type ExportWarning } from './errors.js';
import { paintScene } from './paint.js';
import { buildScene, type ElementMode, type ExportData } from './scene.js';
import { checkScale, resolveBackground } from './svg.js';

/**
 * Options for {@link createThumbnail}.
 *
 * @beta
 */
export interface ThumbnailOptions {
  /** Width of the thumbnail in pixels. Defaults to `400`. */
  readonly width?: number;
  /**
   * Height in pixels. When omitted it follows the content's aspect ratio, capped at
   * `width × 2`. With a fixed height the content is fitted and centered.
   */
  readonly height?: number;
  /** Space around the content in thumbnail pixels. Defaults to `16`. */
  readonly padding?: number;
  /** Page to draw; defaults to the current page. */
  readonly pageId?: string;
  /** Draws one frame only, cropped to it. */
  readonly frameId?: string;
  /** `true` (default) for the theme's canvas background, `false` for transparent, or a CSS color. */
  readonly background?: boolean | string;
  /** Image type, `'image/png'` (default), `'image/webp'`, or `'image/jpeg'`. */
  readonly type?: 'image/png' | 'image/webp' | 'image/jpeg';
  /** Quality from 0 to 1 for `image/webp` and `image/jpeg`. */
  readonly quality?: number;
  /** Canvas factory (defaults to `OffscreenCanvas` or a `<canvas>`). */
  readonly createCanvas?: ExportCanvasFactory;
}

/**
 * Result of {@link createThumbnail}.
 *
 * @beta
 */
export interface ThumbnailResult {
  /** The encoded image. */
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  /** Milliseconds spent painting (encoding excluded). */
  readonly paintMs: number;
  readonly warnings: readonly ExportWarning[];
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Creates a thumbnail of the board in the browser (BOARD-1708), for example right before
 * `board.dispose()` when the user closes the board, as the fallback for the server's
 * `renderThumbnail` (BOARD-1804). An empty page gives a thumbnail of the background only.
 *
 * @example
 * ```ts
 * const { blob } = await createThumbnail(board, { width: 320 });
 * await uploadThumbnail(boardId, blob);
 * board.dispose();
 * ```
 *
 * @throws {@link ExportError} `invalid-options`, `frame-not-found`, or `unsupported-environment`
 *   when no canvas can be created.
 * @beta
 */
export async function createThumbnail(
  board: Board,
  options: ThumbnailOptions = {},
): Promise<ThumbnailResult> {
  const width = Math.round(checkScale(options.width, 'width', 1, 4096, 400));
  const fixedHeight =
    options.height === undefined
      ? undefined
      : Math.round(checkScale(options.height, 'height', 1, 4096, 1));
  const padding = checkScale(options.padding, 'padding', 0, 1024, 16);
  const quality =
    options.quality === undefined ? undefined : checkScale(options.quality, 'quality', 0, 1, 1);
  const type = options.type ?? 'image/png';
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(type)) {
    throw new ExportError(
      'invalid-options',
      'Opsi type wajib image/png, image/webp, atau image/jpeg.',
    );
  }
  const background = resolveBackground(board, options.background);
  const createCanvas = options.createCanvas ?? defaultCanvasFactory;
  const warnings: ExportWarning[] = [];

  const started = now();
  let scene;
  try {
    scene = buildScene(board, { pageId: options.pageId, frameId: options.frameId, padding: 0 }, 0);
  } catch (error) {
    if (!(error instanceof ExportError) || error.code !== 'nothing-to-export') throw error;
    scene = null;
  }

  const contentW = scene ? scene.bounds.maxX - scene.bounds.minX : 1;
  const contentH = scene ? scene.bounds.maxY - scene.bounds.minY : 1;
  const height =
    fixedHeight ??
    Math.max(
      1,
      Math.min(width * 2, Math.round(((width - padding * 2) * contentH) / contentW + padding * 2)),
    );
  const target = createCanvas(width, height);
  if (!target) {
    throw new ExportError(
      'unsupported-environment',
      'Canvas 2D tidak tersedia; thumbnail klien membutuhkan browser atau opsi createCanvas.',
    );
  }
  const ctx = target.context;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  if (scene) {
    const availW = Math.max(1, width - padding * 2);
    const availH = Math.max(1, height - padding * 2);
    const scale = Math.min(availW / contentW, availH / contentH);
    const originX = scene.bounds.minX - (padding + (availW - contentW * scale) / 2) / scale;
    const originY = scene.bounds.minY - (padding + (availH - contentH * scale) / 2) / scale;
    const data = new Map<string, ExportData>();
    for (const el of scene.elements) {
      const def = board.elements.get(el.type);
      if (!def?.resolve) continue;
      const state = board.getElementData(el.id, { load: false });
      data.set(
        el.id,
        state.status === 'ready' ? { status: 'ready', data: state.data } : { status: state.status },
      );
    }
    paintScene(ctx, board, scene, {
      scale,
      originX,
      originY,
      compact: true,
      data,
      mode: thumbnailMode(data),
      warnings,
    });
  }
  const paintMs = now() - started;
  const blob = await target.toBlob(type, quality);
  return { blob, width, height, paintMs, warnings };
}

/** Compact canvas render for everything that has one; placeholders otherwise. */
function thumbnailMode(
  data: ReadonlyMap<string, ExportData>,
): (el: ElementRecord, def: AnyElementDefinition | undefined) => ElementMode {
  return (el, def) => {
    if (!def) return 'unknown';
    const state = data.get(el.id);
    if (state && state.status !== 'ready') return 'data-placeholder';
    return typeof def.render?.canvas === 'function' ? 'vector' : 'html-only';
  };
}
