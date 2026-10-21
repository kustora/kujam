/**
 * Thumbnail and image bitmap caching with drawing helpers (BOARD-1204).
 */

import type { ElementCanvasContext } from '@kujam/core';

declare module '@kujam/core' {
  interface ElementCanvasContext {
    /**
     * Adds a rounded rectangle to the current path (BOARD-1204).
     * Uses native `roundRect` if available, or a fallback curve implementation.
     */
    roundRect?(x: number, y: number, w: number, h: number, radii?: number | number[]): void;
    /**
     * Draws a filled circular dot with color (BOARD-1204).
     */
    dot?(x: number, y: number, radius: number, color: string): void;
    /**
     * Alias of `dot`: draws a filled circular status or avatar indicator with color (BOARD-1204).
     */
    colorDot?(x: number, y: number, radius: number, color: string): void;
    /**
     * Renders styled text with optional font, color, alignment, and maximum width (BOARD-1204).
     */
    drawText?(text: string, x: number, y: number, options?: DrawTextOptions): void;
    /**
     * Draws a cached bitmap thumbnail from a URL or image source, with optional rounded corners (BOARD-1204).
     * Returns `true` if rendered immediately from cache, or `false` while async loading in the background.
     */
    drawThumbnail?(
      source: string | CanvasImageSource,
      x: number,
      y: number,
      w: number,
      h: number,
      options?: DrawThumbnailOptions,
    ): boolean;
  }
}

/**
 * Text styling options for the `drawText` drawing context helper (BOARD-1204).
 *
 * @public
 */
export interface DrawTextOptions {
  readonly font?: string;
  readonly color?: string;
  readonly align?: CanvasTextAlign;
  readonly baseline?: CanvasTextBaseline;
  readonly maxWidth?: number;
}

/**
 * Options for the `drawThumbnail` drawing context helper (BOARD-1204).
 *
 * @public
 */
export interface DrawThumbnailOptions {
  readonly radius?: number | number[];
}

/**
 * Polyfills `roundRect` on a 2D context using quadratic curves.
 *
 * @internal
 */
export function polyfillRoundRect(
  ctx: CanvasRenderingContext2D | ElementCanvasContext,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: number | number[] = 0,
): void {
  let rTopLeft = 0;
  let rTopRight = 0;
  let rBottomRight = 0;
  let rBottomLeft = 0;

  if (typeof radii === 'number') {
    rTopLeft = rTopRight = rBottomRight = rBottomLeft = Math.max(0, radii);
  } else if (Array.isArray(radii)) {
    if (radii.length === 1) {
      rTopLeft = rTopRight = rBottomRight = rBottomLeft = Math.max(0, radii[0] ?? 0);
    } else if (radii.length === 2) {
      rTopLeft = rBottomRight = Math.max(0, radii[0] ?? 0);
      rTopRight = rBottomLeft = Math.max(0, radii[1] ?? 0);
    } else if (radii.length === 3) {
      rTopLeft = Math.max(0, radii[0] ?? 0);
      rTopRight = rBottomLeft = Math.max(0, radii[1] ?? 0);
      rBottomRight = Math.max(0, radii[2] ?? 0);
    } else if (radii.length >= 4) {
      rTopLeft = Math.max(0, radii[0] ?? 0);
      rTopRight = Math.max(0, radii[1] ?? 0);
      rBottomRight = Math.max(0, radii[2] ?? 0);
      rBottomLeft = Math.max(0, radii[3] ?? 0);
    }
  }

  // Constrain radii so they do not exceed bounds
  const maxR = Math.min(Math.abs(w) / 2, Math.abs(h) / 2);
  rTopLeft = Math.min(rTopLeft, maxR);
  rTopRight = Math.min(rTopRight, maxR);
  rBottomRight = Math.min(rBottomRight, maxR);
  rBottomLeft = Math.min(rBottomLeft, maxR);

  ctx.moveTo(x + rTopLeft, y);
  ctx.lineTo(x + w - rTopRight, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rTopRight);
  ctx.lineTo(x + w, y + h - rBottomRight);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rBottomRight, y + h);
  ctx.lineTo(x + rBottomLeft, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rBottomLeft);
  ctx.lineTo(x, y + rTopLeft);
  ctx.quadraticCurveTo(x, y, x + rTopLeft, y);
  ctx.closePath();
}

/**
 * Bitmap and image cache for fast canvas rendering of thumbnails (BOARD-1204).
 *
 * @public
 */
