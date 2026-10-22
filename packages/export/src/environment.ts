/**
 * Environment access for the exports: canvases, fetching, data URLs, image decoding, and asset
 * URLs (BOARD-1702, BOARD-1703, BOARD-1708). Every DOM API is feature-detected so the SVG and text
 * exports also run in Node and workers.
 */

import { sanitizeUrl, type Board } from '@kujam/core';
import { MAX_DATA_URL_LENGTH } from './svg/xml.js';

/**
 * A 2D canvas the exports draw on, from {@link ExportCanvasFactory}.
 *
 * @beta
 */
export interface ExportCanvasTarget {
  /** 2D context of the canvas (an `OffscreenCanvasRenderingContext2D` works too). */
  readonly context: CanvasRenderingContext2D;
  /** Encodes the canvas, for example as `'image/png'`. */
  toBlob(type: string, quality?: number): Promise<Blob>;
}

/**
 * Creates a canvas of the given pixel size, or returns `null` when none can be made. The default
 * uses `OffscreenCanvas` when available, otherwise `document.createElement('canvas')`.
 *
 * @beta
 */
export type ExportCanvasFactory = (width: number, height: number) => ExportCanvasTarget | null;

/**
 * Fetch function used to read images and fonts for embedding (`fetch`-compatible subset).
 *
 * @beta
 */
export type ExportFetch = (
  url: string,
  init?: { readonly mode?: 'cors'; readonly credentials?: 'same-origin' },
) => Promise<{ readonly ok: boolean; blob(): Promise<Blob> }>;

/** Default {@link ExportCanvasFactory}. */
export function defaultCanvasFactory(width: number, height: number): ExportCanvasTarget | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  try {
    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(w, h);
      const context = canvas.getContext('2d') as unknown as CanvasRenderingContext2D | null;
      if (context) {
        return { context, toBlob: (type, quality) => canvas.convertToBlob({ type, quality }) };
      }
    }
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d');
      if (context) {
        return {
          context,
          toBlob: (type, quality) =>
            new Promise<Blob>((resolve, reject) => {
              canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('Canvas gagal dienkode.'))),
                type,
                quality,
              );
            }),
        };
      }
    }
  } catch {
    // Canvas creation can throw for oversized canvases or in restricted environments.
  }
  return null;
}

/** The global `fetch`, when there is one. */
export function defaultFetch(): ExportFetch | undefined {
  return typeof fetch === 'function' ? (url, init) => fetch(url, init) : undefined;
}

/**
 * Fetches `url` with CORS, so the bytes are readable without tainting a canvas. Resolves `null`
 * on any failure (network, CORS, HTTP error).
 */
export async function fetchBlob(
  fetchFn: ExportFetch | undefined,
  url: string,
): Promise<Blob | null> {
  if (!fetchFn) return null;
  try {
    const response = await fetchFn(url, { mode: 'cors', credentials: 'same-origin' });
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

/** Encodes bytes as base64 without the DOM (`btoa` exists in browsers and Node 16+). */
export function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** `data:` URL of a blob, with `fallbackType` when the blob has no type. */
export async function blobToDataUrl(
  blob: Blob,
  fallbackType = 'application/octet-stream',
): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(blob.type) ? blob.type : fallbackType;
  return `data:${type};base64,${base64(bytes)}`;
}

/** Raster image types that may be embedded (SVG images can carry script and are excluded). */
const RASTER_TYPES = /^image\/(?:png|jpeg|gif|webp|avif)$/;

/** Whether a fetched blob is a raster image that may be embedded. */
export function isRasterImage(blob: Blob): boolean {
  return RASTER_TYPES.test(blob.type);
}

/** Decodes an image blob into something `drawImage` accepts, or `null`. */
export async function decodeImage(blob: Blob): Promise<CanvasImageSource | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to an <img> (for example SVG, which createImageBitmap may reject).
    }
  }
  return loadImageElement(blob);
}

/** Longest wait for an `<img>` to load before giving up, in milliseconds. */
export const IMAGE_LOAD_TIMEOUT_MS = 10_000;

/** Loads a blob into an `<img>` through an object URL, or `null` without the DOM. */
export async function loadImageElement(
  blob: Blob,
  timeoutMs = IMAGE_LOAD_TIMEOUT_MS,
): Promise<CanvasImageSource | null> {
  if (typeof Image !== 'function' || typeof URL?.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(blob);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      // Some environments never fire either event; never wait forever.
      timer = setTimeout(() => reject(new Error('Gambar tidak selesai dimuat.')), timeoutMs);
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Gambar gagal dimuat.'));
      img.src = url;
    });
    return img;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    // The decoded image stays usable after its object URL is revoked.
    URL.revokeObjectURL(url);
  }
}

const ASSET_SCHEMES = ['https:', 'http:', 'blob:', 'data:'];

/**
 * URL of an asset through the board's `AssetAdapter` (BOARD-1103), falling back to the asset
 * record's `meta.url` / `meta.src`, sanitized like the image element does. `null` when unknown
 * or unsafe.
 */
export async function resolveAssetUrl(board: Board, assetId: string): Promise<string | null> {
  if (!assetId) return null;
  let raw: unknown;
  try {
    if (board.assets) raw = await board.assets.resolve(assetId);
  } catch {
    raw = undefined;
  }
  if (typeof raw !== 'string' || raw === '') {
    const rec = board.getDocument().records[assetId];
    if (rec?.kind === 'asset') raw = rec.meta?.url ?? rec.meta?.src;
  }
  return sanitizeUrl(raw, ASSET_SCHEMES, { maxLength: MAX_DATA_URL_LENGTH });
}

/** Text measurement from a shared 2D context, or `undefined` without a canvas. */
export function createTextMeasurer(): ((text: string, font: string) => number) | undefined {
  const target = defaultCanvasFactory(1, 1);
  const ctx = target?.context;
  if (!ctx || typeof ctx.measureText !== 'function') return undefined;
  return (text, font) => {
    ctx.font = font;
    const width = ctx.measureText(text)?.width;
    return typeof width === 'number' && Number.isFinite(width) ? width : NaN;
  };
}
