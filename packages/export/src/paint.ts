/**
 * Drawing shared by the exports: placeholders, the built-in image element, and painting a scene
 * onto a real 2D canvas (PNG, thumbnails, raster captures of custom elements).
 *
 * @internal
 */

import type {
  AnyElementDefinition,
  Board,
  ElementCanvasContext,
  ElementLodState,
  ElementRecord,
} from '@kujam/core';
import { createDrawingContext, type ThumbnailCache } from '@kujam/renderer';
import type { ExportWarning } from './errors.js';
import { pushWarning, type ElementMode, type ExportData, type Scene } from './scene.js';

const PLACEHOLDER_FILL = 'rgba(128, 128, 128, 0.12)';
const PLACEHOLDER_STROKE = 'rgba(128, 128, 128, 0.7)';
const PLACEHOLDER_TEXT = 'rgba(96, 96, 96, 0.95)';
const ERROR_FILL = 'rgba(239, 68, 68, 0.12)';
const ERROR_STROKE = 'rgba(239, 68, 68, 0.8)';
const ERROR_TEXT = '#DC2626';

/** Box of the element's size with a centered label, like the renderer's placeholders. */
export function drawPlaceholder(
  g: ElementCanvasContext,
  el: ElementRecord,
  label: string,
  tone: 'neutral' | 'error',
  fontFamily: string,
): void {
  const w = Math.max(1, el.w);
  const h = Math.max(1, el.h);
  g.save();
  g.fillStyle = tone === 'error' ? ERROR_FILL : PLACEHOLDER_FILL;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = tone === 'error' ? ERROR_STROKE : PLACEHOLDER_STROKE;
  g.lineWidth = 1;
  g.setLineDash([4, 4]);
  g.strokeRect(0, 0, w, h);
  g.setLineDash([]);
  const fontSize = Math.min(14, Math.max(6, Math.min(w, h) / 4));
  if (label && w > fontSize * 2 && h > fontSize * 1.5) {
    g.fillStyle = tone === 'error' ? ERROR_TEXT : PLACEHOLDER_TEXT;
    g.font = `${fontSize}px ${fontFamily}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2, Math.max(0, w - 8));
  }
  g.restore();
}

const LABELS = {
  image: { id: 'Gambar tidak tersedia', en: 'Image unavailable' },
  forbidden: { id: 'Tidak punya akses', en: 'No access' },
  'not-found': { id: 'Tidak ditemukan', en: 'Not found' },
  error: { id: 'Gagal memuat', en: 'Could not load' },
  loading: { id: 'Memuat…', en: 'Loading…' },
  failed: { id: 'Gagal dirender', en: 'Render failed' },
} as const;

/** Localized placeholder label. */
export function placeholderLabel(board: Board, key: keyof typeof LABELS): string {
  return String(board.locale).startsWith('en') ? LABELS[key].en : LABELS[key].id;
}

/** Placeholder label for an element whose data is not ready (BOARD-1202). */
export function dataPlaceholderLabel(
  board: Board,
  def: AnyElementDefinition | undefined,
  status: ExportData['status'],
): string {
  if (status === 'ready') return '';
  try {
    const custom = def?.placeholder?.(status)?.label;
    if (typeof custom === 'string' && custom) return custom;
  } catch {
    // A failing placeholder callback falls back to the default label.
  }
  return placeholderLabel(board, status);
}

/** Crop of the built-in image element, normalized to 0..1. */
interface Crop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Draws the built-in image element (BOARD-1103) from an already loaded image: rounded 4-unit
 * corners and the normalized crop, like `@kujam/shapes` does on screen.
 */
export function drawImageElement(
  g: ElementCanvasContext,
  el: ElementRecord,
  image: object,
  size: { readonly w: number; readonly h: number },
): void {
  if (typeof g.drawImage !== 'function') return;
  g.save();
  const r = Math.min(4, el.w / 2, el.h / 2);
  g.beginPath();
  g.moveTo(r, 0);
  g.lineTo(el.w - r, 0);
  g.quadraticCurveTo(el.w, 0, el.w, r);
  g.lineTo(el.w, el.h - r);
  g.quadraticCurveTo(el.w, el.h, el.w - r, el.h);
  g.lineTo(r, el.h);
  g.quadraticCurveTo(0, el.h, 0, el.h - r);
  g.lineTo(0, r);
  g.quadraticCurveTo(0, 0, r, 0);
  g.closePath();
  g.clip();
  const crop = (el.props as { crop?: Crop | null }).crop;
  if (crop && [crop.x, crop.y, crop.w, crop.h].every(Number.isFinite)) {
    g.drawImage(
      image,
      crop.x * size.w,
      crop.y * size.h,
      crop.w * size.w,
      crop.h * size.h,
      0,
      0,
      el.w,
      el.h,
    );
  } else {
    g.drawImage(image, 0, 0, el.w, el.h);
  }
  g.restore();
}

/** Calls `render.canvas` as a method (plugin renderers keep their `this`). */
export function callCanvasRenderer(
  def: AnyElementDefinition,
  g: ElementCanvasContext,
  el: ElementRecord,
  data: unknown,
  lod: ElementLodState,
  board: Board,
): void {
  def.render!.canvas!(g, el as never, data as never, lod, board.elementContext);
}

/** What {@link paintScene} draws for elements that need preloaded content. */
export interface PaintInputs {
  /** Board units to pixels. */
  readonly scale: number;
  /** Board point at the canvas origin. */
  readonly originX: number;
  readonly originY: number;
  /** Draw `render.canvas` in its compact version (thumbnails). */
  readonly compact: boolean;
  readonly data: ReadonlyMap<string, ExportData>;
  /** How each element is drawn. */
  mode(el: ElementRecord, def: AnyElementDefinition | undefined): ElementMode;
  /** Loaded images of built-in image elements, by element ID (`null`: failed). */
  readonly images?: ReadonlyMap<string, { image: CanvasImageSource; w: number; h: number } | null>;
  /** Rasterized `export.svg` fragments, by element ID, covering the box plus `margin`. */
  readonly fragments?: ReadonlyMap<string, CanvasImageSource | null>;
  /** Margin around the element box covered by {@link PaintInputs.fragments}. */
  readonly fragmentMargin?: number;
  readonly thumbnailCache?: ThumbnailCache;
  /** Draw custom canvas elements as placeholders (after a tainted canvas). */
  readonly customAsPlaceholder?: boolean;
  readonly warnings: ExportWarning[];
}

/** Paints `scene` onto `ctx` (its transform is reset). Background is not painted here. */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  board: Board,
  scene: Scene,
  inputs: PaintInputs,
): void {
  const fontFamily = board.theme.typography.fontFamily;
  const { scale } = inputs;
  ctx.setTransform(scale, 0, 0, scale, -inputs.originX * scale, -inputs.originY * scale);
  const g = createDrawingContext(ctx, inputs.thumbnailCache);
  ctx.save();
  if (scene.frame) {
    // Crop to the frame like a slide, whatever the padding.
    ctx.beginPath();
    ctx.rect(scene.frame.x, scene.frame.y, scene.frame.w, scene.frame.h);
    ctx.clip();
  }
  for (const el of scene.elements) {
    const def = board.elements.get(el.type);
    ctx.save();
    try {
      const clip = scene.clipFrames.get(el.id);
      if (clip) {
        ctx.beginPath();
        ctx.rect(clip.x, clip.y, clip.w, clip.h);
        ctx.clip();
      }
      ctx.translate(el.x, el.y);
      if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
      if (el.opacity !== undefined && el.opacity < 1) {
        ctx.globalAlpha *= Math.max(0, Math.min(1, el.opacity));
      }
      paintElement(g, board, el, def, inputs, fontFamily);
    } catch {
      // Fail-safe: a broken element never stops the export.
    } finally {
      ctx.restore();
    }
  }
  ctx.restore();
}

function paintElement(
  g: ElementCanvasContext,
  board: Board,
  el: ElementRecord,
  def: AnyElementDefinition | undefined,
  inputs: PaintInputs,
  fontFamily: string,
): void {
  const mode = inputs.mode(el, def);
  const data = inputs.data.get(el.id);
  switch (mode) {
    case 'unknown':
      drawPlaceholder(g, el, el.type, 'neutral', fontFamily);
      return;
    case 'data-placeholder':
      drawPlaceholder(
        g,
        el,
        dataPlaceholderLabel(board, def, data?.status ?? 'loading'),
        'neutral',
        fontFamily,
      );
      return;
    case 'html-only':
      drawPlaceholder(g, el, safeA11yLabel(board, el, def, data) || el.type, 'neutral', fontFamily);
      return;
    case 'image': {
      const loaded = inputs.images?.get(el.id);
      if (loaded) drawImageElement(g, el, loaded.image, loaded);
      else drawPlaceholder(g, el, placeholderLabel(board, 'image'), 'neutral', fontFamily);
      return;
    }
    case 'svg': {
      const fragment = inputs.fragments?.get(el.id);
      if (fragment && typeof g.drawImage === 'function') {
        const m = inputs.fragmentMargin ?? 0;
        g.drawImage(fragment, -m, -m, el.w + m * 2, el.h + m * 2);
        return;
      }
      if (def?.render?.canvas) break;
      drawPlaceholder(g, el, el.type, 'neutral', fontFamily);
      return;
    }
    case 'raster':
      if (inputs.customAsPlaceholder) {
        drawPlaceholder(
          g,
          el,
          safeA11yLabel(board, el, def, data) || el.type,
          'neutral',
          fontFamily,
        );
        return;
      }
      break;
    case 'vector':
      break;
  }
  if (!def?.render?.canvas) return;
  const lod: ElementLodState = {
    zoom: inputs.scale,
    compact: inputs.compact || typeof def.render.html === 'function',
  };
  try {
    callCanvasRenderer(def, g, el, data?.status === 'ready' ? data.data : undefined, lod, board);
  } catch (error) {
    pushWarning(inputs.warnings, {
      code: 'render-error',
      elementId: el.id,
      message: `Elemen "${el.id}" (${el.type}) gagal dirender: ${error instanceof Error ? error.message : String(error)}`,
    });
    drawPlaceholder(g, el, placeholderLabel(board, 'failed'), 'error', fontFamily);
  }
}

/** The element's a11y label (BOARD-1212), or `''` when it has none or the callback throws. */
export function safeA11yLabel(
  board: Board,
  el: ElementRecord,
  def: AnyElementDefinition | undefined,
  data: ExportData | undefined,
): string {
  try {
    const a11y = def?.a11y?.(
      el as never,
      (data?.status === 'ready' ? data.data : undefined) as never,
      board.elementContext,
    );
    return typeof a11y?.label === 'string' ? a11y.label.trim() : '';
  } catch {
    return '';
  }
}
