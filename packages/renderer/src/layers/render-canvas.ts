/**
 * Canvas 2D element renderer with dirty rects, spatial culling, and frame hierarchy (BOARD-802).
 */

import type {
  Board,
  BoardDocument,
  BoxBounds,
  CameraState,
  ChangeEvent,
  ElementLodState,
  ElementRecord,
} from '@kujam/core';
import { compareIndex, computeElementAABB } from '@kujam/core';
import { BackgroundPainter, type BoardBackground } from './background.js';
import { LodManager } from './lod.js';
import { createDrawingContext, ThumbnailCache } from './thumbnail-cache.js';

/**
 * Statistics for the last rendered canvas frame (BOARD-802).
 *
 * @public
 */
export interface RenderStats {
  /** Sequential frame number rendered since mount. */
  readonly frameCount: number;
  /** Number of elements drawn in the last frame. */
  readonly drawnElements: number;
  /** Dirty bounds that were refreshed in the last frame (empty on full redraw or idle). */
  readonly dirtyRects: readonly BoxBounds[];
  /** Whether the last frame was a full redraw (e.g. camera move, zoom, page switch). */
  readonly fullRedraw: boolean;
}

/**
 * Derives a hierarchical paint key for an element, ascending through its parent hierarchy.
 * Containers always precede their children, and siblings are sorted by fractional index.
 *
 * @internal
 */
export function paintKey(doc: Readonly<BoardDocument>, element: ElementRecord): string[] {
  const key = [element.index];
  const seen = new Set<string>([element.id]);
  let parentId = element.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = doc.records[parentId];
    if (!parent || parent.kind !== 'element') break;
    seen.add(parentId);
    key.unshift(parent.index);
    parentId = parent.parentId;
  }
  return key;
}

/**
 * Compares two elements according to frame hierarchy and fractional indexing (BOARD-802).
 *
 * @internal
 */
export function comparePaintOrder(
  doc: Readonly<BoardDocument>,
  a: ElementRecord,
  b: ElementRecord,
): number {
  const keyA = paintKey(doc, a);
  const keyB = paintKey(doc, b);
  for (let i = 0; i < Math.min(keyA.length, keyB.length); i++) {
    const c = compareIndex(keyA[i]!, keyB[i]!);
    if (c !== 0) return c;
  }
  if (keyA.length !== keyB.length) return keyA.length - keyB.length;
  return a.id.localeCompare(b.id);
}

/**
 * Clamps bounds `b` to the container bounds `viewport`. Returns `null` if disjoint.
 *
 * @internal
 */
