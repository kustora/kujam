import {
  createBoard,
  defineElement,
  definePlugin,
  object,
  string,
  type Board,
  type ElementLodState,
} from '@kujam/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportCanvasFactory, ExportFetch } from './environment.js';
import { createThumbnail, ExportError, exportPNG } from './index.js';
import { fitScale } from './png.js';

const lods: ElementLodState[] = [];
const box = defineElement({
  type: 'sticky',
  version: 1,
  props: object({}),
  defaults: {},
  render: {
    canvas: (g, el, _data, lod) => {
      lods.push(lod);
      g.fillStyle = '#FFE58F';
      g.fillRect(0, 0, el.w, el.h);
    },
  },
});
const image = defineElement({
  type: 'image',
  version: 1,
  props: object({ assetId: string() }),
  defaults: { assetId: '' },
  render: { canvas: () => {} },
});
const custom = defineElement({
  type: 'card',
  version: 1,
  props: object({ thumb: string() }),
  defaults: { thumb: '' },
  render: {
    canvas: (g, el) => {
      g.drawThumbnail?.(el.props.thumb, 0, 0, el.w, el.h);
    },
  },
});
const vectorCard = defineElement({
  type: 'vector-card',
  version: 1,
  props: object({}),
  defaults: {},
  render: { canvas: (g) => g.fillRect(0, 0, 1, 1) },
  export: { svg: () => '<rect width="1" height="1"/>' },
});
const html = defineElement({
  type: 'html',
  version: 1,
  props: object({}),
  defaults: {},
  render: { html: () => ({ update() {}, destroy() {} }) },
});
const plugin = definePlugin({
  id: 'raster-test',
  elements: [box, image, custom, vectorCard, html],
});

let boards: Board[] = [];
afterEach(() => {
  for (const b of boards) b.dispose();
  boards = [];
  lods.length = 0;
  vi.unstubAllGlobals();
});

function setup(assets?: Record<string, string>): Board {
  const board = createBoard({
    plugins: [plugin],
    ...(assets ? { assets: { resolve: (id: string) => assets[id] ?? null } } : {}),
  });
  boards.push(board);
  return board;
}

interface FakeCanvas {
  readonly factory: ExportCanvasFactory;
  readonly calls: string[];
  readonly sizes: [number, number][];
}

/** Records drawing calls; `failBlobs` encodes fail first (like a tainted canvas). */
function fakeCanvas(failBlobs = 0): FakeCanvas {
  const calls: string[] = [];
  const sizes: [number, number][] = [];
  let failures = failBlobs;
  const factory: ExportCanvasFactory = (w, h) => {
    sizes.push([w, h]);
    const context = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => {
        if (key in target) return target[key as string];
        if (key === 'measureText') return () => ({ width: 0 });
        return (...args: unknown[]) => {
          calls.push(
            `${String(key)}(${args.map((a) => (typeof a === 'object' ? 'img' : String(a))).join(',')})`,
          );
        };
      },
      set: (target, key, value) => {
        target[key as string] = value;
        if (key === 'fillStyle') calls.push(`fillStyle=${String(value)}`);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return {
      context,
      toBlob: async (type) => {
        if (failures > 0) {
          failures--;
          throw new DOMException('Tainted canvases may not be exported.', 'SecurityError');
        }
        return new Blob([new Uint8Array([1])], { type });
      },
    };
  };
  return { factory, calls, sizes };
}

const fetchFrom =
  (urls: readonly string[]): ExportFetch =>
  async (url) => {
    if (!urls.includes(url)) throw new TypeError('Failed to fetch (CORS)');
    return { ok: true, blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }) };
  };

