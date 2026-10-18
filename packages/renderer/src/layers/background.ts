/**
 * Board background: plain, dots, or grid lines (BOARD-1007).
 *
 * The pattern is painted on the main canvas underneath the elements, using one `CanvasPattern`
 * tile per frame instead of one draw call per dot or line. The pattern follows the context
 * transform, so the tile is scaled to the exact on-screen spacing and stays aligned with board
 * coordinates at any zoom. When the on-screen spacing gets too dense, the spacing doubles
 * (24, 48, 96, ...) so dots stay on `jam-grid` multiples.
 */

import type { CameraState, ThemeCanvasTokens } from '@kujam/core';

/**
 * Board background style (BOARD-1007).
 *
 * - `none`: plain background color only.
 * - `dots`: one dot at every grid point.
 * - `grid`: horizontal and vertical grid lines.
 *
 * @public
 */
export type BoardBackground = 'none' | 'dots' | 'grid';

/** Valid {@link BoardBackground} values. */
const BACKGROUNDS: readonly BoardBackground[] = ['none', 'dots', 'grid'];

/**
 * Minimum on-screen grid spacing in CSS pixels. Below this, the board spacing doubles until the
 * pattern is sparse enough (BOARD-1007).
 *
 * @public
 */
export const MIN_GRID_SCREEN_SPACING = 12;

/** Dot radius in CSS pixels; constant on screen regardless of zoom. */
const DOT_RADIUS_PX = 1;

/** Grid line width in CSS pixels; constant on screen regardless of zoom. */
const GRID_LINE_WIDTH_PX = 1;

/** Upper bound for the tile size in device pixels, to keep the cached tile small. */
const MAX_TILE_PX = 512;

/**
 * Validates a background option value.
 *
 * @throws `RangeError` for an unknown value.
 * @internal
 */
export function assertBackground(value: unknown): BoardBackground {
  if (!BACKGROUNDS.includes(value as BoardBackground)) {
    throw new RangeError(`Opsi background wajib salah satu dari: ${BACKGROUNDS.join(', ')}.`);
  }
  return value as BoardBackground;
}

/**
 * Returns the effective board-unit spacing for the given zoom: the base spacing doubled until it
 * is at least {@link MIN_GRID_SCREEN_SPACING} CSS pixels on screen. Returns `0` for invalid input.
 *
 * @internal
 */
export function effectiveGridSpacing(baseSpacing: number, zoom: number): number {
  if (!(baseSpacing > 0) || !(zoom > 0) || !Number.isFinite(baseSpacing * zoom)) return 0;
  let spacing = baseSpacing;
  while (spacing * zoom < MIN_GRID_SCREEN_SPACING) spacing *= 2;
  return spacing;
}

