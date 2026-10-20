/**
 * Image element and media asset rendering (BOARD-1103, BOARD-1906).
 *
 * @packageDocumentation
 */

import {
  defineElement,
  enumOf,
  nullable,
  number,
  object,
  optional,
  rect,
  sanitizeUrl,
  string,
  type ElementAction,
  type ElementActionContext,
  type ElementCanvasContext,
  type ElementContext,
  type ElementLodState,
  type ElementRecord,
} from '@kujam/core';
import { traceRoundedRect } from '../canvas.js';

/**
 * Normalized crop bounding box (0..1 coordinates relative to image dimensions).
 *
 * @public
 */
export interface ImageCrop {
  /** Horizontal offset in normalized coordinate [0, 1]. */
  readonly x: number;
  /** Vertical offset in normalized coordinate [0, 1]. */
  readonly y: number;
  /** Crop width in normalized coordinate [0.001, 1]. */
  readonly w: number;
  /** Crop height in normalized coordinate [0.001, 1]. */
  readonly h: number;
}

/**
 * Valid upload statuses for an image element asset.
 *
 * @public
 */
export const IMAGE_UPLOAD_STATUSES = ['pending', 'uploading', 'error', 'ready'] as const;

/**
 * Status of an image upload operation.
 *
 * @public
 */
export type ImageUploadStatus = (typeof IMAGE_UPLOAD_STATUSES)[number];

/**
 * Properties of an image element record.
 *
 * @public
 */
export interface ImageProps {
  /** Identifier of the media asset. */
  readonly assetId: string;
  /** Optional crop bounds in normalized coordinates. */
  readonly crop?: ImageCrop | null;
  /** Alternative text for screen readers and accessibility (BOARD-1906). */
  readonly alt?: string;
  /** Upload status of the asset (BOARD-1103). */
  readonly uploadStatus?: ImageUploadStatus;
  /** Upload progress percentage from 0 to 100. */
  readonly uploadProgress?: number;
  /** Error message when upload fails. */
  readonly uploadError?: string;
}

/**
 * Schema for image crop coordinates.
 *
 * @public
 */
export const imageCropSchema = object({
  x: number({ min: 0, max: 1 }),
  y: number({ min: 0, max: 1 }),
  w: number({ min: 0.001, max: 1 }),
  h: number({ min: 0.001, max: 1 }),
});

/**
 * Schema for image element properties.
 *
 * @public
 */
export const imagePropsSchema = object({
  assetId: string(),
  crop: optional(nullable(imageCropSchema)),
  alt: optional(string({ maxLength: 500 })),
  uploadStatus: optional(enumOf(['pending', 'uploading', 'error', 'ready'] as const)),
  uploadProgress: optional(number({ min: 0, max: 100 })),
  uploadError: optional(string({ maxLength: 500 })),
});

/**
 * Default dimensions of a new image element in board units (320 × 240).
 *
 * @public
 */
export const DEFAULT_IMAGE_SIZE = Object.freeze({ w: 320, h: 240 });

/**
 * Allowed URL schemes for image assets (BOARD-2002).
 *
 * @public
 */
export const ALLOWED_IMAGE_SCHEMES = ['https:', 'http:', 'blob:', 'data:'] as const;

/**
 * Validates and sanitizes an image URL (BOARD-2002).
 *
 * @param url - Raw URL to validate.
 * @returns Sanitized URL string if safe, or `null` if unsafe.
 * @public
 */
export function sanitizeImageUrl(url: unknown): string | null {
  return sanitizeUrl(url, ALLOWED_IMAGE_SCHEMES);
}

/**
 * Cached state of a resolved and loaded image bitmap or HTML image element.
 *
 * @public
 */
export interface ImageCacheEntry {
  status: 'loading' | 'loaded' | 'error';
  image?: CanvasImageSource | null;
  error?: unknown;
  promise?: Promise<CanvasImageSource | null>;
}

const imageCache = new Map<string, ImageCacheEntry>();

/**
 * Clears the image bitmap cache. Useful between test suites.
 *
 * @public
 */
export function clearImageCache(): void {
  imageCache.clear();
}

/**
 * Manually injects or overrides an entry in the image cache.
 *
 * @public
 */
export function cacheLoadedImage(key: string, image: CanvasImageSource): void {
  imageCache.set(key, { status: 'loaded', image });
}

/**
 * Retrieves a cache entry by assetId or URL.
 *
 * @public
 */
export function getImageCacheEntry(key: string): ImageCacheEntry | undefined {
  return imageCache.get(key);
}

