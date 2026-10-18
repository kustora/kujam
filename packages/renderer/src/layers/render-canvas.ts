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

/**
 * Draws a single element with local translation, rotation, opacity, and LOD settings.
 */
function drawSingleElement(
  ctx: CanvasRenderingContext2D,
  el: ElementRecord,
  board: Board,
  camera: CameraState,
): void {
  const def = board.elements.get(el.type);
  if (!def?.render?.canvas) return;

  const lod: ElementLodState = {
    zoom: camera.zoom,
    compact: Boolean(def.lod && camera.zoom < def.lod.compactBelowZoom),
  };

  ctx.save();
  ctx.translate(el.x, el.y);
  if (el.rotation) {
    ctx.rotate((el.rotation * Math.PI) / 180);
  }
  if (el.opacity !== undefined && el.opacity < 1) {
    ctx.globalAlpha *= Math.max(0, Math.min(1, el.opacity));
  }
  try {
    def.render.canvas(ctx, el, undefined, lod, board.elementContext);
  } finally {
    ctx.restore();
  }
}

/**
 * Canvas 2D render pipeline controller for board elements (BOARD-802).
 *
 * @internal
 */
export class CanvasRenderer {
  private dirtyAll = true;
  private dirtyRects: BoxBounds[] = [];
  private frameCount = 0;
  private lastStats: RenderStats = Object.freeze({
    frameCount: 0,
    drawnElements: 0,
    dirtyRects: Object.freeze([]),
    fullRedraw: false,
  });

  private readonly backgroundPainter = new BackgroundPainter();

  /** Background pattern painted under the elements (BOARD-1007). */
  background: BoardBackground = 'dots';

  constructor(private readonly board: Board) {}

  /** Marks the entire viewport dirty (e.g. camera move, zoom, page change, resize). */
  markAllDirty(): void {
    this.dirtyAll = true;
    this.dirtyRects.length = 0;
  }

  /**
   * Records dirty regions from a document transaction change event.
   */
  markChange(event: ChangeEvent): void {
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
    canvas: HTMLCanvasElement,
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
        drawSingleElement(ctx, el, this.board, camera);
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
          drawSingleElement(ctx, el, this.board, camera);
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
