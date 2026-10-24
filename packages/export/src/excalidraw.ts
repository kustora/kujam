/**
 * Excalidraw JSON import (BOARD-1706).
 *
 * Reads the public `.excalidraw` file format (and the `excalidraw/clipboard` payload) and maps the
 * basic Excalidraw elements to the built-in `@kujam/shapes` elements. Only the format is read; no
 * Excalidraw code is used. The mapping is:
 *
 * | Excalidraw                       | kujam                                                  |
 * | -------------------------------- | ------------------------------------------------------ |
 * | `rectangle`, `ellipse`, `diamond`| `geo` (`rectangle`/`rounded-rectangle`, `ellipse`, `diamond`) |
 * | `text`                           | `text`, or the label of its container shape or arrow  |
 * | `freedraw`                       | `draw` (split into several strokes past the point limit) |
 * | `arrow`                          | `connector` (bindings kept), or `line` for an unbound multi-point arrow |
 * | `line`                           | `line`                                                 |
 * | `image`                          | `image` with an asset whose `meta.url` is the file's data URL |
 * | `frame`, `magicframe`            | `frame`                                                |
 * | `groupIds`                       | nested `group` elements                                |
 *
 * Colors are mapped to the nearest theme color key by hue and lightness, since documents store keys
 * rather than hex. Elements that cannot be mapped are reported in `unsupported`, never dropped
 * silently. Deleted elements (`isDeleted`) are skipped without a report, as they are not part of
 * the drawing.
 */

import {
  CURRENT_SCHEMA_VERSION,
  indicesBetween,
  InvalidDocumentError,
  type AssetRecord,
  type BindingRecord,
  type Board,
  type BoardDocument,
  type BoardRecord,
  type ColorKey,
  type ElementRecord,
  type PageRecord,
} from '@kujam/core';
import { importJSON, type ImportJSONOptions, type ImportResult } from './json.js';

/** Same limits as the `draw` and `line` element schemas of `@kujam/shapes`. */
const MAX_DRAW_POINTS = 5000;
const MAX_LINE_POINTS = 1000;
/** Excalidraw draws freehand strokes with a perfect-freehand size of `strokeWidth * 4.25`. */
const FREEDRAW_SIZE_FACTOR = 4.25;
/** `text` element font sizes of `@kujam/shapes` (`s`, `m`, `l`, `xl`). */
const TEXT_SIZES = [
  ['s', 16],
  ['m', 24],
  ['l', 32],
  ['xl', 48],
] as const;

/**
 * Why an Excalidraw element was not imported.
 *
 * - `unsupported-type`: the element type has no built-in counterpart (for example `embeddable`,
 *   `iframe`, or a type from a newer Excalidraw version).
 * - `invalid`: the element is malformed (missing or non-finite coordinates, missing points).
 * - `empty`: the element has no content to show (a text without characters, a stroke without
 *   points).
 * - `too-many-points`: a line has more points than the `line` element allows.
 *
 * @beta
 */
export type ExcalidrawUnsupportedReason =
  'unsupported-type' | 'invalid' | 'empty' | 'too-many-points';

/**
 * An Excalidraw element that was left out of the import.
 *
 * @beta
 */
export interface ExcalidrawUnsupportedElement {
  /** The Excalidraw element ID (`''` when it has none). */
  readonly id: string;
  /** The Excalidraw element type (`''` when it has none). */
  readonly type: string;
  readonly reason: ExcalidrawUnsupportedReason;
}

/**
 * Options for {@link excalidrawToDocument}.
 *
 * @beta
 */
export interface ExcalidrawToDocumentOptions {
  /** ID generator for the records the conversion creates. Defaults to a counter-based generator. */
  readonly createId?: () => string;
  /** ID of the page the elements are put on. Defaults to a new page. */
  readonly pageId?: string;
  /** Name of the page record. Defaults to `'Excalidraw'`. */
  readonly pageName?: string;
}

