/**
 * `Path2D` cache for finished freehand strokes (BOARD-807).
 *
 * Computing a perfect-freehand outline and tracing hundreds of curves on every frame is the main
 * cost of panning a board full of strokes. Finished strokes are immutable until their props
 * change, so their outline is traced once into a `Path2D` (in element-local coordinates) and
 * filled directly on later frames. Moving an element keeps its `props` object, so a pan or drag
 * reuses the cached path.
 *
 * The outline is simplified per zoom level (powers of two below 100%), so zoomed-out boards trace
 * far fewer segments; crossing a level rebuilds the path on the next draw. The cache is bounded
 * and evicts the least recently drawn strokes first: elements far outside the viewport are culled
 * by the renderer, stop being drawn, and are dropped when the cache fills.
 */

import type { ElementCanvasContext } from '@kujam/core';
import {
  renderStrokeOutline,
  simplifyPoints,
  traceStrokeOutline,
  type StrokeOutline,
} from './stroke-utils.js';

/** Screen-space error allowed when simplifying an outline, in CSS pixels. */
const OUTLINE_TOLERANCE_PX = 0.5;

/** Highest simplification level (zoom 1/256 and below). */
const MAX_DETAIL_LEVEL = 8;

/**
 * Maximum number of cached stroke paths per cache before the least recently drawn are evicted.
 *
 * @internal
 */
export const STROKE_CACHE_LIMIT = 4096;

/**
 * Simplification level for a zoom: `0` (full detail) at 50% and above, then one level per halving.
 * Level `n` keeps the on-screen error under {@link OUTLINE_TOLERANCE_PX} for every zoom up to
 * `2^-n`.
 *
 * @internal
 */
export function detailLevel(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) return 0;
  const level = Math.floor(Math.log2(1 / zoom));
  return Math.max(0, Math.min(MAX_DETAIL_LEVEL, level));
}

/**
 * Outline simplified for a detail level; level 0 returns the outline unchanged.
 *
 * @internal
 */
export function simplifyOutline(outline: StrokeOutline, level: number): StrokeOutline {
  if (level <= 0 || outline.length <= 8) return outline;
  const simplified = simplifyPoints(outline, OUTLINE_TOLERANCE_PX * 2 ** level);
  // A closed outline needs at least a triangle to keep its area.
  return simplified.length >= 3 ? simplified : outline;
}

type Path2DConstructor = new () => Path2D;

/** Context that can fill a `Path2D`; `ElementCanvasContext` itself has no such overload. */
interface PathFillContext {
  readonly canvas?: { readonly ownerDocument?: Document | null };
  fill(path: Path2D, fillRule?: CanvasFillRule): void;
}

/**
 * The `Path2D` constructor of the context's own window, or `null` when the context is not a real
 * Canvas 2D context (export or test contexts). A path from another window cannot be filled.
 */
function path2DFor(g: ElementCanvasContext): Path2DConstructor | null {
  const view = (g as unknown as PathFillContext).canvas?.ownerDocument?.defaultView as
    (Window & typeof globalThis) | null | undefined;
  const Ctor = view?.Path2D;
  const Ctx = view?.CanvasRenderingContext2D;
  if (typeof Ctor !== 'function' || typeof Ctx !== 'function' || !(g instanceof Ctx)) return null;
  return Ctor;
}

/**
 * Compares by identity, then by content for arrays (point lists). The store clones a record on
 * every update, so a moved stroke has new but equal `points`; comparing numbers is far cheaper
 * than rebuilding the outline.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
  return true;
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
  return true;
}

interface CacheEntry {
  deps: readonly unknown[];
  readonly level: number;
  readonly Path: Path2DConstructor;
  readonly path: Path2D;
  lastUse: number;
}

/**
 * Bounded cache of stroke `Path2D` objects keyed by element ID (BOARD-807).
 *
 * @internal
 */
export class StrokePathCache {
  private readonly entries = new Map<string, CacheEntry>();
  private clock = 0;

  constructor(private readonly limit = STROKE_CACHE_LIMIT) {}

  /** Number of cached paths. */
  get size(): number {
    return this.entries.size;
  }

  /** Removes every cached path. */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Fills the stroke outline on `g`, from the cached `Path2D` when it is still valid.
   *
   * @param id Element ID.
   * @param deps Inputs of the outline (points, thickness, resolved brush). Compared one by one with
   *   `===`, and arrays by content.
   * @param zoom Current camera zoom, for the simplification level.
   * @param build Computes the full-detail outline on a cache miss.
   */
  fill(
    g: ElementCanvasContext,
    id: string,
    deps: readonly unknown[],
    zoom: number,
    build: () => StrokeOutline,
  ): void {
    const Path = path2DFor(g);
    if (!Path) {
      // No `Path2D` for this context: trace directly, as before caching.
      renderStrokeOutline(g, build());
      return;
    }

    const level = detailLevel(zoom);
    let entry = this.entries.get(id);
    if (!entry || entry.level !== level || entry.Path !== Path || !sameDeps(entry.deps, deps)) {
      const outline = build();
      if (outline.length === 0) {
        this.entries.delete(id);
        return;
      }
      const path = new Path();
      traceStrokeOutline(path, simplifyOutline(outline, level));
      entry = { deps, level, Path, path, lastUse: ++this.clock };
      this.entries.set(id, entry);
      if (this.entries.size > this.limit) this.evict();
    }
    // Keep the newest identities so the next draw hits the `===` fast path.
    entry.deps = deps;
    entry.lastUse = ++this.clock;
    (g as unknown as PathFillContext).fill(entry.path);
  }

  /** Drops the least recently drawn quarter of the entries. */
  private evict(): void {
    const byAge = [...this.entries].sort((a, b) => a[1].lastUse - b[1].lastUse);
    const drop = Math.max(1, Math.floor(this.entries.size / 4));
    for (let i = 0; i < drop; i++) this.entries.delete(byAge[i]![0]);
  }
}