export function clampToBounds(b: BoxBounds, viewport: BoxBounds): BoxBounds | null {
  const minX = Math.max(b.minX, viewport.minX);
  const minY = Math.max(b.minY, viewport.minY);
  const maxX = Math.min(b.maxX, viewport.maxX);
  const maxY = Math.min(b.maxY, viewport.maxY);
  if (minX >= maxX || minY >= maxY) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Merges overlapping or adjacent bounding boxes into a minimal list of disjoint boxes.
 *
 * @internal
 */
export function mergeOverlappingBounds(rects: readonly BoxBounds[]): BoxBounds[] {
  if (rects.length <= 1) return [...rects];
  const merged: BoxBounds[] = [];
  const remaining = [...rects];

  while (remaining.length > 0) {
    let current = remaining.pop()!;
    let mergedAny = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const other = remaining[i]!;
      if (
        current.minX <= other.maxX &&
        current.maxX >= other.minX &&
        current.minY <= other.maxY &&
        current.maxY >= other.minY
      ) {
        current = {
          minX: Math.min(current.minX, other.minX),
          minY: Math.min(current.minY, other.minY),
          maxX: Math.max(current.maxX, other.maxX),
          maxY: Math.max(current.maxY, other.maxY),
        };
        remaining.splice(i, 1);
        mergedAny = true;
      }
    }
    if (mergedAny) {
      remaining.push(current);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/**
 * Computes world bounding box for an element including safety padding for anti-aliasing.
 */
function getElementDirtyBounds(board: Board, element: ElementRecord): BoxBounds {
  const def = board.elements.get(element.type);
  const aabb = computeElementAABB(
    element,
    def?.geometry ? () => def.geometry!(element) : undefined,
  );
  const zoom = Math.max(0.01, board.camera.get().zoom);
  const pad = 2 / zoom;
  return {
    minX: aabb.minX - pad,
    minY: aabb.minY - pad,
    maxX: aabb.maxX + pad,
    maxY: aabb.maxY + pad,
  };
}

/** Neutral grey that reads on both light and dark boards (BOARD-209). */
const PLACEHOLDER_FILL = 'rgba(128, 128, 128, 0.12)';
const PLACEHOLDER_STROKE = 'rgba(128, 128, 128, 0.7)';
const PLACEHOLDER_TEXT = 'rgba(128, 128, 128, 0.95)';

/**
 * Draws an element whose type is not registered as a grey box labelled with the type name
 * (BOARD-209), in element-local coordinates.
 *
 * @internal
 */
export function drawUnknownPlaceholder(
  ctx: CanvasRenderingContext2D,
  el: ElementRecord,
  fontFamily: string,
  zoom: number,
): void {
  const w = Math.max(0, el.w);
  const h = Math.max(0, el.h);
  const lineWidth = 1 / Math.max(0.01, zoom);
  ctx.fillStyle = PLACEHOLDER_FILL;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = PLACEHOLDER_STROKE;
  ctx.lineWidth = lineWidth;
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([4 * lineWidth, 4 * lineWidth]);
  ctx.strokeRect(0, 0, w, h);
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);

  // Label in a constant 12 screen pixels, only when it fits.
  const fontSize = 12 * lineWidth;
  const pad = 6 * lineWidth;
  if (w < fontSize * 2 || h < fontSize + pad * 2) return;
  ctx.fillStyle = PLACEHOLDER_TEXT;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(el.type, pad, pad, Math.max(0, w - pad * 2));
}

/** Warning red tint that signals a failed element render (BOARD-810). */
const ERROR_FILL = 'rgba(239, 68, 68, 0.12)';
const ERROR_STROKE = 'rgba(239, 68, 68, 0.8)';
const ERROR_TEXT = '#ef4444';

/**
 * Draws an element that failed to render as a red dashed box labelled with the error
 * (BOARD-810), in element-local coordinates.
 *
 * @internal
 */
export function drawErrorPlaceholder(
  ctx: CanvasRenderingContext2D,
  el: ElementRecord,
  fontFamily: string,
  zoom: number,
): void {
  const w = Math.max(24, el.w || 24);
  const h = Math.max(24, el.h || 24);
  const lineWidth = 1 / Math.max(0.01, zoom);
  ctx.fillStyle = ERROR_FILL;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = ERROR_STROKE;
  ctx.lineWidth = lineWidth;
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([4 * lineWidth, 4 * lineWidth]);
  ctx.strokeRect(0, 0, w, h);
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);

  // Label in a constant 12 screen pixels, only when it fits.
  const fontSize = 12 * lineWidth;
  const pad = 6 * lineWidth;
  if (w < fontSize * 2 || h < fontSize + pad * 2) return;
  ctx.fillStyle = ERROR_TEXT;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`⚠️ ${el.type}`, pad, pad, Math.max(0, w - pad * 2));
}

const DATA_LABELS: Readonly<Record<string, { id: string; en: string }>> = {
  forbidden: { id: 'Tidak punya akses', en: 'No access' },
  'not-found': { id: 'Tidak ditemukan', en: 'Not found' },
  error: { id: 'Gagal memuat', en: 'Could not load' },
};

/**
 * Placeholder of the element's size while its data loads or is unavailable (BOARD-1202): a
 * skeleton, or the element's `placeholder(reason)` label. Never shows resolved data.
 */
