/**
 * SVG export (BOARD-1702, BOARD-1212).
 *
 * The whole page, a selection, or one frame becomes a standalone SVG document:
 *
 * - built-in elements (`@kujam/shapes`) are recorded from their `render.canvas` as vectors, with
 *   text kept as `<text>` (see {@link SvgCanvasContext});
 * - custom elements use `export.svg` (sanitized), or a raster capture of `render.canvas` when they
 *   have none (`customElements: 'vector'` records them as vectors instead);
 * - images are resolved through the board's `AssetAdapter` and embedded as `data:` URLs or
 *   referenced by URL;
 * - fonts are referenced by family name, or declared with `@font-face` (referenced or embedded).
 *
 * All text and attribute values are escaped by the serializer; the output contains no scripts,
 * event handlers, or `foreignObject`.
 */

import {
  sanitizeUrl,
  type AnyElementDefinition,
  type Board,
  type ElementLodState,
  type ElementRecord,
} from '@kujam/core';
import { createDrawingContext, ThumbnailCache } from '@kujam/renderer';
import {
  blobToDataUrl,
  createTextMeasurer,
  decodeImage,
  defaultCanvasFactory,
  defaultFetch,
  fetchBlob,
  isRasterImage,
  resolveAssetUrl,
  type ExportCanvasFactory,
  type ExportFetch,
} from './environment.js';
import { ExportError, type ExportWarning } from './errors.js';
import {
  callCanvasRenderer,
  dataPlaceholderLabel,
  drawImageElement,
  drawPlaceholder,
  placeholderLabel,
  safeA11yLabel,
} from './paint.js';
import {
  buildScene,
  elementMode,
  loadSceneData,
  pushWarning,
  type ElementMode,
  type ExportData,
  type Scene,
} from './scene.js';
import { SvgCanvasContext } from './svg/svg-context.js';
import { el as node, fmt, sanitizeSvgFragment, serializeSvg, type SvgNode } from './svg/xml.js';

/**
 * A font face declared in the exported SVG (`@font-face`).
 *
 * @beta
 */
export interface ExportFontFace {
  /** Font family name, as used by the theme (for example `'Plus Jakarta Sans'`). */
  readonly family: string;
  /** URL of the font file (`https:` or `http:`; `woff2`, `woff`, `ttf`, or `otf`). */
  readonly src: string;
  /** CSS font weight, for example `400` or `'bold'`. Defaults to `normal`. */
  readonly weight?: number | string;
  /** CSS font style. Defaults to `normal`. */
  readonly style?: 'normal' | 'italic' | 'oblique';
}

/**
 * Scope and appearance options shared by the image exports (BOARD-1702, BOARD-1703).
 *
 * @beta
 */
export interface ExportScopeOptions {
  /**
   * Element IDs to export, with their descendants (frame and group children). Unknown IDs are
   * ignored. When omitted (and without `frameId`), the whole page is exported.
   */
  readonly ids?: readonly string[];
  /** Exports one frame and its content, cropped to the frame (like a slide). Wins over `ids`. */
  readonly frameId?: string;
  /** Page to export; defaults to the current page (or the page of `ids` / `frameId`). */
  readonly pageId?: string;
  /** Space around the content in board units. Defaults to `16`, or `0` with `frameId`. */
  readonly padding?: number;
  /**
   * Background: `true` (default) for the theme's canvas background, `false` for transparent, or a
   * CSS color.
   */
  readonly background?: boolean | string;
  /**
   * Milliseconds to wait for elements whose external data is still loading (BOARD-604) before
   * drawing them as placeholders. Defaults to `3000`.
   */
  readonly dataTimeout?: number;
  /** Fetch used to read images and fonts (defaults to the global `fetch`). */
  readonly fetch?: ExportFetch;
  /** Canvas factory for raster work (defaults to `OffscreenCanvas` or a `<canvas>`). */
  readonly createCanvas?: ExportCanvasFactory;
}

/**
 * Options for {@link exportSVG}.
 *
 * @beta
 */
