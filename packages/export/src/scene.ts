/**
 * What to export: element selection, paint order, frame clipping, bounds, and external data
 * (BOARD-1702, BOARD-1703, BOARD-1708).
 *
 * @internal
 */

import {
  compareIndex,
  computeElementAABB,
  type AnyElementDefinition,
  type Board,
  type BoardDocument,
  type ElementRecord,
} from '@kujam/core';
import { ExportError, type ExportWarning } from './errors.js';

/**
 * Types of the built-in elements of `@kujam/shapes`. Their `render.canvas` only uses the
 * documented drawing context, so it is recorded as vector SVG (`@kujam/export` may not import
 * `@kujam/shapes`, so they are known by type name).
 */
export const BUILTIN_VECTOR_TYPES: ReadonlySet<string> = new Set([
  'sticky',
  'text',
  'geo',
  'draw',
  'line',
  'connector',
  'frame',
  'group',
  'image',
]);

/** Board units above a frame taken by its title label, drawn outside the frame box. */
const FRAME_TITLE_SPACE = 28;

/** Axis-aligned bounds in board units. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Scope options shared by the image exports. */
export interface SceneOptions {
  readonly ids?: readonly string[];
  readonly frameId?: string;
  readonly pageId?: string;
  readonly padding?: number;
}

/** Elements to draw, in paint order, with the region to export. */
export interface Scene {
  readonly elements: readonly ElementRecord[];
  /** Exported region in board units, padding included. */
  readonly bounds: Bounds;
  /** Frame cropped to with `frameId`, or `null`. */
  readonly frame: ElementRecord | null;
  /** Nearest clipping frame per element ID (BOARD-1105). */
  readonly clipFrames: ReadonlyMap<string, ElementRecord>;
}

function childrenByParent(elements: readonly ElementRecord[]): Map<string, ElementRecord[]> {
  const map = new Map<string, ElementRecord[]>();
  for (const el of elements) {
    if (el.parentId === null) continue;
    const list = map.get(el.parentId);
    if (list) list.push(el);
    else map.set(el.parentId, [el]);
  }
  return map;
}

/** The given elements plus all their descendants (frame and group children). */
function withDescendants(
  roots: readonly ElementRecord[],
  all: readonly ElementRecord[],
): ElementRecord[] {
  const byParent = childrenByParent(all);
  const out = new Map<string, ElementRecord>();
  const stack = [...roots];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (out.has(el.id)) continue;
    out.set(el.id, el);
    for (const child of byParent.get(el.id) ?? []) stack.push(child);
  }
  return [...out.values()];
}