function drawDataPlaceholder(
  ctx: CanvasRenderingContext2D,
  el: ElementRecord,
  board: Board,
  status: string,
  def: { placeholder?(reason: never): { label: string } } | undefined,
): void {
  const dark = board.theme.mode === 'dark';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, el.w, el.h, 8);
  else ctx.rect(0, 0, el.w, el.h);
  ctx.fillStyle = dark ? '#2A2D34' : '#ECEAE3';
  ctx.fill();
  let label = '';
  try {
    label = def?.placeholder?.(status as never)?.label || '';
  } catch {
    label = '';
  }
  if (!label && DATA_LABELS[status]) {
    label = board.locale === 'en' ? DATA_LABELS[status]!.en : DATA_LABELS[status]!.id;
  }
  if (!label) return;
  ctx.fillStyle = dark ? '#B4B8C0' : '#4A4F59';
  ctx.font = `12px ${board.theme.typography.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, el.w / 2, el.h / 2, Math.max(0, el.w - 16));
}

/**
 * Draws a single element with local translation, rotation, opacity, and LOD settings.
 */
function drawSingleElement(
  ctx: CanvasRenderingContext2D,
  el: ElementRecord,
  board: Board,
  camera: CameraState,
  erroredElements: Set<string>,
  editingText: ReadonlySet<string>,
  lodManager: LodManager,
  thumbnailCache: ThumbnailCache,
): void {
  const def = board.elements.get(el.type);
  // Registered types without a canvas renderer draw nothing (for example HTML-only elements);
  // unregistered types get a placeholder (BOARD-209).
  const render = def ? def.render?.canvas : undefined;
  if (def && !render) return;

  const isCompact = lodManager.isCompact(el, def, camera.zoom);

  // If the element defines render.html and is not in compact mode,
  // it is rendered in HtmlLayer; skip drawing on canvas to avoid double rendering (BOARD-809).
  if (def?.render?.html && !isCompact) {
    return;
  }

  const lod: ElementLodState = {
    zoom: camera.zoom,
    compact: isCompact,
    ...(editingText.has(el.id) ? { editingText: true } : {}),
  };

  // Find ancestor clipping frame (BOARD-1105)
  let clipFrame: Readonly<ElementRecord> | null = null;
  let curr = el.parentId;
  const visited = new Set<string>();
  while (curr !== null && !visited.has(curr)) {
    visited.add(curr);
    const parent = board.getElement(curr);
    if (!parent) break;
    if (parent.type === 'frame') {
      const clip = (parent.props as { clip?: boolean }).clip !== false;
      if (clip) {
        clipFrame = parent;
        break;
      }
    }
    curr = parent.parentId;
  }

  ctx.save();
  if (clipFrame) {
    ctx.beginPath();
    ctx.rect(clipFrame.x, clipFrame.y, clipFrame.w, clipFrame.h);
    ctx.clip();
  }

  ctx.translate(el.x, el.y);
  if (el.rotation) {
    ctx.rotate((el.rotation * Math.PI) / 180);
  }
  if (el.opacity !== undefined && el.opacity < 1) {
    ctx.globalAlpha *= Math.max(0, Math.min(1, el.opacity));
  }
  try {
    // External data (BOARD-604): drawn only once ready; a placeholder of the same size meanwhile.
    const dataState = def?.resolve ? board.getElementData(el.id) : null;
    if (erroredElements.has(el.id)) {
      drawErrorPlaceholder(ctx, el, board.theme.typography.fontFamily, camera.zoom);
    } else if (dataState && dataState.status !== 'ready') {
      drawDataPlaceholder(ctx, el, board, dataState.status, def);
    } else if (def && render) {
      try {
        const g = createDrawingContext(ctx, thumbnailCache);
        // Called as a method so plugin renderers keep their `this`.
        def.render!.canvas!(
          g,
          el,
          dataState?.status === 'ready' ? dataState.data : undefined,
          lod,
          board.elementContext,
        );
      } catch (error) {
        erroredElements.add(el.id);
        const message = `Kesalahan saat merender elemen "${el.id}" (${el.type}): ${error instanceof Error ? error.message : String(error)}`;
        board.reportError('render-error', message, { elementId: el.id, type: el.type, error });
        drawErrorPlaceholder(ctx, el, board.theme.typography.fontFamily, camera.zoom);
      }
    } else {
      drawUnknownPlaceholder(ctx, el, board.theme.typography.fontFamily, camera.zoom);
    }
  } catch {
    // Fail-safe to guarantee context restore even if placeholder drawing fails
  } finally {
    ctx.restore();
  }
}

/**
 * Canvas 2D render pipeline controller for board elements (BOARD-802).
 *
 * @internal
 */
/**
 * Minimal canvas dimensions supported by canvas rendering (BOARD-1804).
 *
 * @public
 */
export interface CanvasLike {
  readonly width: number;
  readonly height: number;
}

/**
 * Main 2D Canvas renderer responsible for element rendering and spatial queries (BOARD-801, BOARD-1804).
 *
 * @public
 */
export class CanvasRenderer {
  private dirtyAll = true;
  private dirtyRects: BoxBounds[] = [];
  private frameCount = 0;
  private readonly erroredElements = new Set<string>();
  private lastStats: RenderStats = Object.freeze({
    frameCount: 0,
    drawnElements: 0,
    dirtyRects: Object.freeze([]),
    fullRedraw: false,
  });

  private readonly backgroundPainter = new BackgroundPainter();

  /** Background pattern painted under the elements (BOARD-1007). */
  background: BoardBackground = 'dots';

  /** Elements whose inline text editor is open: drawn without their text. */
  private readonly editingText = new Set<string>();

  constructor(
    private readonly board: Board,
    readonly lodManager: LodManager = new LodManager(),
    readonly thumbnailCache: ThumbnailCache = new ThumbnailCache(() => this.markAllDirty()),
  ) {}

  /** Marks whether the inline text editor of `id` is open, and redraws. */
  setEditingText(id: string, editing: boolean): void {
    if (editing === this.editingText.has(id)) return;
    if (editing) this.editingText.add(id);
    else this.editingText.delete(id);
    this.markAllDirty();
  }

  /** Marks the given elements dirty, for example after their data changed (BOARD-1203). */
  markElements(ids: readonly string[]): void {
    if (this.dirtyAll) return;
    const currentPage = this.board.pages.current;
    for (const id of ids) {
      const el = this.board.getElement(id);
      if (el && el.pageId === currentPage) this.dirtyRects.push(getElementDirtyBounds(this.board, el));
    }
  }

  /** Marks the entire viewport dirty (e.g. camera move, zoom, page change, resize). */
  markAllDirty(): void {
    this.dirtyAll = true;
    this.dirtyRects.length = 0;
  }

  /**
   * Records dirty regions from a document transaction change event.
   */
  markChange(event: ChangeEvent): void {
    for (const update of Object.values(event.updated)) {
      this.erroredElements.delete(update.after.id);
    }
    for (const rec of Object.values(event.removed)) {
      this.erroredElements.delete(rec.id);
      this.lodManager.delete(rec.id);
    }

    if (this.dirtyAll) return;

    const currentPage = this.board.pages.current;
    let hasNonElement = false;

    for (const rec of Object.values(event.added)) {
      if (rec.kind !== 'element') {
        hasNonElement = true;
        break;
      }
      if (rec.pageId === currentPage) {
        this.dirtyRects.push(getElementDirtyBounds(this.board, rec));
      }
    }

    if (!hasNonElement) {
      for (const update of Object.values(event.updated)) {
        if (update.before.kind !== 'element' || update.after.kind !== 'element') {
          hasNonElement = true;
          break;
        }
        if (update.before.pageId === currentPage) {
          this.dirtyRects.push(getElementDirtyBounds(this.board, update.before));
        }
        if (update.after.pageId === currentPage) {
          this.dirtyRects.push(getElementDirtyBounds(this.board, update.after));
        }
      }
    }

    if (!hasNonElement) {
      for (const rec of Object.values(event.removed)) {
        if (rec.kind !== 'element') {
          hasNonElement = true;
          break;
        }
        if (rec.pageId === currentPage) {
          this.dirtyRects.push(getElementDirtyBounds(this.board, rec));
        }
      }
    }

    // When changes affect pages/metadata or exceed threshold, fall back to full redraw.
    if (hasNonElement || this.dirtyRects.length > 25) {
      this.dirtyAll = true;
      this.dirtyRects.length = 0;
    }
  }

  /** Returns whether a render is needed. */
  get isDirty(): boolean {
    return this.dirtyAll || this.dirtyRects.length > 0;
  }

  /** Last render stats. */
  get stats(): Readonly<RenderStats> {
    return this.lastStats;
  }

  /**
   * Performs rendering on the canvas 2D context.
   */
  render(
    canvas: CanvasLike,
    ctx: CanvasRenderingContext2D,
    pixelRatio: number,
    debug = false,
  ): RenderStats {
    if (!this.isDirty) {
      return this.lastStats;
    }

    const camera = this.board.camera.get();
    const viewport = this.board.camera.viewport;
    if (viewport.width <= 0 || viewport.height <= 0) {
      if (this.dirtyAll) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.dirtyAll = false;
        this.dirtyRects.length = 0;
      }
      return this.lastStats;
    }

    const viewportBounds = this.board.camera.getViewportBounds();
    const isFull = this.dirtyAll;
    const drawnIds = new Set<string>();
    const scale = camera.zoom * pixelRatio;
    const renderedDirtyRects: BoxBounds[] = [];

    if (isFull) {
      // Full redraw with viewport culling
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.backgroundPainter.paint(
        ctx,
        { x: 0, y: 0, w: canvas.width, h: canvas.height },
        camera,
        pixelRatio,
        this.board.theme.canvas,
        this.background,
      );

      const visible = [...this.board.query({ inBounds: viewportBounds })];
      visible.sort((a, b) => comparePaintOrder(this.board.getDocument(), a, b));

      ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);
      for (const el of visible) {
        drawSingleElement(
          ctx,
          el,
          this.board,
          camera,
          this.erroredElements,
          this.editingText,
          this.lodManager,
          this.thumbnailCache,
        );
        drawnIds.add(el.id);
      }
    } else {
      // Partial redraw: only dirty regions are clipped, cleared, and redrawn
      const clamped = this.dirtyRects
        .map((r) => clampToBounds(r, viewportBounds))
        .filter((r): r is BoxBounds => r !== null);
      const merged = mergeOverlappingBounds(clamped);

      for (const dirty of merged) {
        renderedDirtyRects.push(dirty);
        const p1 = this.board.camera.boardToScreen({ x: dirty.minX, y: dirty.minY });
        const p2 = this.board.camera.boardToScreen({ x: dirty.maxX, y: dirty.maxY });
        const screenMinX = Math.floor(Math.min(p1.x, p2.x) * pixelRatio);
        const screenMinY = Math.floor(Math.min(p1.y, p2.y) * pixelRatio);
        const screenMaxX = Math.ceil(Math.max(p1.x, p2.x) * pixelRatio);
        const screenMaxY = Math.ceil(Math.max(p1.y, p2.y) * pixelRatio);
        const w = screenMaxX - screenMinX;
        const h = screenMaxY - screenMinY;
        if (w <= 0 || h <= 0) continue;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(screenMinX, screenMinY, w, h);
        ctx.clip();
        ctx.clearRect(screenMinX, screenMinY, w, h);
        this.backgroundPainter.paint(
          ctx,
          { x: screenMinX, y: screenMinY, w, h },
          camera,
          pixelRatio,
          this.board.theme.canvas,
          this.background,
        );

        const elements = [...this.board.query({ inBounds: dirty })];
        elements.sort((a, b) => comparePaintOrder(this.board.getDocument(), a, b));

        ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);
        for (const el of elements) {
          drawSingleElement(
            ctx,
            el,
            this.board,
            camera,
            this.erroredElements,
            this.editingText,
            this.lodManager,
            this.thumbnailCache,
          );
          drawnIds.add(el.id);
        }
        ctx.restore();
      }
    }

    // Visual debug overlay: highlights dirty regions and element count (BOARD-802)
    if (debug) {
      ctx.save();
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      // Draw dirty rect borders
      if (!isFull && renderedDirtyRects.length > 0) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 1.5;
        if (typeof ctx.setLineDash === 'function') ctx.setLineDash([4, 4]);

        for (const dirty of renderedDirtyRects) {
          const s1 = this.board.camera.boardToScreen({ x: dirty.minX, y: dirty.minY });
          const s2 = this.board.camera.boardToScreen({ x: dirty.maxX, y: dirty.maxY });
          const sx = Math.min(s1.x, s2.x);
          const sy = Math.min(s1.y, s2.y);
          const sw = Math.abs(s2.x - s1.x);
          const sh = Math.abs(s2.y - s1.y);
          ctx.fillRect(sx, sy, sw, sh);
          ctx.strokeRect(sx, sy, sw, sh);
        }
      }

      // Draw debug HUD badge
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(8, 8, 140, 26);
      ctx.fillStyle = '#38bdf8';
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(`Drawn: ${drawnIds.size} (${isFull ? 'full' : 'dirty'})`, 14, 25);
      ctx.restore();
    }

    this.frameCount++;
    this.dirtyAll = false;
    this.dirtyRects.length = 0;

    this.lastStats = Object.freeze({
      frameCount: this.frameCount,
      drawnElements: drawnIds.size,
      dirtyRects: Object.freeze(renderedDirtyRects),
      fullRedraw: isFull,
    });

    return this.lastStats;
  }
}