export interface ExportSVGOptions extends ExportScopeOptions {
  /** Multiplies the SVG `width` and `height` (the `viewBox` stays in board units). Defaults to `1`. */
  readonly scale?: number;
  /**
   * `'embed'` (default) inlines images as `data:` URLs so the file is self-contained; `'url'`
   * references them by URL (smaller, but needs the URLs to stay reachable).
   */
  readonly images?: 'embed' | 'url';
  /**
   * `'reference'` (default) names the font families and declares {@link ExportSVGOptions.fontFaces}
   * by URL; `'embed'` inlines those font files as `data:` URLs.
   */
  readonly fonts?: 'reference' | 'embed';
  /** Font faces to declare with `@font-face`. */
  readonly fontFaces?: readonly ExportFontFace[];
  /**
   * How custom elements without `export.svg` are exported: `'raster'` (default) as an image
   * captured from `render.canvas`, or `'vector'` by recording `render.canvas` as SVG.
   */
  readonly customElements?: 'raster' | 'vector';
  /** Pixels per board unit of raster captures. Defaults to `2`. */
  readonly rasterScale?: number;
  /** Accessible title of the document (`<title>`). */
  readonly title?: string;
}

/**
 * Result of {@link exportSVG}.
 *
 * @beta
 */
export interface SvgExportResult {
  readonly format: 'svg';
  readonly mimeType: 'image/svg+xml';
  /** The SVG document. */
  readonly data: string;
  /** Width and height of the document in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly warnings: readonly ExportWarning[];
}

/** Margin, in board units, around custom elements captured as images or fragments. */
export const CAPTURE_MARGIN = 16;

/** Virtual pixel size of an image whose natural size is unknown (crop is normalized). */
const VIRTUAL_IMAGE_SIZE = 1000;

let documentCounter = 0;

/** Image passed to the recording context by URL instead of pixels. */
class HrefImage {
  readonly width = VIRTUAL_IMAGE_SIZE;
  readonly height = VIRTUAL_IMAGE_SIZE;
  constructor(readonly href: string) {}
}

/** Validates the numeric and enum options shared by the image exports. */
export function checkScale(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ExportError(
      'invalid-options',
      `Opsi ${name} wajib berupa angka ${min} sampai ${max}.`,
    );
  }
  return value;
}