/**
 * Result of {@link excalidrawToDocument}.
 *
 * @beta
 */
export interface ExcalidrawConversion {
  /** Board document with the converted elements on one page. */
  readonly document: BoardDocument;
  /** Map from Excalidraw element IDs to the IDs of the elements created for them. */
  readonly idMap: ReadonlyMap<string, string>;
  /** Excalidraw elements that were left out, with the reason. */
  readonly unsupported: readonly ExcalidrawUnsupportedElement[];
}

/**
 * Result of {@link importExcalidraw}: the {@link ImportResult} of the underlying JSON import, plus
 * the Excalidraw elements that were left out. `idMap` maps Excalidraw element IDs to board IDs.
 *
 * @beta
 */
export interface ExcalidrawImportResult extends ImportResult {
  readonly unsupported: readonly ExcalidrawUnsupportedElement[];
}

/** Loose shape of an Excalidraw element; every field is checked before use. */
type RawElement = Record<string, unknown>;

interface Point {
  x: number;
  y: number;
}

interface Converted {
  /** Records created for one Excalidraw element, in layer order (the first one is its main record). */
  readonly elements: ElementRecord[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseInput(input: unknown): Record<string, unknown> {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new InvalidDocumentError(['Teks JSON Excalidraw tidak valid.']);
    }
  }
  if (!isObject(data) || !Array.isArray(data.elements)) {
    throw new InvalidDocumentError(['Data bukan berkas Excalidraw: properti elements tidak ada.']);
  }
  const type = data.type;
  if (type !== undefined && type !== 'excalidraw' && type !== 'excalidraw/clipboard') {
    throw new InvalidDocumentError([`Tipe berkas Excalidraw "${String(type)}" tidak dikenal.`]);
  }
  return data;
}

// --- Colors -------------------------------------------------------------------------------------

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, and a few CSS names to RGBA (0..255, alpha 0..1). */
function parseColor(value: unknown): { r: number; g: number; b: number; a: number } | null {
  if (typeof value !== 'string') return null;
  const color = value.trim().toLowerCase();
  if (color === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (color === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (color === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(color)?.[1];
  if (!hex) return null;
  const full =
    hex.length <= 4
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const channel = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: full.length === 8 ? channel(3) / 255 : 1,
  };
}

/**
 * Nearest theme color key by hue and lightness. Excalidraw's palette has pastel backgrounds and
 * strong strokes of the same hues, so hue decides the key and lightness only matters for greys.
 */
function colorKey(value: unknown, fallback: ColorKey): ColorKey {
  const rgba = parseColor(value);
  if (!rgba || rgba.a === 0) return fallback;
  const r = rgba.r / 255;
  const g = rgba.g / 255;
  const b = rgba.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.15 || delta < 0.08) {
    if (lightness < 0.3) return 'black';
    if (lightness > 0.85) return 'white';
    return 'grey';
  }
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 335) return 'red';
  if (hue < 40) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 170) return 'green';
  if (hue < 250) return 'blue';
  if (hue < 285) return 'violet';
  return 'purple';
}

function isTransparent(value: unknown): boolean {
  const rgba = parseColor(value);
  return rgba === null || rgba.a === 0;
}

function dashOf(el: RawElement): 'solid' | 'dashed' | 'dotted' {
  const style = el.strokeStyle;
  return style === 'dashed' || style === 'dotted' ? style : 'solid';
}

type Arrowhead = 'none' | 'arrow' | 'triangle' | 'dot' | 'diamond';

function arrowheadOf(value: unknown): Arrowhead {
  if (typeof value !== 'string') return 'none';
  if (value.startsWith('triangle')) return 'triangle';
  if (value === 'dot' || value.startsWith('circle')) return 'dot';
  if (value.startsWith('diamond')) return 'diamond';
  // `arrow`, `bar`, and the crow's foot heads have no exact counterpart.
  return 'arrow';
}