/** Device-pixel rectangle to paint. */
export interface DeviceRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Draws dots or lines one by one; used only when cells are larger than {@link MAX_TILE_PX}. */
function paintDirect(
  ctx: CanvasRenderingContext2D,
  rect: DeviceRect,
  camera: CameraState,
  scale: number,
  devSpacing: number,
  pixelRatio: number,
  color: string,
  mode: Exclude<BoardBackground, 'none'>,
): void {
  // Device position of the board origin; grid points sit at origin + k * devSpacing.
  const ox = -camera.x * scale;
  const oy = -camera.y * scale;
  // Pad by the feature size so dots and lines straddling the rect edge are still drawn.
  const pad = 2 * pixelRatio;
  const startX = ox + Math.ceil((rect.x - pad - ox) / devSpacing) * devSpacing;
  const startY = oy + Math.ceil((rect.y - pad - oy) / devSpacing) * devSpacing;
  const endX = rect.x + rect.w + pad;
  const endY = rect.y + rect.h + pad;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = color;
  if (mode === 'dots') {
    const r = DOT_RADIUS_PX * pixelRatio;
    ctx.beginPath();
    for (let y = startY; y <= endY; y += devSpacing) {
      for (let x = startX; x <= endX; x += devSpacing) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  } else {
    const lw = Math.max(1, Math.round(GRID_LINE_WIDTH_PX * pixelRatio));
    for (let x = startX; x <= endX; x += devSpacing) {
      ctx.fillRect(Math.round(x - lw / 2), rect.y, lw, rect.h);
    }
    for (let y = startY; y <= endY; y += devSpacing) {
      ctx.fillRect(rect.x, Math.round(y - lw / 2), rect.w, lw);
    }
  }
  ctx.restore();
}

/**
 * Paints the board background pattern with a cached tile (BOARD-1007).
 *
 * @internal
 */
export class BackgroundPainter {
  private tileKey = '';
  private pattern: CanvasPattern | null = null;

  /**
   * Paints the pattern into a device-pixel rectangle of `ctx`. Leaves the context transform and
   * fill style as they were. Does nothing for `none`, or when the context cannot create patterns.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    rect: DeviceRect,
    camera: CameraState,
    pixelRatio: number,
    tokens: ThemeCanvasTokens,
    mode: BoardBackground,
  ): void {
    if (mode === 'none' || rect.w <= 0 || rect.h <= 0) return;
    if (typeof ctx.createPattern !== 'function') return;

    const spacing = effectiveGridSpacing(tokens.gridSpacing, camera.zoom);
    if (spacing === 0) return;

    const scale = camera.zoom * pixelRatio;
    const devSpacing = spacing * scale;
    if (devSpacing > MAX_TILE_PX) {
      // Zoomed far in: only a handful of cells are visible, so direct drawing is cheap and keeps
      // the dot size exact without a huge tile.
      paintDirect(ctx, rect, camera, scale, devSpacing, pixelRatio, tokens.gridDot, mode);
      return;
    }
    const tileSize = Math.max(1, Math.round(devSpacing));
    const pattern = this.getPattern(ctx, mode, tileSize, pixelRatio, tokens.gridDot);
    if (!pattern) return;

    // Pattern space: one tile per grid cell, with the dot or line crossing at the tile center.
    // Shifting the origin by half a cell puts that center on board multiples of `spacing`.
    const s = devSpacing / tileSize;
    const e = -camera.x * scale - devSpacing / 2;
    const f = -camera.y * scale - devSpacing / 2;

    ctx.save();
    ctx.setTransform(s, 0, 0, s, e, f);
    ctx.fillStyle = pattern;
    ctx.fillRect((rect.x - e) / s, (rect.y - f) / s, rect.w / s, rect.h / s);
    ctx.restore();
  }

  private getPattern(
    ctx: CanvasRenderingContext2D,
    mode: Exclude<BoardBackground, 'none'>,
    tileSize: number,
    pixelRatio: number,
    color: string,
  ): CanvasPattern | null {
    const key = `${mode}|${tileSize}|${pixelRatio}|${color}`;
    if (key === this.tileKey) return this.pattern;

    this.tileKey = key;
    this.pattern = null;
    const doc = ctx.canvas?.ownerDocument;
    if (!doc) return null;
    const tile = doc.createElement('canvas');
    tile.width = tileSize;
    tile.height = tileSize;
    const tctx = tile.getContext('2d');
    if (!tctx) return null;

    const center = tileSize / 2;
    tctx.fillStyle = color;
    if (mode === 'dots') {
      tctx.beginPath();
      tctx.arc(center, center, DOT_RADIUS_PX * pixelRatio, 0, Math.PI * 2);
      tctx.fill();
    } else {
      const lw = Math.max(1, Math.round(GRID_LINE_WIDTH_PX * pixelRatio));
      const start = Math.round(center - lw / 2);
      tctx.fillRect(start, 0, lw, tileSize);
      tctx.fillRect(0, start, tileSize, lw);
    }
    this.pattern = ctx.createPattern(tile, 'repeat');
    return this.pattern;
  }
}