/** Resolves the `background` option to a color, or `null` for transparent. */
export function resolveBackground(board: Board, background: unknown): string | null {
  if (background === undefined || background === true) return board.theme.canvas.background;
  if (background === false || background === 'transparent') return null;
  if (
    typeof background !== 'string' ||
    !background.trim() ||
    /url\s*\(|[<>"';{}]/i.test(background)
  ) {
    throw new ExportError(
      'invalid-options',
      'Opsi background wajib berupa boolean atau warna CSS.',
    );
  }
  return background.trim();
}

/** A fresh, collision-free ID prefix for one exported document. */
function newPrefix(): string {
  return `kj${(++documentCounter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Context shared while exporting one document. */
interface Run {
  readonly board: Board;
  readonly scene: Scene;
  readonly data: ReadonlyMap<string, ExportData>;
  readonly warnings: ExportWarning[];
  readonly prefix: string;
  readonly defs: SvgNode[];
  readonly fetch: ExportFetch | undefined;
  readonly createCanvas: ExportCanvasFactory;
  readonly measureText: ((text: string, font: string) => number) | undefined;
  readonly mode: (el: ElementRecord, def: AnyElementDefinition | undefined) => ElementMode;
  /** Bitmaps recorded by `drawImage`, converted to `data:` URLs afterwards. */
  readonly bitmaps: Map<string, object>;
}

/** Image of a built-in image element, ready to draw. */
export interface PreparedImage {
  readonly url: string;
  /** `data:` URL when the image was fetched for embedding. */
  readonly dataUrl?: string;
  /** Decoded pixels (PNG export). */
  readonly image?: CanvasImageSource;
  readonly w: number;
  readonly h: number;
}

/**
 * Resolves (and, when asked, fetches and decodes) the assets of the built-in image elements in
 * parallel. `null` entries could not be used; a warning says why.
 */
export async function prepareImages(
  board: Board,
  elements: readonly ElementRecord[],
  mode: (el: ElementRecord, def: AnyElementDefinition | undefined) => ElementMode,
  options: {
    readonly fetch: ExportFetch | undefined;
    readonly embed: boolean;
    readonly decode: boolean;
  },
  warnings: ExportWarning[],
): Promise<Map<string, PreparedImage | null>> {
  const out = new Map<string, PreparedImage | null>();
  const byUrl = new Map<string, Promise<Blob | null>>();
  await Promise.all(
    elements
      .filter((el) => mode(el, board.elements.get(el.type)) === 'image')
      .map(async (el) => {
        const assetId = (el.props as { assetId: string }).assetId;
        const url = await resolveAssetUrl(board, assetId);
        if (url === null) {
          pushWarning(warnings, {
            code: 'image-unavailable',
            elementId: el.id,
            message: `Aset gambar "${assetId}" tidak dapat di-resolve; diganti placeholder.`,
          });
          out.set(el.id, null);
          return;
        }
        if (!options.embed && !options.decode) {
          out.set(el.id, { url, w: VIRTUAL_IMAGE_SIZE, h: VIRTUAL_IMAGE_SIZE });
          return;
        }
        let pending = byUrl.get(url);
        if (!pending) {
          pending = fetchBlob(options.fetch, url);
          byUrl.set(url, pending);
        }
        const blob = await pending;
        if (!blob || !isRasterImage(blob)) {
          pushWarning(warnings, {
            code: 'image-cors',
            elementId: el.id,
            message: options.decode
              ? `Gambar "${url}" tidak dapat dibaca (CORS atau jaringan); diganti placeholder.`
              : `Gambar "${url}" tidak dapat disematkan (CORS atau jaringan); dirujuk lewat URL.`,
          });
          out.set(
            el.id,
            options.decode ? null : { url, w: VIRTUAL_IMAGE_SIZE, h: VIRTUAL_IMAGE_SIZE },
          );
          return;
        }
        if (options.decode) {
          const image = await decodeImage(blob);
          if (!image) {
            pushWarning(warnings, {
              code: 'image-unavailable',
              elementId: el.id,
              message: `Gambar "${url}" gagal didekode; diganti placeholder.`,
            });
            out.set(el.id, null);
            return;
          }
          const size = image as {
            width?: number;
            height?: number;
            naturalWidth?: number;
            naturalHeight?: number;
          };
          out.set(el.id, {
            url,
            image,
            w: size.naturalWidth || size.width || VIRTUAL_IMAGE_SIZE,
            h: size.naturalHeight || size.height || VIRTUAL_IMAGE_SIZE,
          });
          return;
        }
        out.set(el.id, {
          url,
          dataUrl: await blobToDataUrl(blob),
          w: VIRTUAL_IMAGE_SIZE,
          h: VIRTUAL_IMAGE_SIZE,
        });
      }),
  );
  return out;
}

/**
 * Sanitized `export.svg` fragment of a custom element (BOARD-1212), or `null` (with a warning)
 * when the exporter throws or returns no string.
 */
export function buildFragment(
  board: Board,
  el: ElementRecord,
  def: AnyElementDefinition,
  data: ExportData | undefined,
  idPrefix: string,
  allowRemoteImages: boolean,
  warnings: ExportWarning[],
): (SvgNode | string)[] | null {
  let source: unknown;
  try {
    source = def.export!.svg!(
      el as never,
      (data?.status === 'ready' ? data.data : undefined) as never,
    );
  } catch (error) {
    pushWarning(warnings, {
      code: 'render-error',
      elementId: el.id,
      message: `export.svg elemen "${el.id}" (${el.type}) gagal: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
  if (typeof source !== 'string') {
    pushWarning(warnings, {
      code: 'render-error',
      elementId: el.id,
      message: `export.svg elemen "${el.id}" (${el.type}) tidak mengembalikan string.`,
    });
    return null;
  }
  const result = sanitizeSvgFragment(source, { idPrefix, allowRemoteImages });
  if (result.removed > 0) {
    pushWarning(warnings, {
      code: 'sanitized',
      elementId: el.id,
      message: `${result.removed} bagian tidak aman dihapus dari export.svg elemen "${el.id}" (${el.type}).`,
    });
  }
  return result.nodes;
}

/**
 * Loads the images custom elements draw with `drawThumbnail(url, ...)` into `cache`, read with
 * CORS so drawing them never taints a canvas. Found by a dry run of `render.canvas` on a
 * recording context.
 */
export async function prewarmThumbnails(
  board: Board,
  elements: readonly ElementRecord[],
  data: ReadonlyMap<string, ExportData>,
  compact: boolean,
  cache: ThumbnailCache,
  fetchFn: ExportFetch | undefined,
  warnings: ExportWarning[],
): Promise<void> {
  const urls = new Map<string, string>();
  for (const el of elements) {
    const def = board.elements.get(el.type);
    if (!def?.render?.canvas) continue;
    const g = new SvgCanvasContext({
      idPrefix: 'dry',
      defs: [],
      onImageUrl: (url) => {
        if (!urls.has(url)) urls.set(url, el.id);
      },
    });
    try {
      const d = data.get(el.id);
      callCanvasRenderer(
        def,
        g,
        el,
        d?.status === 'ready' ? d.data : undefined,
        { zoom: 1, compact: compact || typeof def.render.html === 'function' },
        board,
      );
    } catch {
      // Reported when the element is really drawn.
    }
  }
  await Promise.all(
    [...urls].map(async ([url, elementId]) => {
      if (cache.has(url)) return;
      const blob = await fetchBlob(fetchFn, url);
      const image = blob && isRasterImage(blob) ? await decodeImage(blob) : null;
      if (image) cache.set(url, image);
      else {
        pushWarning(warnings, {
          code: 'image-cors',
          elementId,
          message: `Gambar "${url}" tidak dapat dibaca (CORS atau jaringan); tidak digambar.`,
        });
      }
    }),
  );
}

/** Records a placeholder for `el` as SVG nodes. */
function placeholderNodes(
  run: Run,
  el: ElementRecord,
  label: string,
  tone: 'neutral' | 'error',
): SvgNode[] {
  const g = new SvgCanvasContext({
    idPrefix: run.prefix,
    defs: run.defs,
    measureText: run.measureText,
  });
  drawPlaceholder(g, el, label, tone, run.board.theme.typography.fontFamily);
  return g.nodes;
}

/** Records `render.canvas` of `el` as SVG nodes. */
function vectorNodes(run: Run, el: ElementRecord, def: AnyElementDefinition): SvgNode[] {
  const g = new SvgCanvasContext({
    idPrefix: run.prefix,
    defs: run.defs,
    measureText: run.measureText,
    resolveImage: (image) => {
      if (image instanceof HrefImage) return image.href;
      const src =
        (image as { currentSrc?: unknown; src?: unknown }).currentSrc ||
        (image as { src?: unknown }).src;
      if (typeof src === 'string' && src) return src;
      const token = `kujam-bitmap:${run.bitmaps.size + 1}`;
      run.bitmaps.set(token, image);
      return token;
    },
  });
  const data = run.data.get(el.id);
  const lod: ElementLodState = { zoom: 1, compact: typeof def.render?.html === 'function' };
  try {
    callCanvasRenderer(
      def,
      g,
      el,
      data?.status === 'ready' ? data.data : undefined,
      lod,
      run.board,
    );
    return g.nodes;
  } catch (error) {
    pushWarning(run.warnings, {
      code: 'render-error',
      elementId: el.id,
      message: `Elemen "${el.id}" (${el.type}) gagal dirender: ${error instanceof Error ? error.message : String(error)}`,
    });
    return placeholderNodes(run, el, placeholderLabel(run.board, 'failed'), 'error');
  }
}

/** Captures `render.canvas` of a custom element as a PNG `data:` URL, or `null`. */
async function rasterCapture(
  run: Run,
  el: ElementRecord,
  def: AnyElementDefinition,
  rasterScale: number,
  cache: ThumbnailCache,
): Promise<string | null | 'tainted'> {
  const m = CAPTURE_MARGIN;
  const target = run.createCanvas((el.w + m * 2) * rasterScale, (el.h + m * 2) * rasterScale);
  if (!target) return null;
  const ctx = target.context;
  ctx.setTransform(rasterScale, 0, 0, rasterScale, m * rasterScale, m * rasterScale);
  const data = run.data.get(el.id);
  try {
    callCanvasRenderer(
      def,
      createDrawingContext(ctx, cache),
      el,
      data?.status === 'ready' ? data.data : undefined,
      { zoom: rasterScale, compact: typeof def.render?.html === 'function' },
      run.board,
    );
  } catch (error) {
    pushWarning(run.warnings, {
      code: 'render-error',
      elementId: el.id,
      message: `Elemen "${el.id}" (${el.type}) gagal dirender: ${error instanceof Error ? error.message : String(error)}`,
    });
    return 'tainted';
  }
  try {
    return await blobToDataUrl(await target.toBlob('image/png'), 'image/png');
  } catch {
    // SecurityError: the element drew a cross-origin image.
    pushWarning(run.warnings, {
      code: 'tainted',
      elementId: el.id,
      message: `Elemen "${el.id}" (${el.type}) menggambar gambar lintas origin; diganti placeholder.`,
    });
    return 'tainted';
  }
}

/** Converts a bitmap recorded by `drawImage` into a PNG `data:` URL, or `null`. */
async function bitmapToDataUrl(run: Run, image: object): Promise<string | null> {
  const w = (image as { width?: number }).width ?? 0;
  const h = (image as { height?: number }).height ?? 0;
  if (!(w > 0) || !(h > 0)) return null;
  const target = run.createCanvas(w, h);
  if (!target) return null;
  try {
    target.context.drawImage(image as CanvasImageSource, 0, 0);
    return await blobToDataUrl(await target.toBlob('image/png'), 'image/png');
  } catch {
    return null;
  }
}

function walk(nodes: readonly (SvgNode | string)[], fn: (n: SvgNode) => void): void {
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    fn(n);
    walk(n.children, fn);
  }
}

/**
 * Embeds external images left in the tree (custom elements: `drawThumbnail`, `drawImage`, and
 * `export.svg` images) and converts recorded bitmaps. Images that cannot be read keep their URL
 * (`strict: false`) or are hidden (`strict: true`, for PNG rendering), with a warning.
 */
export async function embedRemainingImages(
  nodes: readonly (SvgNode | string)[],
  options: {
    readonly embed: boolean;
    readonly strict: boolean;
    readonly fetch: ExportFetch | undefined;
    readonly bitmaps?: ReadonlyMap<string, object>;
    readonly toDataUrl?: (image: object) => Promise<string | null>;
    /** URLs already reported as not embeddable; left as they are. */
    readonly skip?: ReadonlySet<string>;
  },
  warnings: ExportWarning[],
): Promise<void> {
  const images: SvgNode[] = [];
  walk(nodes, (n) => {
    const href = n.attrs.href;
    if (n.tag === 'image' && href && !href.startsWith('data:') && !options.skip?.has(href)) {
      images.push(n);
    }
  });
  const cache = new Map<string, Promise<string | null>>();
  await Promise.all(
    images.map(async (img) => {
      const href = img.attrs.href!;
      let pending = cache.get(href);
      if (!pending) {
        pending = (async () => {
          const bitmap = options.bitmaps?.get(href);
          if (bitmap) return options.toDataUrl ? options.toDataUrl(bitmap) : null;
          if (!options.embed) return href;
          const blob = await fetchBlob(options.fetch, href);
          return blob && isRasterImage(blob) ? blobToDataUrl(blob) : null;
        })();
        cache.set(href, pending);
      }
      const result = await pending;
      if (result !== null) {
        img.attrs.href = result;
        return;
      }
      const isBitmap = options.bitmaps?.has(href) ?? false;
      if (options.strict || isBitmap) {
        delete img.attrs.href;
        img.attrs.display = 'none';
      }
      pushWarning(warnings, {
        code: 'image-cors',
        message: isBitmap
          ? 'Sebuah gambar bitmap dari elemen kustom tidak dapat disematkan; dilewati.'
          : options.strict
            ? `Gambar "${href}" tidak dapat dibaca (CORS atau jaringan); dilewati.`
            : `Gambar "${href}" tidak dapat disematkan (CORS atau jaringan); dirujuk lewat URL.`,
      });
    }),
  );
}

const FONT_FORMATS: Readonly<Record<string, string>> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
};