async function loadAndDecodeImage(url: string): Promise<CanvasImageSource> {
  const ImgConstructor =
    typeof Image !== 'undefined'
      ? Image
      : typeof globalThis.Image !== 'undefined'
        ? globalThis.Image
        : undefined;

  if (ImgConstructor) {
    const img = new ImgConstructor();
    img.crossOrigin = 'anonymous';
    const loadedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      let resolved = false;
      const onSuccess = () => {
        if (!resolved) {
          resolved = true;
          resolve(img);
        }
      };
      const onError = (e: unknown) => {
        if (!resolved) {
          resolved = true;
          reject(e);
        }
      };

      img.onload = onSuccess;
      img.onerror = onError;
      img.src = url;

      if (typeof img.decode === 'function') {
        img.decode().then(onSuccess).catch(() => {
          // If decode fails or rejects, let onload / onerror finish
        });
      }
    });

    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(loadedImg);
      } catch {
        // Fall back to HTMLImageElement
      }
    }
    return loadedImg;
  }

  throw new Error('No image decoder available in the current environment');
}

function startAsyncLoad(
  assetId: string,
  url: string,
  entry: ImageCacheEntry,
  ctx?: ElementContext,
): void {
  const promise = (async () => {
    try {
      const img = await loadAndDecodeImage(url);
      entry.status = 'loaded';
      entry.image = img;
      imageCache.set(url, entry);
      ctx?.emit('render');
      return img;
    } catch (err) {
      entry.status = 'error';
      entry.error = err;
      ctx?.emit('render');
      return null;
    }
  })();
  entry.promise = promise;
}

function startAsyncResolve(
  assetId: string,
  urlPromise: PromiseLike<string | null | undefined>,
  entry: ImageCacheEntry,
  ctx?: ElementContext,
): void {
  const promise = (async () => {
    try {
      const rawUrl = await urlPromise;
      if (!rawUrl || typeof rawUrl !== 'string') {
        entry.status = 'error';
        ctx?.emit('render');
        return null;
      }
      const safeUrl = sanitizeImageUrl(rawUrl);
      if (!safeUrl) {
        entry.status = 'error';
        ctx?.emit('render');
        return null;
      }
      const byUrl = imageCache.get(safeUrl);
      if (byUrl?.status === 'loaded' && byUrl.image) {
        entry.status = 'loaded';
        entry.image = byUrl.image;
        ctx?.emit('render');
        return byUrl.image;
      }
      const img = await loadAndDecodeImage(safeUrl);
      entry.status = 'loaded';
      entry.image = img;
      imageCache.set(safeUrl, entry);
      ctx?.emit('render');
      return img;
    } catch (err) {
      entry.status = 'error';
      entry.error = err;
      ctx?.emit('render');
      return null;
    }
  })();
  entry.promise = promise;
}

function resolveAndGetImage(assetId: string, ctx?: ElementContext): ImageCacheEntry {
  if (!assetId) {
    return { status: 'error' };
  }

  const cached = imageCache.get(assetId);
  if (cached) {
    return cached;
  }

  const entry: ImageCacheEntry = { status: 'loading' };
  imageCache.set(assetId, entry);

  let resolved: unknown;
  if (typeof ctx?.assets?.resolve === 'function') {
    try {
      resolved = ctx.assets.resolve(assetId);
    } catch (err) {
      entry.status = 'error';
      entry.error = err;
      return entry;
    }
  } else if (typeof ctx?.getAsset === 'function') {
    const asset = ctx.getAsset(assetId);
    resolved = asset?.meta?.url ?? asset?.meta?.src;
  }

  if (resolved && typeof (resolved as PromiseLike<unknown>).then === 'function') {
    startAsyncResolve(assetId, resolved as PromiseLike<string | null | undefined>, entry, ctx);
    return entry;
  }

  if (typeof resolved === 'string') {
    const safeUrl = sanitizeImageUrl(resolved);
    if (!safeUrl) {
      entry.status = 'error';
      return entry;
    }

    const byUrl = imageCache.get(safeUrl);
    if (byUrl?.status === 'loaded' && byUrl.image) {
      entry.status = 'loaded';
      entry.image = byUrl.image;
      return entry;
    }
    if (byUrl?.status === 'error') {
      entry.status = 'error';
      return entry;
    }

    startAsyncLoad(assetId, safeUrl, entry, ctx);
    return entry;
  }

  entry.status = 'error';
  return entry;
}

/**
 * Image whiteboard element definition (BOARD-1103, BOARD-1906).
 *
 * Renders raster images with optional cropping, upload progress / error placeholders,
 * and full screen-reader accessibility.
 *
 * @public
 */