describe('BOARD-1703: PNG export', () => {
  it('paints at 1x to 4x with a background and padding', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 100, h: 50 });
    const canvas = fakeCanvas();
    const result = await exportPNG(board, { scale: 2, padding: 10, createCanvas: canvas.factory });
    expect(result).toMatchObject({
      format: 'png',
      mimeType: 'image/png',
      width: 240,
      height: 140,
      scale: 2,
      warnings: [],
    });
    expect(result.data.type).toBe('image/png');
    expect(canvas.sizes).toEqual([[240, 140]]);
    expect(canvas.calls).toContain(`fillStyle=${board.theme.canvas.background}`);
    expect(canvas.calls).toContain('fillRect(0,0,240,140)');
    // Board point (-10, -10) is the canvas origin, at 2 pixels per unit.
    expect(canvas.calls).toContain('setTransform(2,0,0,2,20,20)');
    expect(canvas.calls).toContain('fillRect(0,0,100,50)');
    expect(lods).toEqual([{ zoom: 2, compact: false }]);

    const transparent = fakeCanvas();
    await exportPNG(board, { background: false, createCanvas: transparent.factory });
    expect(
      transparent.calls.some((c) => c.startsWith(`fillStyle=${board.theme.canvas.background}`)),
    ).toBe(false);

    await expect(
      exportPNG(board, { scale: 5, createCanvas: canvas.factory }),
    ).rejects.toMatchObject({ code: 'invalid-options' });
    await expect(
      exportPNG(board, { scale: 0.5, createCanvas: canvas.factory }),
    ).rejects.toBeInstanceOf(ExportError);
  });

  it('lowers the scale with a warning when the canvas would be too large', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 1000, h: 500 });
    const canvas = fakeCanvas();
    const result = await exportPNG(board, {
      scale: 4,
      padding: 0,
      maxCanvasSide: 2000,
      createCanvas: canvas.factory,
    });
    expect(result.scale).toBe(2);
    expect([result.width, result.height]).toEqual([2000, 1000]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'scale-reduced' })]);

    const byArea = await exportPNG(board, {
      scale: 4,
      padding: 0,
      maxCanvasPixels: 500_000,
      createCanvas: canvas.factory,
    });
    expect(byArea.width * byArea.height).toBeLessThanOrEqual(500_000);
    expect(fitScale(100, 100, 3, 16384, 16_777_216)).toBe(3);
  });

  it('throws unsupported-environment without a canvas', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 10, h: 10 });
    await expect(exportPNG(board, { createCanvas: () => null })).rejects.toMatchObject({
      code: 'unsupported-environment',
    });
  });

  it('reads images with CORS before painting and draws a placeholder when that fails', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 64, height: 32 }));
    const board = setup({ ok: 'https://cdn.example/ok.png', cors: 'https://other.example/x.png' });
    board.create({ id: 'ok', type: 'image', x: 0, y: 0, w: 64, h: 32, props: { assetId: 'ok' } });
    board.create({
      id: 'cors',
      type: 'image',
      x: 100,
      y: 0,
      w: 64,
      h: 32,
      props: { assetId: 'cors' },
    });
    const canvas = fakeCanvas();
    const result = await exportPNG(board, {
      fetch: fetchFrom(['https://cdn.example/ok.png']),
      createCanvas: canvas.factory,
    });
    expect(canvas.calls).toContain('drawImage(img,0,0,64,32)');
    expect(canvas.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(1);
    expect(canvas.calls).toContain('fillText(Gambar tidak tersedia,32,16,56)');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'image-cors', elementId: 'cors' }),
    ]);
  });

  it('preloads drawThumbnail images of custom elements with CORS', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 10, height: 10 }));
    const board = setup();
    board.create({
      id: 'c',
      type: 'card',
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      props: { thumb: 'https://cdn.example/t.png' },
    });
    board.create({
      id: 'd',
      type: 'card',
      x: 50,
      y: 0,
      w: 40,
      h: 40,
      props: { thumb: 'https://other.example/t.png' },
    });
    const canvas = fakeCanvas();
    const result = await exportPNG(board, {
      fetch: fetchFrom(['https://cdn.example/t.png']),
      createCanvas: canvas.factory,
    });
    expect(canvas.calls.filter((c) => c.startsWith('drawImage'))).toEqual([
      'drawImage(img,0,0,40,40)',
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'image-cors', elementId: 'd' }),
    ]);
  });

  it('paints again with custom elements as placeholders when the canvas is tainted', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 10, h: 10 });
    board.create({ type: 'card', x: 20, y: 0, w: 10, h: 10, props: { thumb: '' } });
    const canvas = fakeCanvas(1);
    const result = await exportPNG(board, { createCanvas: canvas.factory });
    expect(canvas.sizes).toHaveLength(2);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'tainted' })]);
    expect(result.data.type).toBe('image/png');
  });

  it('falls back to render.canvas when export.svg cannot be rasterized, and placeholders HTML-only elements', async () => {
    const board = setup();
    board.create({ id: 'v', type: 'vector-card', x: 0, y: 0, w: 10, h: 10 });
    board.create({ id: 'h', type: 'html', x: 20, y: 0, w: 10, h: 10 });
    const canvas = fakeCanvas();
    const result = await exportPNG(board, { createCanvas: canvas.factory });
    expect(canvas.calls).toContain('fillRect(0,0,1,1)');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'raster-unavailable', elementId: 'v' }),
    ]);
  });
});

describe('BOARD-1708: client thumbnail', () => {
  it('paints the page compactly into the requested width', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 1000, h: 500 });
    const canvas = fakeCanvas();
    const result = await createThumbnail(board, {
      width: 200,
      padding: 0,
      createCanvas: canvas.factory,
    });
    expect([result.width, result.height]).toEqual([200, 100]);
    expect(result.blob.type).toBe('image/png');
    expect(typeof result.paintMs).toBe('number');
    expect(lods).toEqual([{ zoom: 0.2, compact: true }]);
    expect(canvas.calls).toContain('setTransform(0.2,0,0,0.2,0,0)');
  });

  it('fits content into a fixed size, caps tall content, and handles empty pages', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 100, h: 1000 });
    const tall = await createThumbnail(board, {
      width: 100,
      padding: 0,
      createCanvas: fakeCanvas().factory,
    });
    expect(tall.height).toBe(200);
    const fixed = await createThumbnail(board, {
      width: 300,
      height: 100,
      createCanvas: fakeCanvas().factory,
      type: 'image/webp',
      quality: 0.8,
    });
    expect([fixed.width, fixed.height]).toEqual([300, 100]);
    expect(fixed.blob.type).toBe('image/webp');

    const empty = await createThumbnail(setup(), { createCanvas: fakeCanvas().factory });
    expect(empty.width).toBe(400);
    await expect(createThumbnail(board, { createCanvas: () => null })).rejects.toMatchObject({
      code: 'unsupported-environment',
    });
    await expect(createThumbnail(board, { width: 0 })).rejects.toMatchObject({
      code: 'invalid-options',
    });
  });

  it('paints 1,000 elements quickly', async () => {
    const board = setup();
    board.transact((tx) => {
      for (let i = 0; i < 1000; i++) {
        tx.put({
          id: `s${i}`,
          kind: 'element',
          type: 'sticky',
          pageId: board.pages.current,
          parentId: null,
          index: `a${String(i).padStart(4, '0')}`,
          x: (i % 40) * 220,
          y: Math.floor(i / 40) * 220,
          w: 200,
          h: 200,
          rotation: 0,
          locked: false,
          opacity: 1,
          props: {},
          meta: {},
        });
      }
    });
    const result = await createThumbnail(board, { width: 320, createCanvas: fakeCanvas().factory });
    expect(lods).toHaveLength(1000);
    expect(result.paintMs).toBeLessThan(200);
  });
});