/** CSS string literal (double-quoted), safe inside `<style>` and `url("...")`. */
function cssString(value: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are dropped on purpose.
  const visible = value.replace(/[\u0000-\u001f\u007f]/g, '');
  return `"${visible.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `@font-face` rules for `fontFaces`, embedding the files when asked. */
async function fontFaceCss(
  faces: readonly ExportFontFace[],
  embed: boolean,
  fetchFn: ExportFetch | undefined,
  warnings: ExportWarning[],
): Promise<string> {
  const rules = await Promise.all(
    faces.map(async (face) => {
      if (typeof face?.family !== 'string' || !face.family.trim()) return '';
      const url = sanitizeUrl(face.src, ['https:', 'http:']);
      if (url === null) {
        pushWarning(warnings, {
          code: 'font-not-embedded',
          message: `URL font "${String(face.src)}" untuk "${face.family}" tidak aman; dilewati.`,
        });
        return '';
      }
      const ext = /\.(woff2|woff|ttf|otf)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
      let src = url;
      if (embed) {
        const blob = await fetchBlob(fetchFn, url);
        if (blob) {
          src = await blobToDataUrl(blob, ext ? `font/${ext}` : 'font/woff2');
        } else {
          pushWarning(warnings, {
            code: 'font-not-embedded',
            message: `Font "${face.family}" (${url}) tidak dapat disematkan; dirujuk lewat URL.`,
          });
        }
      }
      const weight = String(face.weight ?? 'normal');
      const style = face.style ?? 'normal';
      const safeWeight = /^(?:normal|bold|bolder|lighter|[1-9]00)$/.test(weight)
        ? weight
        : 'normal';
      const safeStyle = /^(?:normal|italic|oblique)$/.test(style) ? style : 'normal';
      const format = ext ? ` format(${cssString(FONT_FORMATS[ext]!)})` : '';
      return `@font-face{font-family:${cssString(face.family.trim())};src:url(${cssString(src)})${format};font-weight:${safeWeight};font-style:${safeStyle};}`;
    }),
  );
  return rules.filter(Boolean).join('');
}

/** Clip path (in board coordinates) for a clipping frame, created once per frame. */
function frameClipId(run: Run, frame: ElementRecord, ids: Map<string, string>): string {
  let id = ids.get(frame.id);
  if (!id) {
    id = `${run.prefix}f${ids.size + 1}`;
    ids.set(frame.id, id);
    run.defs.push(
      node('clipPath', { id }, [
        node('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h }),
      ]),
    );
  }
  return id;
}

/**
 * Exports the board (or a selection, or one frame) as an SVG document (BOARD-1702).
 *
 * Problems with single elements (unreadable images, failing renderers, unsafe `export.svg`
 * content) do not fail the export: a placeholder is drawn and a warning is returned.
 *
 * @throws {@link ExportError} `nothing-to-export`, `frame-not-found`, or `invalid-options`.
 * @beta
 */
export async function exportSVG(
  board: Board,
  options: ExportSVGOptions = {},
): Promise<SvgExportResult> {
  const scale = checkScale(options.scale, 'scale', 0.01, 16, 1);
  const rasterScale = checkScale(options.rasterScale, 'rasterScale', 0.25, 8, 2);
  const dataTimeout = checkScale(options.dataTimeout, 'dataTimeout', 0, 600_000, 3000);
  const background = resolveBackground(board, options.background);
  const embedImages = (options.images ?? 'embed') === 'embed';
  if (options.images !== undefined && options.images !== 'embed' && options.images !== 'url') {
    throw new ExportError('invalid-options', "Opsi images wajib 'embed' atau 'url'.");
  }
  if (options.fonts !== undefined && options.fonts !== 'embed' && options.fonts !== 'reference') {
    throw new ExportError('invalid-options', "Opsi fonts wajib 'reference' atau 'embed'.");
  }
  const vectorizeCustom = options.customElements === 'vector';
  const scene = buildScene(board, options);
  const warnings: ExportWarning[] = [];
  const data = await loadSceneData(board, scene.elements, dataTimeout);
  const mode = (el: ElementRecord, def: AnyElementDefinition | undefined) =>
    elementMode(el, def, data.get(el.id), vectorizeCustom);
  const run: Run = {
    board,
    scene,
    data,
    warnings,
    prefix: newPrefix(),
    defs: [],
    fetch: options.fetch ?? defaultFetch(),
    createCanvas: options.createCanvas ?? defaultCanvasFactory,
    measureText: createTextMeasurer(),
    mode,
    bitmaps: new Map(),
  };
  const svg = await buildSvgDocument(run, {
    scale,
    rasterScale,
    background,
    embedImages,
    strictImages: false,
    fonts: options.fonts ?? 'reference',
    fontFaces: options.fontFaces ?? [],
    title: options.title,
  });
  return { format: 'svg', mimeType: 'image/svg+xml', ...svg, warnings };
}

/** Options of {@link buildSvgDocument}. */
interface DocumentOptions {
  readonly scale: number;
  readonly rasterScale: number;
  readonly background: string | null;
  readonly embedImages: boolean;
  /** Hide images that cannot be embedded instead of referencing them (PNG rendering). */
  readonly strictImages: boolean;
  readonly fonts: 'reference' | 'embed';
  readonly fontFaces: readonly ExportFontFace[];
  readonly title?: string;
}

async function buildSvgDocument(
  run: Run,
  options: DocumentOptions,
): Promise<{ data: string; width: number; height: number }> {
  const { board, scene, warnings } = run;
  const fontFamily = board.theme.typography.fontFamily;
  const images = await prepareImages(
    board,
    scene.elements,
    run.mode,
    { fetch: run.fetch, embed: options.embedImages, decode: false },
    warnings,
  );
  const thumbnails = new ThumbnailCache();
  const rasterElements = scene.elements.filter(
    (el) => run.mode(el, board.elements.get(el.type)) === 'raster',
  );
  if (rasterElements.length > 0) {
    await prewarmThumbnails(
      board,
      rasterElements,
      run.data,
      false,
      thumbnails,
      run.fetch,
      warnings,
    );
  }

  const body: SvgNode[] = [];
  const clipIds = new Map<string, string>();
  let fragmentCount = 0;
  for (const el of scene.elements) {
    const def = board.elements.get(el.type);
    const data = run.data.get(el.id);
    let children: (SvgNode | string)[] = [];
    switch (run.mode(el, def)) {
      case 'unknown':
        pushWarning(warnings, {
          code: 'unknown-type',
          elementId: el.id,
          message: `Tipe elemen "${el.type}" tidak terdaftar; diganti placeholder.`,
        });
        children = placeholderNodes(run, el, el.type, 'neutral');
        break;
      case 'data-placeholder':
        pushWarning(warnings, {
          code: 'data-unavailable',
          elementId: el.id,
          message: `Data elemen "${el.id}" (${el.type}) belum tersedia (${data?.status}); diganti placeholder.`,
        });
        children = placeholderNodes(
          run,
          el,
          dataPlaceholderLabel(board, def, data?.status ?? 'loading'),
          'neutral',
        );
        break;
      case 'html-only':
        pushWarning(warnings, {
          code: 'html-only',
          elementId: el.id,
          message: `Elemen "${el.id}" (${el.type}) hanya punya render.html; diganti placeholder.`,
        });
        children = placeholderNodes(
          run,
          el,
          safeA11yLabel(board, el, def, data) || el.type,
          'neutral',
        );
        break;
      case 'image': {
        const prepared = images.get(el.id);
        if (!prepared) {
          children = placeholderNodes(run, el, placeholderLabel(board, 'image'), 'neutral');
          break;
        }
        const g = new SvgCanvasContext({
          idPrefix: run.prefix,
          defs: run.defs,
          resolveImage: (image) => (image instanceof HrefImage ? image.href : null),
        });
        drawImageElement(g, el, new HrefImage(prepared.dataUrl ?? prepared.url), prepared);
        children = g.nodes;
        break;
      }
      case 'svg': {
        const fragment = buildFragment(
          board,
          el,
          def!,
          data,
          `${run.prefix}e${++fragmentCount}`,
          !options.strictImages,
          warnings,
        );
        children =
          fragment ?? placeholderNodes(run, el, placeholderLabel(board, 'failed'), 'error');
        break;
      }
      case 'raster': {
        const href = await rasterCapture(run, el, def!, options.rasterScale, thumbnails);
        if (href === 'tainted') {
          children = placeholderNodes(
            run,
            el,
            safeA11yLabel(board, el, def, data) || el.type,
            'error',
          );
        } else if (href === null) {
          pushWarning(warnings, {
            code: 'raster-unavailable',
            elementId: el.id,
            message: `Canvas tidak tersedia untuk menangkap elemen "${el.id}" (${el.type}); direkam sebagai vektor.`,
          });
          children = vectorNodes(run, el, def!);
        } else {
          const m = CAPTURE_MARGIN;
          children = [
            node('image', {
              href,
              x: -m,
              y: -m,
              width: el.w + m * 2,
              height: el.h + m * 2,
              preserveAspectRatio: 'none',
            }),
          ];
        }
        break;
      }
      case 'vector':
        children = vectorNodes(run, el, def!);
        break;
    }
    if (children.length === 0) continue;
    const transform = [
      el.x || el.y ? `translate(${fmt(el.x)} ${fmt(el.y)})` : '',
      el.rotation ? `rotate(${fmt(el.rotation)})` : '',
    ]
      .filter(Boolean)
      .join(' ');
    let group = node(
      'g',
      {
        transform: transform || undefined,
        opacity: el.opacity !== undefined && el.opacity < 1 ? Math.max(0, el.opacity) : undefined,
      },
      children,
    );
    const clip = scene.clipFrames.get(el.id);
    if (clip)
      group = node('g', { 'clip-path': `url(#${frameClipId(run, clip, clipIds)})` }, [group]);
    body.push(group);
  }

  const { bounds } = scene;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (scene.frame) {
    // Crop to the frame like a slide: content outside it is not visible.
    const id = frameClipId(run, scene.frame, clipIds);
    body.splice(0, body.length, node('g', { 'clip-path': `url(#${id})` }, [...body]));
  }

  await embedRemainingImages(
    [...body, ...run.defs],
    {
      embed: options.embedImages,
      strict: options.strictImages,
      fetch: run.fetch,
      bitmaps: run.bitmaps,
      toDataUrl: (image) => bitmapToDataUrl(run, image),
      skip: new Set([...images.values()].flatMap((img) => (img && !img.dataUrl ? [img.url] : []))),
    },
    warnings,
  );

  const head: SvgNode[] = [];
  if (options.title) head.push(node('title', {}, [options.title]));
  const css = await fontFaceCss(options.fontFaces, options.fonts === 'embed', run.fetch, warnings);
  if (options.fonts === 'embed' && options.fontFaces.length === 0) {
    pushWarning(warnings, {
      code: 'font-not-embedded',
      message: 'fonts: "embed" tanpa fontFaces; font hanya dirujuk lewat nama keluarga.',
    });
  }
  if (css) head.push(node('style', {}, [css]));
  if (run.defs.length > 0) head.push(node('defs', {}, run.defs));
  if (options.background) {
    head.push(
      node('rect', {
        x: bounds.minX,
        y: bounds.minY,
        width: w,
        height: h,
        fill: options.background,
      }),
    );
  }

  const width = Math.max(1, Math.round(w * options.scale));
  const height = Math.max(1, Math.round(h * options.scale));
  const root = node(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width,
      height,
      viewBox: `${fmt(bounds.minX)} ${fmt(bounds.minY)} ${fmt(w)} ${fmt(h)}`,
      role: 'img',
      'font-family': fontFamily,
    },
    [...head, ...body],
  );
  return { data: serializeSvg(root), width, height };
}
