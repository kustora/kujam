/**
 * Canvas-to-SVG recording context (BOARD-1702).
 *
 * Implements {@link ElementCanvasContext} (plus the renderer's drawing helpers from BOARD-1204) by
 * recording every call as SVG nodes instead of pixels, so any `render.canvas` becomes vector
 * output: paths stay paths and `fillText` becomes a real `<text>` element. Coordinates are
 * transformed into the element's local space when recorded; text and images keep their transform
 * as a `matrix(...)` attribute. Nothing here needs the DOM, except optional text measurement.
 *
 * @internal
 */

import { sanitizeUrl, type ElementCanvasContext } from '@kujam/core';
import { el, fmt, MAX_DATA_URL_LENGTH, type SvgNode } from './xml.js';

/** 2D affine matrix `[a, b, c, d, e, f]` as in `CanvasRenderingContext2D.setTransform`. */
export type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function matrixAttr(m: Matrix): string | undefined {
  if (m.every((v, i) => v === IDENTITY[i])) return undefined;
  return `matrix(${m.map(fmt).join(' ')})`;
}

/** Parsed CSS `font` shorthand. */
export interface ParsedFont {
  readonly style: string;
  readonly weight: string;
  readonly size: number;
  readonly family: string;
}

const FONT_RE =
  /^\s*((?:(?:normal|italic|oblique|small-caps|bold(?:er)?|lighter|[1-9]00)\s+)*)(\d*\.?\d+)(px|pt|em|rem)(?:\s*\/\s*[^\s]+)?\s+(.+?)\s*$/i;

/** Parses a CSS `font` shorthand such as `italic 600 16px Inter, sans-serif`. */
export function parseFont(font: string): ParsedFont {
  const m = FONT_RE.exec(font);
  if (!m) return { style: 'normal', weight: 'normal', size: 10, family: 'sans-serif' };
  const words = (m[1] ?? '').trim().split(/\s+/).filter(Boolean);
  let style = 'normal';
  let weight = 'normal';
  for (const word of words) {
    const w = word.toLowerCase();
    if (w === 'italic' || w === 'oblique') style = w;
    else if (w === 'bold' || w === 'bolder' || w === 'lighter' || /^[1-9]00$/.test(w)) weight = w;
  }
  const value = Number(m[2]);
  const unit = m[3]!.toLowerCase();
  const size = unit === 'pt' ? (value * 4) / 3 : unit === 'px' ? value : value * 16;
  return { style, weight, size, family: m[4]! };
}

