/**
 * Node.js thumbnail renderer for `@kujam/server` (BOARD-1804).
 *
 * Generates PNG thumbnails of whiteboard documents on the server using pure canvas abstraction.
 * Compatible with `@napi-rs/canvas` or any custom canvas factory.
 */

import {
  createBoard,
  type AnyPluginDefinition,
  type BoardDocument,
  type ElementRecord,
} from '@kujam/core';
import { updateToDocument } from '@kujam/sync-yjs';
import { CanvasRenderer, LodManager, ThumbnailCache, type CanvasLike } from '@kujam/renderer';

/**
 * Canvas context abstraction supported by Node thumbnail renderer (BOARD-1804).
 *
 * @public
 */
export interface CanvasFactoryResult {
  readonly canvas: CanvasLike & {
    toBuffer?(mimeType?: string): Buffer;
    encode?(format?: string): Promise<Uint8Array> | Uint8Array;
  };
  readonly ctx: any;
}

/**
 * Factory function for creating a canvas instance in Node or browser (BOARD-1804).
 *
 * @public
 */
export type CanvasFactory = (
  width: number,
  height: number,
) => CanvasFactoryResult | Promise<CanvasFactoryResult>;

/**
 * Options for rendering a document thumbnail on the server (BOARD-1804).
 *
 * @public
 */
export interface RenderThumbnailOptions {
  /** Target width of the generated thumbnail image in pixels. Defaults to 400. */
  readonly width?: number;
  /** Target height of the generated thumbnail image in pixels. If omitted, computed from content aspect ratio. */
  readonly height?: number;
  /** Padding around the document elements in pixels. Defaults to 24. */
  readonly padding?: number;
  /** Plugins providing element definitions, brushes, or renderers. */
  readonly plugins?: readonly AnyPluginDefinition[];
  /** Optional custom canvas factory (defaults to dynamically importing `@napi-rs/canvas`). */
  readonly canvasFactory?: CanvasFactory;
  /** Background color for the thumbnail. Defaults to `'#ffffff'`. Set to `false` for transparent. */
  readonly background?: string | false;
  /** Target page ID to render. If omitted, renders elements on the default page. */
  readonly pageId?: string;
}

/**
 * Computes bounding box encompassing all element records on the active page.
 */
function computeDocumentBounds(
  records: Record<string, unknown>,
  pageId?: string,
): { minX: number; minY: number; maxX: number; maxY: number; count: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (const raw of Object.values(records)) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Partial<ElementRecord>;
    if (rec.kind !== 'element') continue;
    if (pageId && rec.pageId && rec.pageId !== pageId) continue;

    const x = typeof rec.x === 'number' && Number.isFinite(rec.x) ? rec.x : 0;
    const y = typeof rec.y === 'number' && Number.isFinite(rec.y) ? rec.y : 0;
    const w = typeof rec.w === 'number' && Number.isFinite(rec.w) ? Math.max(0, rec.w) : 0;
    const h = typeof rec.h === 'number' && Number.isFinite(rec.h) ? Math.max(0, rec.h) : 0;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
    count++;
  }

  if (count === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600, count: 0 };
  }

  return { minX, minY, maxX, maxY, count };
}

/**
 * Default canvas creator using optional `@napi-rs/canvas`.
 * Throws a clear error if `@napi-rs/canvas` is not installed so the caller can fall back to client thumbnails (BOARD-1708).
 */
async function defaultNodeCanvasFactory(width: number, height: number): Promise<CanvasFactoryResult> {
  let napi: any;
  try {
    // Dynamic import to keep native dependencies completely optional
    // @ts-expect-error optional native canvas package
    napi = await import('@napi-rs/canvas');
  } catch {
    throw new Error(
      'Package "@napi-rs/canvas" tidak terpasang. ' +
        'Pasang @napi-rs/canvas untuk menghasilkan thumbnail di server Node, ' +
        'atau gunakan fallback thumbnail di klien (BOARD-1708).',
    );
  }

  const canvas = napi.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

/**
 * Renders a PNG thumbnail of a document snapshot on the server (BOARD-1804).
 *
 * Accepts either a JSON `BoardDocument` or binary Yjs update bytes `Uint8Array`.
 * Supports `@napi-rs/canvas` or any user-supplied `canvasFactory`.
 *
 * @param docOrUpdate - Whiteboard document snapshot as JSON or binary Yjs update.
 * @param options - Configuration for thumbnail dimensions, padding, plugins, and canvas factory.
 * @returns PNG binary buffer as a Uint8Array or Buffer.
 * @throws Error when `@napi-rs/canvas` is not installed and no `canvasFactory` was provided.
 * @public
 */
export async function renderThumbnail(
  docOrUpdate: BoardDocument | Uint8Array,
  options: RenderThumbnailOptions = {},
): Promise<Uint8Array | Buffer> {
  const doc: BoardDocument =
    docOrUpdate instanceof Uint8Array ? updateToDocument(docOrUpdate) : docOrUpdate;

  const targetWidth = Math.max(1, Math.round(options.width ?? 400));
  const padding = Math.max(0, options.padding ?? 24);
  const bg = options.background === undefined ? '#ffffff' : options.background;

  const bounds = computeDocumentBounds(doc.records, options.pageId);
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);

  const aspectRatio = contentHeight / contentWidth;
  const targetHeight =
    options.height !== undefined
      ? Math.max(1, Math.round(options.height))
      : Math.max(1, Math.round(targetWidth * aspectRatio));

  const factory = options.canvasFactory ?? defaultNodeCanvasFactory;
  const { canvas, ctx } = await factory(targetWidth, targetHeight);

  // Clear / fill background
  if (bg !== false && typeof ctx.fillRect === 'function') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  } else if (typeof ctx.clearRect === 'function') {
    ctx.clearRect(0, 0, targetWidth, targetHeight);
  }

  // Calculate scaling and translation to center and fit elements inside thumbnail
  const availableW = Math.max(1, targetWidth - padding * 2);
  const availableH = Math.max(1, targetHeight - padding * 2);
  const scale = Math.min(availableW / contentWidth, availableH / contentHeight);

  const offsetX = padding + (availableW - contentWidth * scale) / 2 - bounds.minX * scale;
  const offsetY = padding + (availableH - contentHeight * scale) / 2 - bounds.minY * scale;

  // Create ephemeral in-memory board for rendering
  const board = createBoard({
    document: doc,
    plugins: options.plugins,
    freezeSnapshots: false,
  });

  try {
    // Set camera to match thumbnail viewport
    board.camera.setViewport({ width: targetWidth, height: targetHeight });
    board.camera.set({
      x: -offsetX / scale,
      y: -offsetY / scale,
      zoom: scale,
    });

    const lodManager = new LodManager();
    const thumbnailCache = new ThumbnailCache();
    const renderer = new CanvasRenderer(board, lodManager, thumbnailCache);

    ctx.save();
    renderer.render(canvas, ctx, 1);
    ctx.restore();

    if (typeof canvas.toBuffer === 'function') {
      return canvas.toBuffer('image/png');
    }
    if (typeof canvas.encode === 'function') {
      return await canvas.encode('png');
    }

    throw new Error('Canvas instance tidak menyediakan method toBuffer() atau encode().');
  } finally {
    board.dispose();
  }
}
