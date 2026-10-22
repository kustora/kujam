// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  rect,
  schema,
  string,
  type Board,
  type ElementCanvasContext,
} from '@kujam/core';
import {
  contactCard,
  contactCardPlugin,
  createFakeContactApi,
  type Contact,
} from '../../../../examples/contact-card/src/index.js';
import {
  mountRenderer,
  LodManager,
  LOD_HYSTERESIS_BUFFER,
  ThumbnailCache,
  type BoardView,
} from '../index.js';
import { createDrawingContext, polyfillRoundRect } from './thumbnail-cache.js';

let boards: Board[] = [];
let views: BoardView[] = [];

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(): void {}
  disconnect(): void {}

  resize(width: number, height: number): void {
    const entry = { target: this.targets[0], contentRect: { width, height } };
    this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
function flushFrames(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(0);
}

const canvasCalls: Array<{ id: string; compact: boolean; data?: unknown }> = [];
const htmlMounts: string[] = [];
const htmlDestroys: string[] = [];

const hybridCard = defineElement({
  type: 'hybrid-card',
  version: 1,
  props: schema({ title: string() }),
  geometry: (el) => rect(el.w, el.h),
  lod: { compactBelowZoom: 0.4 },
  render: {
    html: (host, el, data) => {
      htmlMounts.push(el.id);
      host.textContent = `HTML: ${el.props.title}`;
      return {
        update: (next) => {
          host.textContent = `HTML: ${next.props.title}`;
        },
        destroy: () => {
          htmlDestroys.push(el.id);
        },
      };
    },
    canvas: (g, el, data, lod) => {
      canvasCalls.push({ id: el.id, compact: lod.compact, data });
      g.beginPath();
      g.rect(0, 0, el.w, el.h);
      g.fillStyle = '#f0f0f0';
      g.fill();
    },
  },
});

const htmlOnlyCard = defineElement({
  type: 'html-only',
  version: 1,
  props: schema({ label: string() }),
  geometry: (el) => rect(el.w, el.h),
  lod: { compactBelowZoom: 0.4 },
  render: {
    html: (host, el) => {
      host.textContent = `HTML-only: ${el.props.label}`;
      return {
        update: () => {},
        destroy: () => {},
      };
    },
  },
});

const testPlugin = definePlugin({
  id: 'lod-test-plugin',
  elements: [hybridCard, htmlOnlyCard],
});

beforeEach(() => {
  canvasCalls.length = 0;
  htmlMounts.length = 0;
  htmlDestroys.length = 0;
  frames.clear();
  FakeResizeObserver.instances = [];

  Object.assign(window, {
    ResizeObserver: FakeResizeObserver,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    devicePixelRatio: 1,
  });

  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    measureText: () => ({ width: 50 }),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  for (const view of views) view.unmount();
  for (const board of boards) board.dispose();
  views = [];
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function setup(options: { width?: number; height?: number; plugins?: readonly unknown[] } = {}) {
  const container = document.body.appendChild(document.createElement('div'));
  const width = options.width ?? 800;
  const height = options.height ?? 600;

  vi.spyOn(container, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(height);

  const board = createBoard({ plugins: (options.plugins as never) ?? [testPlugin] });
  boards.push(board);

  const view = mountRenderer(board, container);
  views.push(view);

  const observer = FakeResizeObserver.instances.at(-1);
  if (observer) observer.resize(width, height);

  return { board, view, container, observer };
}

describe('BOARD-809 / BOARD-1204: LOD Manager & Hysteresis', () => {
  it('evaluates compact mode and prevents flapping using hysteresis buffer', () => {
    const lod = new LodManager();
    const el = { id: 'card-1' } as never;
    const def = {
      render: { canvas: () => {}, html: () => ({} as never) },
      lod: { compactBelowZoom: 0.4 },
    } as never;

    // Normal zoom (1.0) -> not compact
    expect(lod.isCompact(el, def, 1.0)).toBe(false);

    // Zoom drops below threshold (0.35 < 0.4) -> switches to compact
    expect(lod.isCompact(el, def, 0.35)).toBe(true);

    // Zoom moves into hysteresis zone (0.41, between 0.40 and 0.40 * 1.05 = 0.42) -> stays compact!
    expect(lod.isCompact(el, def, 0.41)).toBe(true);

    // Zoom exceeds threshold * hysteresisBuffer (0.43 > 0.42) -> switches back to normal
    expect(lod.isCompact(el, def, 0.43)).toBe(false);

    // Zoom drops into hysteresis zone from above (0.41) -> stays normal!
    expect(lod.isCompact(el, def, 0.41)).toBe(false);
  });

  it('keeps HTML-only elements in HTML at all zoom levels (BOARD-809)', () => {
    const lod = new LodManager();
    const el = { id: 'html-el' } as never;
    const def = {
      render: { html: () => ({} as never) }, // No render.canvas!
      lod: { compactBelowZoom: 0.4 },
    } as never;

    expect(lod.isCompact(el, def, 0.1)).toBe(false);
    expect(lod.isCompact(el, def, 0.01)).toBe(false);
  });
});

describe('BOARD-1204: Drawing context helpers', () => {
  it('provides roundRect, dot, colorDot, drawText, and drawThumbnail helpers', () => {
    const rawCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      clip: vi.fn(),
      fillText: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const cache = new ThumbnailCache();
    const g = createDrawingContext(rawCtx, cache);

    // 1. roundRect helper
    expect(typeof g.roundRect).toBe('function');
    g.roundRect?.(10, 20, 100, 50, 8);
    expect(rawCtx.moveTo).toHaveBeenCalled();
    expect(rawCtx.quadraticCurveTo).toHaveBeenCalled();
    expect(rawCtx.closePath).toHaveBeenCalled();

    // 2. dot / colorDot helper
    expect(typeof g.colorDot).toBe('function');
    g.colorDot?.(50, 60, 12, '#2563eb');
    expect(rawCtx.arc).toHaveBeenCalledWith(50, 60, 12, 0, Math.PI * 2);
    expect(rawCtx.fill).toHaveBeenCalled();

    // 3. drawText helper
    expect(typeof g.drawText).toBe('function');
    g.drawText?.('Halo Kujam', 20, 30, { font: '14px Inter', color: '#17191e' });
    expect(rawCtx.fillText).toHaveBeenCalledWith('Halo Kujam', 20, 30);

    // 4. drawThumbnail helper with pre-cached image
    const mockImage = {} as CanvasImageSource;
    cache.set('https://example.com/avatar.png', mockImage);
    const drawn = g.drawThumbnail?.('https://example.com/avatar.png', 0, 0, 40, 40, { radius: 20 });
    expect(drawn).toBe(true);
    expect(rawCtx.drawImage).toHaveBeenCalledWith(mockImage, 0, 0, 40, 40);

    // Uncached thumbnail triggers loading and returns false
    const drawnMissing = g.drawThumbnail?.('https://example.com/unknown.png', 0, 0, 40, 40);
    expect(drawnMissing).toBe(false);
  });

  it('invokes native accessors with the real context as `this`', () => {
    // Mimics a native canvas brand check that throws "Illegal invocation" for foreign receivers.
    class BrandedCtx {
      #fill = '#000';
      get fillStyle(): string {
        if (!(#fill in this)) throw new TypeError('Illegal invocation');
        return this.#fill;
      }
      set fillStyle(value: string) {
        if (!(#fill in this)) throw new TypeError('Illegal invocation');
        this.#fill = value;
      }
    }
    const g = createDrawingContext(new BrandedCtx() as unknown as CanvasRenderingContext2D);
    g.fillStyle = '#fff';
    expect(g.fillStyle).toBe('#fff');
  });

  it('polyills roundRect with clamped radii for numbers and arrays', () => {
    const ctx = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    polyfillRoundRect(ctx, 0, 0, 100, 80, [10, 20, 15, 5]);
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 0);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(4);
  });
});

describe('BOARD-809: HTML to Canvas LOD switching and lifecycle', () => {
  it('switches from HTML to Canvas compact mode below zoom threshold and frees DOM', () => {
    const { board, view } = setup();

    const card = board.create({
      id: 'c1',
      type: 'hybrid-card',
      x: 100,
      y: 100,
      w: 200,
      h: 100,
      props: { title: 'Card Alpha' },
    });

    flushFrames();

    const cameraHost = view.layers.htmlCamera;
    const domHost = cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`);
    expect(domHost).not.toBeNull();
    expect(domHost?.textContent).toContain('HTML: Card Alpha');
    expect(htmlMounts).toContain('c1');
    // Canvas should not draw it while in HTML mode
    expect(canvasCalls.find((c) => c.id === 'c1')).toBeUndefined();

    // Zoom out below compactBelowZoom (0.4)
    board.setCamera({ zoom: 0.3 });
    flushFrames();

    // 1. Element is drawn on Canvas in compact mode
    const canvasDraw = canvasCalls.find((c) => c.id === 'c1');
    expect(canvasDraw).toBeDefined();
    expect(canvasDraw?.compact).toBe(true);

    // 2. DOM view is unmounted and freed
    expect(htmlDestroys).toContain('c1');
    const detachedDom = cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`);
    expect(detachedDom).toBeNull();
  });

  it('switches back from Canvas to HTML when zoom increases above threshold with hysteresis', () => {
    const { board, view } = setup();

    const card = board.create({
      id: 'c2',
      type: 'hybrid-card',
      x: 100,
      y: 100,
      w: 200,
      h: 100,
      props: { title: 'Card Beta' },
    });

    // Start in compact canvas mode (zoom = 0.3)
    board.setCamera({ zoom: 0.3 });
    flushFrames();

    const cameraHost = view.layers.htmlCamera;
    expect(cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`)).toBeNull();
    expect(canvasCalls.some((c) => c.id === 'c2' && c.compact)).toBe(true);

    // Zoom up to 0.405 (within the 5% hysteresis zone: 0.40 to 0.42)
    canvasCalls.length = 0;
    board.setCamera({ zoom: 0.405 });
    flushFrames();

    // Must stay in compact canvas mode (no flapping!)
    expect(cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`)).toBeNull();
    expect(canvasCalls.some((c) => c.id === 'c2' && c.compact)).toBe(true);

    // Zoom up above threshold * 1.05 (0.45 > 0.42)
    canvasCalls.length = 0;
    board.setCamera({ zoom: 0.45 });
    flushFrames();

    // HTML view is remounted
    const remounted = cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`);
    expect(remounted).not.toBeNull();
    expect(remounted?.textContent).toContain('HTML: Card Beta');
    // Canvas stops drawing it
    expect(canvasCalls.some((c) => c.id === 'c2')).toBe(false);
  });

  it('keeps elements that only define render.html mounted in HTML at all zoom levels (BOARD-809)', () => {
    const { board, view } = setup();

    const card = board.create({
      id: 'h1',
      type: 'html-only',
      x: 100,
      y: 100,
      w: 200,
      h: 100,
      props: { label: 'Permanent HTML' },
    });

    flushFrames();

    const cameraHost = view.layers.htmlCamera;
    expect(cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`)).not.toBeNull();

    // Zoom way down to 0.15
    board.setCamera({ zoom: 0.15 });
    flushFrames();

    // It remains in HTML!
    expect(cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`)).not.toBeNull();
  });
});

describe('BOARD-1204 / BOARD-1207: @kujam/example-contact-card with LOD', () => {
  it('renders contact card in HTML at normal zoom and switches to canvas compact below 0.4', async () => {
    const api = createFakeContactApi();
    api.setBehavior({ mode: 'sync' });
    const ayu: Contact = {
      id: 'c-ayu',
      name: 'Ayu Lestari',
      role: 'Desainer produk',
      company: 'Studio Arunika',
      email: 'ayu@arunika.example',
      color: '#2563eb',
    };

    const container = document.body.appendChild(document.createElement('div'));
    vi.spyOn(container, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(600);

    const board = createBoard({
      locale: 'id',
      plugins: [contactCardPlugin],
      resolvers: { contact: (id) => api.resolve(id) },
    });
    boards.push(board);

    const card = board.create({
      id: 'contact-1',
      type: 'contact-card',
      x: 80,
      y: 80,
      w: 300,
      h: 112,
      props: { contactId: 'c-ayu' },
    });

    const view = mountRenderer(board, container);
    views.push(view);

    const observer = FakeResizeObserver.instances.at(-1);
    if (observer) observer.resize(800, 600);

    flushFrames();

    const cameraHost = view.layers.htmlCamera;
    const domCard = cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`);
    expect(domCard).not.toBeNull();
    expect(domCard?.textContent).toContain('Ayu Lestari');

    // Zoom below 0.4
    board.setCamera({ zoom: 0.3 });
    flushFrames();

    // HTML DOM is detached
    expect(cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`)).toBeNull();

    // Zoom back to 1.0
    board.setCamera({ zoom: 1.0 });
    flushFrames();

    // HTML DOM is restored with the same contact data
    const restored = cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`);
    expect(restored).not.toBeNull();
    expect(restored?.textContent).toContain('Ayu Lestari');
  });
});