const BLEND_MODES = new Set([
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

const BASELINES: Readonly<Record<string, string | undefined>> = {
  top: 'text-before-edge',
  hanging: 'hanging',
  middle: 'central',
  alphabetic: undefined,
  ideographic: 'ideographic',
  bottom: 'text-after-edge',
};

const ANCHORS: Readonly<Record<string, string | undefined>> = {
  left: undefined,
  start: undefined,
  center: 'middle',
  right: 'end',
  end: 'end',
};

/** Safe paint value for an SVG attribute: a color string, never a `url(...)` reference. */
function paint(value: string | object): string {
  if (typeof value !== 'string') return '#000000';
  const v = value.trim();
  if (!v || /url\s*\(|[<>"]/i.test(v)) return '#000000';
  return v;
}

interface State {
  matrix: Matrix;
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'bevel' | 'miter' | 'round';
  font: string;
  textAlign: ElementCanvasContext['textAlign'];
  textBaseline: ElementCanvasContext['textBaseline'];
  dash: number[];
  /** Clip groups opened since the matching `save()`. */
  clips: number;
}

/** Options for {@link SvgCanvasContext}. */
export interface SvgContextOptions {
  /** Prefix for generated IDs (clip paths). Must be unique per document. */
  readonly idPrefix: string;
  /** Shared `<defs>` children of the document. */
  readonly defs: SvgNode[];
  /** Maps an image object passed to `drawImage` to an `href`, or `null` when it cannot be used. */
  resolveImage?(image: object): string | null;
  /** Text width measurement; defaults to an estimate from the font size. */
  measureText?(text: string, font: string): number;
  /** Called with every external image URL recorded (for embedding). */
  onImageUrl?(url: string): void;
}

const IMAGE_SCHEMES = ['https:', 'http:', 'blob:', 'data:'];

let idCounter = 0;

/**
 * Recording context. Use {@link SvgCanvasContext.nodes} after `render.canvas` returns.
 */
export class SvgCanvasContext implements ElementCanvasContext {
  /** Recorded nodes at the top level of the element. */
  readonly nodes: SvgNode[] = [];
  /** Images that could not be resolved to an `href`. */
  skippedImages = 0;

  private state: State = {
    matrix: [...IDENTITY],
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    dash: [],
    clips: 0,
  };
  private readonly stack: State[] = [];
  /** Open clip groups, innermost last; new nodes go into the last one. */
  private readonly containers: SvgNode[][] = [];
  private path: string[] = [];
  private current: [number, number] | null = null;
  private subpathStart: [number, number] | null = null;

  constructor(private readonly options: SvgContextOptions) {}

  // ---------- State ----------

  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(v: number) {
    if (Number.isFinite(v) && v >= 0 && v <= 1) this.state.globalAlpha = v;
  }
  get globalCompositeOperation(): string {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(v: string) {
    if (typeof v === 'string') this.state.globalCompositeOperation = v;
  }
  get fillStyle(): string | object {
    return this.state.fillStyle;
  }
  set fillStyle(v: string | object) {
    this.state.fillStyle = v;
  }
  get strokeStyle(): string | object {
    return this.state.strokeStyle;
  }
  set strokeStyle(v: string | object) {
    this.state.strokeStyle = v;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(v: number) {
    if (Number.isFinite(v) && v > 0) this.state.lineWidth = v;
  }
  get lineCap(): State['lineCap'] {
    return this.state.lineCap;
  }
  set lineCap(v: State['lineCap']) {
    this.state.lineCap = v;
  }
  get lineJoin(): State['lineJoin'] {
    return this.state.lineJoin;
  }
  set lineJoin(v: State['lineJoin']) {
    this.state.lineJoin = v;
  }
  get font(): string {
    return this.state.font;
  }
  set font(v: string) {
    if (typeof v === 'string') this.state.font = v;
  }
  get textAlign(): State['textAlign'] {
    return this.state.textAlign;
  }
  set textAlign(v: State['textAlign']) {
    this.state.textAlign = v;
  }
  get textBaseline(): State['textBaseline'] {
    return this.state.textBaseline;
  }
  set textBaseline(v: State['textBaseline']) {
    this.state.textBaseline = v;
  }

  save(): void {
    this.stack.push(this.state);
    this.state = {
      ...this.state,
      matrix: [...this.state.matrix],
      dash: [...this.state.dash],
      clips: 0,
    };
  }

  restore(): void {
    const prev = this.stack.pop();
    if (!prev) return;
    for (let i = 0; i < this.state.clips; i++) this.containers.pop();
    this.state = prev;
  }

  translate(x: number, y: number): void {
    this.state.matrix = multiply(this.state.matrix, [1, 0, 0, 1, x, y]);
  }

  rotate(angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.state.matrix = multiply(this.state.matrix, [c, s, -s, c, 0, 0]);
  }

  scale(x: number, y: number): void {
    this.state.matrix = multiply(this.state.matrix, [x, 0, 0, y, 0, 0]);
  }

  setLineDash(segments: number[]): void {
    this.state.dash = Array.isArray(segments)
      ? segments.filter((n) => Number.isFinite(n) && n >= 0)
      : [];
  }

  // ---------- Paths ----------

  beginPath(): void {
    this.path = [];
    this.current = null;
    this.subpathStart = null;
  }

  closePath(): void {
    if (!this.current) return;
    this.path.push('Z');
    this.current = this.subpathStart;
  }

  moveTo(x: number, y: number): void {
    const p = apply(this.state.matrix, x, y);
    this.path.push(`M${fmt(p[0])} ${fmt(p[1])}`);
    this.current = p;
    this.subpathStart = p;
  }

  lineTo(x: number, y: number): void {
    if (!this.current) return this.moveTo(x, y);
    const p = apply(this.state.matrix, x, y);
    this.path.push(`L${fmt(p[0])} ${fmt(p[1])}`);
    this.current = p;
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.current) this.moveTo(cpx, cpy);
    const c = apply(this.state.matrix, cpx, cpy);
    const p = apply(this.state.matrix, x, y);
    this.path.push(`Q${fmt(c[0])} ${fmt(c[1])} ${fmt(p[0])} ${fmt(p[1])}`);
    this.current = p;
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!this.current) this.moveTo(c1x, c1y);
    const c1 = apply(this.state.matrix, c1x, c1y);
    const c2 = apply(this.state.matrix, c2x, c2y);
    const p = apply(this.state.matrix, x, y);
    this.path.push(
      `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p[0])} ${fmt(p[1])}`,
    );
    this.current = p;
  }

  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
    this.ellipse(x, y, r, r, 0, start, end, ccw);
  }

  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw = false,
  ): void {
    if (![x, y, rx, ry, rotation, start, end].every(Number.isFinite) || rx < 0 || ry < 0) return;
    const TAU = Math.PI * 2;
    let sweep: number;
    if (!ccw) {
      sweep = end - start >= TAU ? TAU : (((end - start) % TAU) + TAU) % TAU;
    } else {
      sweep = start - end >= TAU ? -TAU : -((((start - end) % TAU) + TAU) % TAU);
    }
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const point = (t: number): [number, number] => {
      const px = rx * Math.cos(t);
      const py = ry * Math.sin(t);
      return [x + px * cosR - py * sinR, y + px * sinR + py * cosR];
    };
    const derivative = (t: number): [number, number] => {
      const dx = -rx * Math.sin(t);
      const dy = ry * Math.cos(t);
      return [dx * cosR - dy * sinR, dx * sinR + dy * cosR];
    };
    const first = point(start);
    if (this.current) this.lineTo(first[0], first[1]);
    else this.moveTo(first[0], first[1]);
    if (sweep === 0) return;
    const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / segments;
    const k = (4 / 3) * Math.tan(step / 4);
    let t = start;
    for (let i = 0; i < segments; i++) {
      const t2 = t + step;
      const p0 = point(t);
      const d0 = derivative(t);
      const p1 = point(t2);
      const d1 = derivative(t2);
      this.bezierCurveTo(
        p0[0] + k * d0[0],
        p0[1] + k * d0[1],
        p1[0] - k * d1[0],
        p1[1] - k * d1[1],
        p1[0],
        p1[1],
      );
      t = t2;
    }
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
    this.moveTo(x, y);
    // The trailing moveTo only sets the current point; drop it from the output.
    this.path.pop();
  }

  /** Rounded rectangle helper (BOARD-1204), traced with quadratic corners. */
  roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0): void {
    const list = Array.isArray(radii) ? radii : [radii];
    const [tl = 0, tr = tl, br = tl, bl = tr] =
      list.length === 2
        ? [list[0], list[1], list[0], list[1]]
        : list.length === 3
          ? [list[0], list[1], list[2], list[1]]
          : list;
    const max = Math.min(Math.abs(w), Math.abs(h)) / 2;
    const r = [tl, tr, br, bl].map((v) => Math.max(0, Math.min(Number(v) || 0, max))) as [
      number,
      number,
      number,
      number,
    ];
    this.moveTo(x + r[0], y);
    this.lineTo(x + w - r[1], y);
    this.quadraticCurveTo(x + w, y, x + w, y + r[1]);
    this.lineTo(x + w, y + h - r[2]);
    this.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
    this.lineTo(x + r[3], y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r[3]);
    this.lineTo(x, y + r[0]);
    this.quadraticCurveTo(x, y, x + r[0], y);
    this.closePath();
  }

  // ---------- Painting ----------

  fill(fillRule?: 'evenodd' | 'nonzero'): void {
    if (this.path.length === 0) return;
    this.emit(
      el('path', {
        d: this.path.join(''),
        fill: paint(this.state.fillStyle),
        'fill-rule': fillRule === 'evenodd' ? 'evenodd' : undefined,
        ...this.common(),
      }),
    );
  }

  stroke(): void {
    if (this.path.length === 0) return;
    this.emit(
      el('path', { d: this.path.join(''), fill: 'none', ...this.strokeAttrs(), ...this.common() }),
    );
  }

  clip(fillRule?: 'evenodd' | 'nonzero'): void {
    const id = `${this.options.idPrefix}c${++idCounter}`;
    this.options.defs.push(
      el('clipPath', { id }, [
        el('path', {
          d: this.path.length > 0 ? this.path.join('') : 'M0 0',
          'clip-rule': fillRule === 'evenodd' ? 'evenodd' : undefined,
        }),
      ]),
    );
    const group = el('g', { 'clip-path': `url(#${id})` });
    this.emit(group);
    this.containers.push(group.children as SvgNode[]);
    this.state.clips++;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.withTempPath(
      () => this.rect(x, y, w, h),
      () => this.fill(),
    );
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.withTempPath(
      () => this.rect(x, y, w, h),
      () => this.stroke(),
    );
  }

  /** Clearing has no meaning in a vector document: nothing is drawn below an element. */
  clearRect(): void {}

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    if (typeof text !== 'string' || text.length === 0) return;
    const font = parseFont(this.state.font);
    const width = this.measureText(text).width;
    const squeeze = maxWidth !== undefined && maxWidth >= 0 && width > maxWidth;
    this.emit(
      el(
        'text',
        {
          x,
          y,
          transform: matrixAttr(this.state.matrix),
          'font-family': font.family,
          'font-size': font.size,
          'font-weight': font.weight === 'normal' ? undefined : font.weight,
          'font-style': font.style === 'normal' ? undefined : font.style,
          'text-anchor': ANCHORS[this.state.textAlign],
          'dominant-baseline': BASELINES[this.state.textBaseline],
          fill: paint(this.state.fillStyle),
          textLength: squeeze ? Math.max(0, maxWidth!) : undefined,
          lengthAdjust: squeeze ? 'spacingAndGlyphs' : undefined,
          'xml:space': /^\s|\s$|\s\s/.test(text) ? 'preserve' : undefined,
          ...this.common(),
        },
        [text],
      ),
    );
  }

  measureText(text: string): { readonly width: number } {
    const measured = this.options.measureText?.(text, this.state.font);
    if (typeof measured === 'number' && Number.isFinite(measured)) return { width: measured };
    return { width: text.length * parseFont(this.state.font).size * 0.55 };
  }

  drawImage(image: object, ...args: number[]): void {
    const href = this.imageHref(image);
    if (href === null) {
      this.skippedImages++;
      return;
    }
    const size = naturalSize(image);
    let sx = 0;
    let sy = 0;
    let sw = size.w;
    let sh = size.h;
    let dx: number;
    let dy: number;
    let dw = size.w;
    let dh = size.h;
    if (args.length >= 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    } else if (args.length >= 4) {
      [dx, dy, dw, dh] = args as [number, number, number, number];
    } else {
      [dx = 0, dy = 0] = args;
    }
    this.emitImage(
      href,
      dx,
      dy,
      dw,
      dh,
      args.length >= 8 ? { sx, sy, sw, sh, iw: size.w, ih: size.h } : null,
    );
  }

  // ---------- Renderer helpers (BOARD-1204) ----------

  dot(x: number, y: number, radius: number, color: string): void {
    this.save();
    this.fillStyle = color;
    this.beginPath();
    this.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
    this.fill();
    this.restore();
  }

  colorDot(x: number, y: number, radius: number, color: string): void {
    this.dot(x, y, radius, color);
  }

  drawText(
    text: string,
    x: number,
    y: number,
    options?: {
      readonly font?: string;
      readonly color?: string;
      readonly align?: State['textAlign'];
      readonly baseline?: State['textBaseline'];
      readonly maxWidth?: number;
    },
  ): void {
    this.save();
    if (options?.font) this.font = options.font;
    if (options?.color) this.fillStyle = options.color;
    if (options?.align) this.textAlign = options.align;
    if (options?.baseline) this.textBaseline = options.baseline;
    this.fillText(text, x, y, options?.maxWidth);
    this.restore();
  }

  drawThumbnail(
    source: string | object,
    x: number,
    y: number,
    w: number,
    h: number,
    options?: { readonly radius?: number | number[] },
  ): boolean {
    const href = this.imageHref(source);
    if (href === null) {
      this.skippedImages++;
      return false;
    }
    this.save();
    if (options?.radius !== undefined) {
      this.beginPath();
      this.roundRect(x, y, w, h, options.radius);
      this.clip();
    }
    this.emitImage(href, x, y, w, h, null);
    this.restore();
    return true;
  }

  // ---------- Internals ----------

  private imageHref(image: unknown): string | null {
    if (typeof image === 'string') {
      const url = sanitizeUrl(image, IMAGE_SCHEMES, { maxLength: MAX_DATA_URL_LENGTH });
      if (url !== null && !url.startsWith('data:')) this.options.onImageUrl?.(url);
      return url;
    }
    if (typeof image !== 'object' || image === null) return null;
    const href = this.options.resolveImage?.(image) ?? null;
    if (href !== null && !href.startsWith('data:')) this.options.onImageUrl?.(href);
    return href;
  }

  private emitImage(
    href: string,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    source: { sx: number; sy: number; sw: number; sh: number; iw: number; ih: number } | null,
  ): void {
    if (!(dw > 0) || !(dh > 0)) return;
    const transform = matrixAttr(this.state.matrix);
    if (
      !source ||
      (source.sx === 0 && source.sy === 0 && source.sw === source.iw && source.sh === source.ih)
    ) {
      this.emit(
        el('image', {
          href,
          x: dx,
          y: dy,
          width: dw,
          height: dh,
          preserveAspectRatio: 'none',
          transform,
          ...this.common(),
        }),
      );
      return;
    }
    // Source rectangle: a nested viewport whose viewBox crops the full image.
    this.emit(
      el('g', { transform, ...this.common() }, [
        el(
          'svg',
          {
            x: dx,
            y: dy,
            width: dw,
            height: dh,
            viewBox: `${fmt(source.sx)} ${fmt(source.sy)} ${fmt(source.sw)} ${fmt(source.sh)}`,
            preserveAspectRatio: 'none',
            overflow: 'hidden',
          },
          [el('image', { href, width: source.iw, height: source.ih, preserveAspectRatio: 'none' })],
        ),
      ]),
    );
  }

  private strokeAttrs(): Record<string, string | number | undefined> {
    const m = this.state.matrix;
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const dash = this.state.dash;
    return {
      stroke: paint(this.state.strokeStyle),
      'stroke-width': this.state.lineWidth * scale,
      'stroke-linecap': this.state.lineCap === 'butt' ? undefined : this.state.lineCap,
      'stroke-linejoin': this.state.lineJoin === 'miter' ? undefined : this.state.lineJoin,
      'stroke-dasharray':
        dash.length > 0 && dash.some((d) => d > 0)
          ? (dash.length % 2 === 1 ? [...dash, ...dash] : dash).map((d) => fmt(d * scale)).join(' ')
          : undefined,
    };
  }

  private common(): Record<string, string | number | undefined> {
    const op = this.state.globalCompositeOperation;
    return {
      opacity: this.state.globalAlpha < 1 ? this.state.globalAlpha : undefined,
      style: BLEND_MODES.has(op) ? `mix-blend-mode:${op}` : undefined,
    };
  }

  private emit(node: SvgNode): void {
    const target = this.containers[this.containers.length - 1] ?? this.nodes;
    target.push(node);
  }

  private withTempPath(trace: () => void, paintFn: () => void): void {
    const saved = { path: this.path, current: this.current, start: this.subpathStart };
    this.beginPath();
    trace();
    paintFn();
    this.path = saved.path;
    this.current = saved.current;
    this.subpathStart = saved.start;
  }
}

/** Natural pixel size of an image-like object (`HTMLImageElement`, `ImageBitmap`, canvas). */
export function naturalSize(image: unknown): { w: number; h: number } {
  const img = image as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number | { baseVal?: { value?: number } };
    height?: number | { baseVal?: { value?: number } };
  };
  const num = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0);
  return {
    w: num(img?.naturalWidth) || num(img?.width) || 1,
    h: num(img?.naturalHeight) || num(img?.height) || 1,
  };
}