export class ThumbnailCache {
  private readonly cache = new Map<string, CanvasImageSource>();
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();

  constructor(private readonly onRequestRender?: () => void) {}

  /**
   * Retrieves a cached image or bitmap for `url`.
   * If not cached, initiates background loading and returns `undefined`.
   */
  get(url: string): CanvasImageSource | undefined {
    if (!url) return undefined;
    const item = this.cache.get(url);
    if (item) return item;
    if (this.pending.has(url) || this.failed.has(url)) return undefined;

    this.load(url);
    return undefined;
  }

  /**
   * Manually caches an image or bitmap for a key.
   */
  set(url: string, image: CanvasImageSource): void {
    this.cache.set(url, image);
  }

  /**
   * Checks whether an image or bitmap is cached for `url`.
   */
  has(url: string): boolean {
    return this.cache.has(url);
  }

  /**
   * Removes a cached item by key.
   */
  delete(url: string): boolean {
    return this.cache.delete(url);
  }

  /**
   * Clears all cached bitmaps and cancels pending states.
   */
  clear(): void {
    for (const img of this.cache.values()) {
      if ('close' in img && typeof img.close === 'function') {
        img.close();
      }
    }
    this.cache.clear();
    this.pending.clear();
    this.failed.clear();
  }

  private load(url: string): void {
    if (typeof Image === 'undefined') return;
    this.pending.add(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.pending.delete(url);
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(img)
          .then((bitmap) => {
            this.cache.set(url, bitmap);
            this.onRequestRender?.();
          })
          .catch(() => {
            this.cache.set(url, img);
            this.onRequestRender?.();
          });
      } else {
        this.cache.set(url, img);
        this.onRequestRender?.();
      }
    };
    img.onerror = () => {
      this.pending.delete(url);
      this.failed.add(url);
    };
    img.src = url;
  }
}

/**
 * Creates an `ElementCanvasContext` wrapper with helpers for custom elements (BOARD-1204).
 *
 * @internal
 */
export function createDrawingContext(
  ctx: CanvasRenderingContext2D,
  thumbnailCache?: ThumbnailCache,
): ElementCanvasContext {
  const helpers = {
    roundRect(x: number, y: number, w: number, h: number, radii?: number | number[]): void {
      if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === 'function') {
        try {
          (
            ctx as unknown as {
              roundRect: (x: number, y: number, w: number, h: number, r?: unknown) => void;
            }
          ).roundRect(x, y, w, h, radii);
          return;
        } catch {
          // Fall back to polyfill if browser roundRect rejects argument format
        }
      }
      polyfillRoundRect(ctx, x, y, w, h, radii);
    },
    dot(x: number, y: number, radius: number, color: string): void {
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    colorDot(x: number, y: number, radius: number, color: string): void {
      helpers.dot(x, y, radius, color);
    },
    drawText(text: string, x: number, y: number, options?: DrawTextOptions): void {
      ctx.save();
      if (options?.font) ctx.font = options.font;
      if (options?.color) ctx.fillStyle = options.color;
      if (options?.align) ctx.textAlign = options.align;
      if (options?.baseline) ctx.textBaseline = options.baseline;
      if (options?.maxWidth !== undefined) {
        ctx.fillText(text, x, y, Math.max(0, options.maxWidth));
      } else {
        ctx.fillText(text, x, y);
      }
      ctx.restore();
    },
    drawThumbnail(
      source: string | CanvasImageSource,
      x: number,
      y: number,
      w: number,
      h: number,
      options?: DrawThumbnailOptions,
    ): boolean {
      let image: CanvasImageSource | undefined;
      if (typeof source === 'string') {
        image = thumbnailCache?.get(source);
        if (!image) return false;
      } else {
        image = source;
      }
      ctx.save();
      if (options?.radius !== undefined) {
        ctx.beginPath();
        helpers.roundRect(x, y, w, h, options.radius);
        ctx.clip();
      }
      if (typeof ctx.drawImage === 'function') {
        ctx.drawImage(image, x, y, w, h);
      }
      ctx.restore();
      return true;
    },
  };

  return new Proxy(ctx as unknown as ElementCanvasContext, {
    get(target, prop, receiver) {
      if (prop in helpers) {
        return (helpers as Record<string | symbol, unknown>)[prop];
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'function') {
        return val.bind(target);
      }
      return val;
    },
    set(target, prop, value, receiver) {
      return Reflect.set(target, prop, value, receiver);
    },
  });
}