/** Rich text with the canonical trailing newline (ADR-008); `null` for text without characters. */
function richText(text: string): { insert: string }[] | null {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (normalized.trim() === '') return null;
  return [{ insert: normalized.endsWith('\n') ? normalized : `${normalized}\n` }];
}

function textOf(el: RawElement): string {
  return str(el.text) ?? str(el.originalText) ?? '';
}

// --- Geometry -----------------------------------------------------------------------------------

function rotate(p: Point, center: Point, radians: number): Point {
  if (radians === 0) return p;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

function boundsOf(points: readonly Point[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Excalidraw `points` (`[x, y]` relative to the element origin); `null` when malformed. */
function readPoints(el: RawElement): Point[] | null {
  if (!Array.isArray(el.points)) return null;
  const points: Point[] = [];
  for (const p of el.points) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    points.push({ x: p[0] as number, y: p[1] as number });
  }
  return points;
}

/**
 * Board points of a linear element with its rotation applied. Excalidraw rotates linear elements
 * around the center of their points' bounding box.
 */
function worldPoints(el: RawElement, points: readonly Point[]): Point[] {
  const x = finite(el.x, 0);
  const y = finite(el.y, 0);
  const abs = points.map((p) => ({ x: x + p.x, y: y + p.y }));
  const angle = finite(el.angle, 0);
  if (angle === 0) return abs;
  const box = boundsOf(abs);
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  return abs.map((p) => rotate(p, center, angle));
}

function radiansToDegrees(angle: unknown): number {
  const degrees = (finite(angle, 0) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

// --- Conversion ---------------------------------------------------------------------------------

class Converter {
  readonly records: Record<string, BoardRecord> = {};
  readonly idMap = new Map<string, string>();
  readonly unsupported: ExcalidrawUnsupportedElement[] = [];

  private readonly byId = new Map<string, RawElement>();
  /** Text elements that became the label of their container, by container ID. */
  private readonly labels = new Map<string, RawElement>();
  /** Excalidraw element ID → its main kujam element. */
  private readonly main = new Map<string, ElementRecord>();
  private readonly groups = new Map<string, ElementRecord>();
  private readonly ordered: ElementRecord[] = [];

  constructor(
    private readonly createId: () => string,
    private readonly pageId: string,
    private readonly files: Record<string, unknown>,
  ) {}

  run(elements: readonly unknown[]): void {
    const live = elements.filter((el): el is RawElement => isObject(el) && el.isDeleted !== true);
    for (const el of live) {
      const id = str(el.id);
      if (id) this.byId.set(id, el);
    }
    // Bound text becomes the label of its container, so it is not imported on its own.
    for (const el of live) {
      const containerId = str(el.containerId);
      const container = containerId ? this.byId.get(containerId) : undefined;
      if (el.type === 'text' && containerId && container && this.canHoldLabel(container)) {
        this.labels.set(containerId, el);
      }
    }

    // Frames first, so children find their frame and frames sit below their children.
    const isFrame = (el: RawElement) => el.type === 'frame' || el.type === 'magicframe';
    for (const el of [...live.filter(isFrame), ...live.filter((el) => !isFrame(el))]) {
      if (el.type === 'text' && this.labels.get(str(el.containerId) ?? '') === el) continue;
      const result = this.convert(el);
      if (typeof result === 'string') {
        this.unsupported.push({ id: str(el.id) ?? '', type: str(el.type) ?? '', reason: result });
        continue;
      }
      const [first] = result.elements;
      const sourceId = str(el.id);
      if (first && sourceId) {
        this.main.set(sourceId, first);
        this.idMap.set(sourceId, first.id);
      }
      for (const rec of result.elements) {
        rec.parentId = this.parentFor(el);
        this.ordered.push(rec);
      }
    }

    this.bindConnectors(live);
    this.assignIndexes();
  }

  private canHoldLabel(container: RawElement): boolean {
    const type = container.type;
    if (type === 'arrow') return becomesConnector(container);
    return type === 'rectangle' || type === 'ellipse' || type === 'diamond';
  }

  private base(el: RawElement, type: string, props: Record<string, unknown>): ElementRecord {
    return {
      id: this.createId(),
      kind: 'element',
      type,
      pageId: this.pageId,
      parentId: null,
      index: 'a0',
      x: finite(el.x, 0),
      y: finite(el.y, 0),
      rotation: radiansToDegrees(el.angle),
      w: Math.max(0, finite(el.width, 0)),
      h: Math.max(0, finite(el.height, 0)),
      locked: el.locked === true,
      opacity: clamp(finite(el.opacity, 100) / 100, 0, 1),
      props,
      typeVersion: 1,
      meta: {},
    };
  }

  private convert(el: RawElement): Converted | ExcalidrawUnsupportedReason {
    if (!Number.isFinite(el.x) || !Number.isFinite(el.y)) return 'invalid';
    switch (el.type) {
      case 'rectangle':
      case 'ellipse':
      case 'diamond':
        return this.geo(el);
      case 'text':
        return this.text(el);
      case 'freedraw':
        return this.freedraw(el);
      case 'arrow':
        return this.arrow(el);
      case 'line':
        return this.line(el, 'none', 'none');
      case 'image':
        return this.image(el);
      case 'frame':
      case 'magicframe':
        return this.frame(el);
      default:
        return 'unsupported-type';
    }
  }

  private labelProps(containerId: unknown): { label: { insert: string }[]; color: ColorKey } {
    const label = typeof containerId === 'string' ? this.labels.get(containerId) : undefined;
    const text = label ? richText(textOf(label)) : null;
    return {
      label: text ?? [{ insert: '\n' }],
      color: colorKey(label?.strokeColor, 'black'),
    };
  }

  private geo(el: RawElement): Converted {
    const kind =
      el.type === 'rectangle'
        ? isObject(el.roundness)
          ? 'rounded-rectangle'
          : 'rectangle'
        : (el.type as 'ellipse' | 'diamond');
    const filled = !isTransparent(el.backgroundColor);
    const { label, color } = this.labelProps(el.id);
    return {
      elements: [
        this.base(el, 'geo', {
          geo: kind,
          fill: filled ? (el.fillStyle === 'solid' ? 'solid' : 'semi') : 'none',
          fillColor: colorKey(el.backgroundColor, 'white'),
          strokeColor: colorKey(el.strokeColor, 'black'),
          strokeWidth: clamp(finite(el.strokeWidth, 2), 0, 32),
          dash: dashOf(el),
          textColor: color,
          label,
        }),
      ],
    };
  }

  private text(el: RawElement): Converted | ExcalidrawUnsupportedReason {
    const text = richText(textOf(el));
    if (!text) return 'empty';
    const fontSize = finite(el.fontSize, 20);
    let size: (typeof TEXT_SIZES)[number][0] = 'm';
    let best = Infinity;
    for (const [key, px] of TEXT_SIZES) {
      if (Math.abs(px - fontSize) < best) {
        best = Math.abs(px - fontSize);
        size = key;
      }
    }
    const align = el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'end' : 'start';
    return {
      elements: [
        this.base(el, 'text', {
          text,
          size,
          align,
          widthMode: el.autoResize === false ? 'fixed' : 'auto',
          color: colorKey(el.strokeColor, 'black'),
        }),
      ],
    };
  }

  private freedraw(el: RawElement): Converted | ExcalidrawUnsupportedReason {
    const points = readPoints(el);
    if (!points) return 'invalid';
    if (points.length === 0) return 'empty';
    const pressures = Array.isArray(el.pressures) ? el.pressures : [];
    const usePressure = el.simulatePressure === false && pressures.length === points.length;
    const box = boundsOf(points);
    const thickness = clamp(finite(el.strokeWidth, 2) * FREEDRAW_SIZE_FACTOR, 0.5, 64);
    const local = points.map((p, i) => {
      const point = [p.x - box.x, p.y - box.y];
      const pressure = pressures[i];
      if (usePressure && typeof pressure === 'number' && Number.isFinite(pressure)) {
        point.push(clamp(pressure, 0, 1));
      }
      return point;
    });

    // Strokes past the `draw` point limit are split, overlapping by one point so they stay joined.
    const elements: ElementRecord[] = [];
    for (let start = 0; start < local.length; start += MAX_DRAW_POINTS - 1) {
      const chunk = local.slice(start, start + MAX_DRAW_POINTS);
      if (start > 0 && chunk.length < 2) break;
      const rec = this.base(el, 'draw', {
        points: chunk,
        color: colorKey(el.strokeColor, 'black'),
        thickness,
        brush: 'pen',
      });
      rec.x = finite(el.x, 0) + box.x;
      rec.y = finite(el.y, 0) + box.y;
      rec.w = box.w;
      rec.h = box.h;
      elements.push(rec);
    }
    return { elements };
  }

  private line(
    el: RawElement,
    startArrow: Arrowhead,
    endArrow: Arrowhead,
  ): Converted | ExcalidrawUnsupportedReason {
    const points = readPoints(el);
    if (!points) return 'invalid';
    if (points.length < 2) return 'empty';
    if (points.length > MAX_LINE_POINTS) return 'too-many-points';
    const world = worldPoints(el, points);
    const box = boundsOf(world);
    const rec = this.base(el, 'line', {
      points: world.map((p) => ({ x: p.x - box.x, y: p.y - box.y })),
      color: colorKey(el.strokeColor, 'black'),
      strokeWidth: clamp(finite(el.strokeWidth, 2), 1, 32),
      dash: dashOf(el),
      startArrow,
      endArrow,
    });
    Object.assign(rec, { ...box, rotation: 0 });
    return { elements: [rec] };
  }

  private arrow(el: RawElement): Converted | ExcalidrawUnsupportedReason {
    const points = readPoints(el);
    if (!points) return 'invalid';
    if (points.length < 2) return 'empty';
    const startArrow = arrowheadOf(el.startArrowhead);
    const endArrow = arrowheadOf(el.endArrowhead);
    if (!becomesConnector(el)) return this.line(el, startArrow, endArrow);
    const elbowed = el.elbowed === true;

    const world = worldPoints(el, points);
    const start = world[0]!;
    const end = world[world.length - 1]!;
    const box = boundsOf([start, end]);
    const { label } = this.labelProps(el.id);
    const style = elbowed
      ? 'elbow'
      : points.length > 2 && isObject(el.roundness)
        ? 'curved'
        : 'straight';
    const rec = this.base(el, 'connector', {
      startBindingId: null,
      endBindingId: null,
      start: { x: start.x - box.x, y: start.y - box.y },
      end: { x: end.x - box.x, y: end.y - box.y },
      style,
      startArrow,
      endArrow,
      color: colorKey(el.strokeColor, 'black'),
      strokeWidth: clamp(finite(el.strokeWidth, 2), 1, 32),
      dash: dashOf(el),
      label,
    });
    Object.assign(rec, { ...box, rotation: 0 });
    return { elements: [rec] };
  }

  private image(el: RawElement): Converted {
    const fileId = str(el.fileId);
    const file = fileId ? this.files[fileId] : undefined;
    const assetId = this.createId();
    const w = Math.max(0, finite(el.width, 0));
    const h = Math.max(0, finite(el.height, 0));
    const meta: Record<string, unknown> = {};
    const dataURL = isObject(file) ? str(file.dataURL) : undefined;
    if (dataURL && /^data:image\//i.test(dataURL)) meta.url = dataURL;
    if (fileId) meta.excalidrawFileId = fileId;
    const asset: AssetRecord = {
      id: assetId,
      kind: 'asset',
      mimeType: (isObject(file) && str(file.mimeType)) || 'image/png',
      w,
      h,
      meta,
    };
    this.records[assetId] = asset;

    const props: Record<string, unknown> = { assetId };
    const crop = el.crop;
    if (isObject(crop)) {
      const nw = finite(crop.naturalWidth, 0);
      const nh = finite(crop.naturalHeight, 0);
      if (nw > 0 && nh > 0) {
        props.crop = {
          x: clamp(finite(crop.x, 0) / nw, 0, 1),
          y: clamp(finite(crop.y, 0) / nh, 0, 1),
          w: clamp(finite(crop.width, nw) / nw, 0.001, 1),
          h: clamp(finite(crop.height, nh) / nh, 0.001, 1),
        };
      }
    }
    return { elements: [this.base(el, 'image', props)] };
  }

  private frame(el: RawElement): Converted {
    return {
      elements: [
        this.base(el, 'frame', {
          name: (str(el.name) ?? '').slice(0, 256),
          // Excalidraw frames are transparent and clip their children.
          fill: 'none',
          clip: true,
        }),
      ],
    };
  }

  /**
   * Parent of an element: its innermost group, else its frame. Groups are nested from the outermost
   * one down, and the outermost group goes into the frame of the element.
   */
  private parentFor(el: RawElement): string | null {
    const frameId = str(el.frameId);
    const frame = frameId ? this.main.get(frameId) : undefined;
    const groupIds = Array.isArray(el.groupIds)
      ? el.groupIds.filter((id): id is string => typeof id === 'string' && id !== '')
      : [];
    let parent: string | null = frame && frame.type === 'frame' ? frame.id : null;
    // `groupIds` lists the innermost group first.
    for (let i = groupIds.length - 1; i >= 0; i--) {
      parent = this.groupFor(groupIds[i]!, parent).id;
    }
    return parent;
  }

  private groupFor(groupId: string, parentId: string | null): ElementRecord {
    let group = this.groups.get(groupId);
    if (!group) {
      // Bounds are a placeholder; the board recomputes group bounds from the children.
      group = this.base({}, 'group', {});
      group.parentId = parentId;
      this.groups.set(groupId, group);
      this.ordered.push(group);
    }
    return group;
  }

  private bindConnectors(live: readonly RawElement[]): void {
    for (const el of live) {
      if (el.type !== 'arrow') continue;
      const rec = this.main.get(str(el.id) ?? '');
      if (rec?.type !== 'connector') continue;
      const props = rec.props as { start: Point; end: Point };
      for (const [side, endpoint] of [
        ['startBinding', props.start],
        ['endBinding', props.end],
      ] as const) {
        const binding = el[side];
        if (!isObject(binding)) continue;
        const target = this.main.get(str(binding.elementId) ?? '');
        if (!target || target.type === 'connector') continue;
        const point = { x: rec.x + endpoint.x, y: rec.y + endpoint.y };
        const anchor = anchorOn(target, point, binding.fixedPoint);
        const id = this.createId();
        const record: BindingRecord = {
          id,
          kind: 'binding',
          fromId: rec.id,
          toId: target.id,
          anchor,
        };
        this.records[id] = record;
        rec.props = {
          ...rec.props,
          [side === 'startBinding' ? 'startBindingId' : 'endBindingId']: id,
        };
      }
    }
  }

  /** Layer indexes follow the Excalidraw array order; groups go just below their first child. */
  private assignIndexes(): void {
    const indexes = indicesBetween(null, null, this.ordered.length);
    this.ordered.forEach((rec, i) => {
      rec.index = indexes[i]!;
      this.records[rec.id] = rec;
    });
  }
}

/**
 * Whether an arrow becomes a connector. A free multi-point arrow keeps its shape as a `line`, since
 * connectors only have two endpoints; bound and elbow arrows become connectors.
 */
function becomesConnector(el: RawElement): boolean {
  const count = Array.isArray(el.points) ? el.points.length : 0;
  return count <= 2 || el.elbowed === true || isObject(el.startBinding) || isObject(el.endBinding);
}

/** Anchor (0..1 of the target box) for a bound endpoint, from `fixedPoint` or its position. */
function anchorOn(target: ElementRecord, point: Point, fixedPoint: unknown): Point {
  if (
    Array.isArray(fixedPoint) &&
    Number.isFinite(fixedPoint[0]) &&
    Number.isFinite(fixedPoint[1])
  ) {
    return { x: clamp(fixedPoint[0] as number, 0, 1), y: clamp(fixedPoint[1] as number, 0, 1) };
  }
  // Undo the target rotation so the anchor is relative to its unrotated box.
  const center = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  const local = rotate(point, center, (-target.rotation * Math.PI) / 180);
  return {
    x: target.w > 0 ? clamp((local.x - target.x) / target.w, 0, 1) : 0.5,
    y: target.h > 0 ? clamp((local.y - target.y) / target.h, 0, 1) : 0.5,
  };
}

function counterIds(): () => string {
  let next = 0;
  return () => `excalidraw-${(next++).toString(36)}`;
}

/**
 * Converts Excalidraw JSON (a `.excalidraw` file or an `excalidraw/clipboard` payload) into a
 * board document with built-in `@kujam/shapes` elements (BOARD-1706). See the module comment for
 * the element mapping. Excalidraw elements that cannot be mapped are listed in `unsupported`.
 *
 * The result is not validated against the element schemas; {@link importExcalidraw} (or
 * `loadDocument`) does that with the board's registered types.
 *
 * @param input - Excalidraw JSON text or an already parsed object.
 * @throws {@link InvalidDocumentError} when the input is not valid JSON or not Excalidraw data.
 * @beta
 */
export function excalidrawToDocument(
  input: unknown,
  options: ExcalidrawToDocumentOptions = {},
): ExcalidrawConversion {
  const data = parseInput(input);
  const createId = options.createId ?? counterIds();
  const pageId = options.pageId ?? createId();
  const files = isObject(data.files) ? data.files : {};
  const converter = new Converter(createId, pageId, files);
  converter.run(data.elements as unknown[]);

  const page: PageRecord = {
    id: pageId,
    kind: 'page',
    name: options.pageName ?? 'Excalidraw',
    index: 'a0',
    meta: {},
  };
  return {
    document: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      meta: {},
      records: { [pageId]: page, ...converter.records },
    },
    idMap: converter.idMap,
    unsupported: converter.unsupported,
  };
}

/**
 * Imports Excalidraw JSON into `board` (BOARD-1706): converts it with
 * {@link excalidrawToDocument} onto the current page, then imports it with {@link importJSON} (one
 * undo step, the same validation, limits, and permission checks). The returned `idMap` maps
 * Excalidraw element IDs to board element IDs.
 *
 * The board needs the `@kujam/shapes` plugin; otherwise the elements are kept as unknown types.
 *
 * @param input - Excalidraw JSON text or an already parsed object.
 * @throws {@link InvalidDocumentError} when the input is not Excalidraw data, and everything
 *   {@link importJSON} throws. The board is unchanged when anything throws.
 * @beta
 */
export function importExcalidraw(
  board: Board,
  input: unknown,
  options: ImportJSONOptions = {},
): ExcalidrawImportResult {
  const conversion = excalidrawToDocument(input, {
    createId: () => board.createId(),
    pageId: board.pages.current,
  });
  const result = importJSON(board, conversion.document, options);
  const idMap = new Map<string, string>();
  for (const [source, converted] of conversion.idMap) {
    const id = result.idMap.get(converted);
    if (id !== undefined) idMap.set(source, id);
  }
  return { ...result, idMap, unsupported: conversion.unsupported };
}