/** Paint key: layer indexes from the outermost container down to the element. */
function paintKey(doc: Readonly<BoardDocument>, element: ElementRecord): string[] {
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

/** Sorts elements the way the canvas renderer paints them: containers before their children. */
export function sortPaintOrder(
  doc: Readonly<BoardDocument>,
  elements: readonly ElementRecord[],
): ElementRecord[] {
  const keys = new Map(elements.map((el) => [el.id, paintKey(doc, el)] as const));
  return [...elements].sort((a, b) => {
    const ka = keys.get(a.id)!;
    const kb = keys.get(b.id)!;
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
      const c = compareIndex(ka[i]!, kb[i]!);
      if (c !== 0) return c;
    }
    return ka.length - kb.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** Element bounds in board units, from its geometry (rotation included). */
export function elementBounds(board: Board, el: ElementRecord): Bounds {
  const def = board.elements.get(el.type);
  try {
    const box = computeElementAABB(
      el,
      def?.geometry ? () => def.geometry!(el as never) : undefined,
    );
    return { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY };
  } catch {
    return { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h };
  }
}

function nearestClipFrame(
  doc: Readonly<BoardDocument>,
  el: ElementRecord,
): ElementRecord | undefined {
  const seen = new Set<string>();
  let parentId = el.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = doc.records[parentId];
    if (!parent || parent.kind !== 'element') return undefined;
    if (parent.type === 'frame' && (parent.props as { clip?: unknown }).clip !== false) {
      return parent;
    }
    parentId = parent.parentId;
  }
  return undefined;
}

function checkPadding(padding: unknown): number | undefined {
  if (padding === undefined) return undefined;
  if (typeof padding !== 'number' || !Number.isFinite(padding) || padding < 0) {
    throw new ExportError('invalid-options', 'Opsi padding wajib berupa angka berhingga >= 0.');
  }
  return padding;
}

/**
 * Builds the scene for the whole page, a selection (`ids`, with descendants), or one frame
 * (`frameId`: the frame and its content, cropped to the frame).
 *
 * @throws {@link ExportError} `frame-not-found`, `nothing-to-export`, or `invalid-options`.
 */
export function buildScene(board: Board, options: SceneOptions, defaultPadding = 16): Scene {
  const padding = checkPadding(options.padding);
  const doc = board.getDocument();
  if (options.ids !== undefined) {
    if (!Array.isArray(options.ids) || options.ids.some((id) => typeof id !== 'string')) {
      throw new ExportError('invalid-options', 'Opsi ids wajib berupa array ID string.');
    }
  }
  let frame: ElementRecord | null = null;
  let pageId = options.pageId;
  if (options.frameId !== undefined) {
    const rec = doc.records[options.frameId];
    if (!rec || rec.kind !== 'element' || rec.type !== 'frame') {
      throw new ExportError(
        'frame-not-found',
        `Frame "${String(options.frameId)}" tidak ditemukan.`,
      );
    }
    frame = rec;
    pageId = rec.pageId;
  }

  let selected: ElementRecord[] | null = null;
  if (!frame && options.ids !== undefined) {
    selected = [];
    for (const id of new Set(options.ids)) {
      const rec = doc.records[id];
      if (rec?.kind === 'element') selected.push(rec);
    }
    if (pageId === undefined && selected.length > 0) {
      // Elements of one page are exported: the current page when the selection is on it,
      // otherwise the page of the first element.
      const current = board.pages.current;
      pageId = selected.some((e) => e.pageId === current) ? current : selected[0]!.pageId;
    }
    selected = selected.filter((e) => pageId === undefined || e.pageId === pageId);
  }

  const all = board.query(pageId !== undefined ? { pageId } : undefined) as ElementRecord[];
  const roots = frame ? [frame] : (selected ?? all);
  const elements = withDescendants(roots, all);
  return finishScene(board, doc, elements, frame, padding ?? (frame ? 0 : defaultPadding));
}

function finishScene(
  board: Board,
  doc: Readonly<BoardDocument>,
  elements: ElementRecord[],
  frame: ElementRecord | null,
  padding: number,
): Scene {
  if (elements.length === 0) {
    throw new ExportError('nothing-to-export', 'Tidak ada elemen untuk diekspor.');
  }
  const ordered = sortPaintOrder(doc, elements);
  const clipFrames = new Map<string, ElementRecord>();
  for (const el of ordered) {
    const clip = nearestClipFrame(doc, el);
    if (clip) clipFrames.set(el.id, clip);
  }

  let bounds: Bounds;
  if (frame) {
    bounds = { minX: frame.x, minY: frame.y, maxX: frame.x + frame.w, maxY: frame.y + frame.h };
  } else {
    bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const el of ordered) {
      let box = elementBounds(board, el);
      const clip = clipFrames.get(el.id);
      if (clip) {
        box = {
          minX: Math.max(box.minX, clip.x),
          minY: Math.max(box.minY, clip.y),
          maxX: Math.min(box.maxX, clip.x + clip.w),
          maxY: Math.min(box.maxY, clip.y + clip.h),
        };
        if (box.minX > box.maxX || box.minY > box.maxY) continue;
      }
      if (el.type === 'frame') box = { ...box, minY: box.minY - FRAME_TITLE_SPACE };
      bounds.minX = Math.min(bounds.minX, box.minX);
      bounds.minY = Math.min(bounds.minY, box.minY);
      bounds.maxX = Math.max(bounds.maxX, box.maxX);
      bounds.maxY = Math.max(bounds.maxY, box.maxY);
    }
    if (!Number.isFinite(bounds.minX)) {
      throw new ExportError('nothing-to-export', 'Tidak ada elemen yang terlihat untuk diekspor.');
    }
  }
  bounds = {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: Math.max(bounds.maxX + padding, bounds.minX - padding + 1),
    maxY: Math.max(bounds.maxY + padding, bounds.minY - padding + 1),
  };
  return { elements: ordered, bounds, frame, clipFrames };
}

// ---------- External data (BOARD-604) ----------

/** Resolved state of an element's external data at export time. */
export type ExportData =
  | { readonly status: 'ready'; readonly data: unknown }
  | { readonly status: 'loading' | 'forbidden' | 'not-found' | 'error' };

/**
 * Starts the resolvers of elements with `resolve` and waits (up to `timeoutMs`) until none is
 * loading. Elements still loading after the timeout are exported with a placeholder.
 */
export async function loadSceneData(
  board: Board,
  elements: readonly ElementRecord[],
  timeoutMs: number,
): Promise<Map<string, ExportData>> {
  const out = new Map<string, ExportData>();
  const pending = new Set<string>();
  const read = (id: string): ExportData => {
    try {
      const state = board.getElementData(id);
      return state.status === 'ready'
        ? { status: 'ready', data: state.data }
        : { status: state.status };
    } catch {
      return { status: 'error' };
    }
  };
  for (const el of elements) {
    if (!board.elements.get(el.type)?.resolve) continue;
    const state = read(el.id);
    out.set(el.id, state);
    if (state.status === 'loading') pending.add(el.id);
  }
  if (pending.size === 0 || timeoutMs <= 0) return out;

  await new Promise<void>((resolve) => {
    let off: () => void = () => {};
    const timer = setTimeout(() => {
      off();
      resolve();
    }, timeoutMs);
    off = board.on('data', (event) => {
      for (const id of event.ids) {
        if (!pending.has(id)) continue;
        const state = read(id);
        out.set(id, state);
        if (state.status !== 'loading') pending.delete(id);
      }
      if (pending.size === 0) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
  return out;
}

/** How an element is exported. */
export type ElementMode =
  'vector' | 'svg' | 'raster' | 'image' | 'html-only' | 'unknown' | 'data-placeholder';

/** Decides how to draw `el` from its definition and data state. */
export function elementMode(
  el: ElementRecord,
  def: AnyElementDefinition | undefined,
  data: ExportData | undefined,
  vectorizeCustom: boolean,
): ElementMode {
  if (!def) return 'unknown';
  if (data && data.status !== 'ready') return 'data-placeholder';
  if (el.type === 'image' && typeof (el.props as { assetId?: unknown }).assetId === 'string') {
    const status = (el.props as { uploadStatus?: unknown }).uploadStatus;
    if (status !== 'uploading' && status !== 'error') return 'image';
  }
  const builtIn = BUILTIN_VECTOR_TYPES.has(el.type);
  if (!builtIn && typeof def.export?.svg === 'function') return 'svg';
  if (typeof def.render?.canvas === 'function') {
    return builtIn || vectorizeCustom ? 'vector' : 'raster';
  }
  return 'html-only';
}

/** Adds a warning unless the same code was already reported for the same element. */
export function pushWarning(warnings: ExportWarning[], warning: ExportWarning): void {
  if (warnings.some((w) => w.code === warning.code && w.elementId === warning.elementId)) return;
  warnings.push(warning);
}