export const imageElement = defineElement({
  type: 'image',
  version: 1,
  props: imagePropsSchema,
  defaults: {
    assetId: '',
    crop: null,
    alt: '',
  },
  resize: 'fixed-ratio',
  minSize: { w: 16, h: 16 },
  geometry: (el) => rect(el.w, el.h),
  // Quick-connect handles on each side while selected alone.
  connectable: true,
  onDoubleClick: (el, ctx) => {
    ctx.emit('image.crop', { elementId: el.id });
    ctx.emit('edit');
  },
  a11y: (el, _data, ctx) => {
    const alt = el.props.alt?.trim();
    const isEn = ctx.locale === 'en' || ctx.locale?.toLowerCase().startsWith('en');
    return {
      role: 'img',
      label: alt || (isEn ? 'Image' : 'Gambar'),
    };
  },
  export: {
    text: (el) => el.props.alt || '',
  },
  actions: (el, _data, ctx) => {
    const isEn = ctx.locale === 'en' || ctx.locale?.toLowerCase().startsWith('en');
    const actions: (ElementAction & { checked?: boolean })[] = [
      {
        id: 'image.alt',
        group: 'image.alt',
        label: isEn ? 'Alt text' : 'Teks alternatif',
        icon: 'alt',
        run: (arg?: unknown) => {
          const newAlt =
            typeof arg === 'string'
              ? arg
              : typeof (arg as { alt?: unknown })?.alt === 'string'
                ? (arg as { alt: string }).alt
                : undefined;
          if (newAlt !== undefined) {
            if (typeof (ctx as ElementActionContext<ImageProps>).updateProps === 'function') {
              (ctx as ElementActionContext<ImageProps>).updateProps({ alt: newAlt });
            } else if (
              arg &&
              typeof (arg as { update: (id: string, patch: unknown) => void }).update === 'function'
            ) {
              (arg as { update: (id: string, patch: unknown) => void }).update(el.id, {
                props: { ...el.props, alt: newAlt },
              });
            }
          }
          ctx.emit('image.alt', { elementId: el.id, alt: newAlt });
        },
      },
      {
        id: 'image.crop',
        group: 'image.crop',
        label: isEn ? 'Crop image' : 'Potong gambar',
        icon: 'crop',
        run: () => {
          ctx.emit('image.crop', { elementId: el.id });
        },
      },
      {
        id: 'image.resetCrop',
        group: 'image.crop',
        label: isEn ? 'Reset crop' : 'Reset potongan',
        icon: 'reset-crop',
        isActive: () => el.props.crop != null,
        isEnabled: () => el.props.crop != null,
        checked: el.props.crop != null,
        run: (boardArg?: unknown) => {
          if (typeof (ctx as ElementActionContext<ImageProps>).updateProps === 'function') {
            (ctx as ElementActionContext<ImageProps>).updateProps({ crop: null });
          } else if (
            boardArg &&
            typeof (boardArg as { update: (id: string, patch: unknown) => void }).update === 'function'
          ) {
            (boardArg as { update: (id: string, patch: unknown) => void }).update(el.id, {
              props: { ...el.props, crop: null },
            });
          }
        },
      },
      {
        id: 'image.retry',
        group: 'image.retry',
        label: isEn ? 'Retry upload' : 'Coba lagi unggah',
        icon: 'refresh',
        isActive: () => el.props.uploadStatus === 'error',
        isEnabled: () => el.props.uploadStatus === 'error',
        run: () => {
          ctx.emit('image.retry', { elementId: el.id });
        },
      },
    ];

    return actions;
  },
  render: {
    canvas: (g: ElementCanvasContext, el: ElementRecord<ImageProps>, _data, _lod: ElementLodState, ctx?: ElementContext) => {
      const isEn = ctx?.locale === 'en' || ctx?.locale?.toLowerCase().startsWith('en');
      const isDark = ctx?.theme?.mode === 'dark';

      // 1. Uploading state
      if (el.props.uploadStatus === 'uploading') {
        const progress = Math.max(0, Math.min(100, el.props.uploadProgress ?? 0));

        g.save();
        g.fillStyle = isDark ? '#1E293B' : '#F1F5F9';
        g.fillRect(0, 0, el.w, el.h);
        g.lineWidth = 1;
        g.strokeStyle = isDark ? '#334155' : '#CBD5E1';
        g.strokeRect(0, 0, el.w, el.h);

        // Progress bar
        const barWidth = Math.max(20, Math.min(el.w - 40, 160));
        const barHeight = 6;
        const barX = (el.w - barWidth) / 2;
        const barY = el.h / 2 + 10;

        g.fillStyle = isDark ? '#475569' : '#E2E8F0';
        g.fillRect(barX, barY, barWidth, barHeight);

        if (progress > 0) {
          g.fillStyle = '#3B82F6';
          g.fillRect(barX, barY, (barWidth * progress) / 100, barHeight);
        }

        const text = isEn ? 'Uploading...' : 'Mengunggah...';
        g.fillStyle = isDark ? '#94A3B8' : '#64748B';
        g.font = '12px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.fillText(text, el.w / 2, barY - 6);

        g.restore();
        return;
      }

      // 2. Upload error state
      if (el.props.uploadStatus === 'error') {
        g.save();
        g.fillStyle = isDark ? '#2A1215' : '#FEF2F2';
        g.fillRect(0, 0, el.w, el.h);
        g.lineWidth = 1;
        g.strokeStyle = '#EF4444';
        g.strokeRect(0, 0, el.w, el.h);

        const iconSize = Math.min(24, Math.min(el.w, el.h) / 3);
        const centerX = el.w / 2;
        const centerY = el.h / 2 - 10;

        g.fillStyle = '#EF4444';
        g.font = `bold ${Math.max(14, iconSize)}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('!', centerX, centerY);

        const errorMsg = el.props.uploadError || (isEn ? 'Upload failed' : 'Gagal mengunggah');
        const retryMsg = isEn ? 'Retry upload' : 'Coba lagi unggah';

        g.font = '11px sans-serif';
        g.textBaseline = 'top';
        g.fillText(errorMsg, centerX, centerY + iconSize / 2 + 4);
        g.fillStyle = isDark ? '#F87171' : '#DC2626';
        g.fillText(retryMsg, centerX, centerY + iconSize / 2 + 18);

        g.restore();
        return;
      }

      // 3. Resolve and load image from cache
      const entry = resolveAndGetImage(el.props.assetId, ctx);

      // Loading placeholder
      if (entry.status === 'loading') {
        g.save();
        g.fillStyle = isDark ? '#1F2937' : '#F3F4F6';
        g.fillRect(0, 0, el.w, el.h);
        g.lineWidth = 1;
        g.strokeStyle = isDark ? '#374151' : '#E5E7EB';
        g.strokeRect(0, 0, el.w, el.h);

        const centerX = el.w / 2;
        const centerY = el.h / 2;
        g.fillStyle = isDark ? '#6B7280' : '#9CA3AF';
        g.font = '12px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(isEn ? 'Loading...' : 'Memuat...', centerX, centerY);

        g.restore();
        return;
      }

      // Error placeholder (failed to load or unsafe URL)
      if (entry.status === 'error' || !entry.image) {
        g.save();
        g.fillStyle = isDark ? '#18181B' : '#F8FAFC';
        g.fillRect(0, 0, el.w, el.h);
        g.lineWidth = 1;
        g.strokeStyle = isDark ? '#3F3F46' : '#E2E8F0';
        g.strokeRect(0, 0, el.w, el.h);

        const centerX = el.w / 2;
        const centerY = el.h / 2;
        g.fillStyle = '#EF4444';
        g.font = 'bold 16px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('!', centerX, centerY - 8);

        g.fillStyle = isDark ? '#71717A' : '#94A3B8';
        g.font = '11px sans-serif';
        g.fillText(isEn ? 'Image unavailable' : 'Gambar tidak tersedia', centerX, centerY + 10);

        g.restore();
        return;
      }

      // 4. Loaded image rendering
      if (typeof g.drawImage === 'function') {
        const img = entry.image;
        g.save();

        // Clip with subtle rounded corners (4px radius)
        if (typeof (g as unknown as { roundRect?: unknown }).roundRect === 'function') {
          g.beginPath();
          (
            g as unknown as {
              roundRect: (x: number, y: number, w: number, h: number, r: number) => void;
            }
          ).roundRect(0, 0, el.w, el.h, 4);
          g.clip();
        } else if (typeof g.moveTo === 'function') {
          traceRoundedRect(g, el.w, el.h, 4);
          g.clip();
        }

        const crop = el.props.crop;
        const imgW =
          (img as { naturalWidth?: number; width?: number }).naturalWidth ||
          (img as { width: number }).width ||
          el.w;
        const imgH =
          (img as { naturalHeight?: number; height?: number }).naturalHeight ||
          (img as { height: number }).height ||
          el.h;

        if (crop) {
          const sx = crop.x * imgW;
          const sy = crop.y * imgH;
          const sw = crop.w * imgW;
          const sh = crop.h * imgH;
          g.drawImage(img as object, sx, sy, sw, sh, 0, 0, el.w, el.h);
        } else {
          g.drawImage(img as object, 0, 0, el.w, el.h);
        }

        g.restore();
      }
    },
  },
});
