import {
  boolean,
  createBoard,
  createEmptyDocument,
  defineElement,
  definePlugin,
  object,
  string,
  type AnyPluginDefinition,
  type Board,
} from '@kujam/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportCanvasFactory, ExportFetch } from './environment.js';
import { ExportError, exportSVG } from './index.js';

// A stand-in for a built-in vector type (`@kujam/shapes` cannot be imported here).
const sticky = defineElement({
  type: 'sticky',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
  render: {
    canvas: (g, el) => {
      g.fillStyle = '#FFE58F';
      g.fillRect(0, 0, el.w, el.h);
      g.fillStyle = '#1F2328';
      g.font = '16px Inter, sans-serif';
      g.textBaseline = 'top';
      g.fillText(el.props.text, 16, 16);
    },
  },
  export: { text: (el) => el.props.text },
});

const frame = defineElement({
  type: 'frame',
  version: 1,
  props: object({ name: string(), clip: boolean() }),
  defaults: { name: 'Frame', clip: true },
  render: {
    canvas: (g, el) => {
      g.fillStyle = '#FFFFFF';
      g.fillRect(0, 0, el.w, el.h);
    },
  },
  export: { text: (el) => el.props.name },
});

const image = defineElement({
  type: 'image',
  version: 1,
  props: object({ assetId: string() }),
  defaults: { assetId: '' },
  render: { canvas: () => {} },
});

const vectorCard = defineElement({
  type: 'vector-card',
  version: 1,
  props: object({ title: string() }),
  defaults: { title: '' },
  render: { canvas: () => {} },
  export: {
    svg: (el) =>
      `<rect width="${el.w}" height="${el.h}" fill="#eee" onclick="steal()"/><script>alert(1)</script><text y="20">${el.props.title}</text>`,
  },
});

const canvasCard = defineElement({
  type: 'canvas-card',
  version: 1,
  props: object({}),
  defaults: {},
  render: {
    canvas: (g, el) => {
      g.fillStyle = '#336699';
      g.fillRect(0, 0, el.w, el.h);
    },
  },
});

const htmlCard = defineElement({
  type: 'html-card',
  version: 1,
  props: object({}),
  defaults: {},
  render: { html: () => ({ update: () => {}, destroy: () => {} }) },
  a11y: () => ({ role: 'article', label: 'Kartu HTML' }),
});

const broken = defineElement({
  type: 'broken',
  version: 1,
  props: object({}),
  defaults: {},
  render: {
    canvas: () => {
      throw new Error('boom');
    },
  },
});

let resolveItem: ((value: { title: string }) => void) | null = null;
const dataCard = defineElement({
  type: 'data-card',
  version: 1,
  props: object({ itemId: string() }),
  defaults: { itemId: '' },
  resolve: (el, ctx) => ctx.resolvers.item!(el.props.itemId) as Promise<{ title: string }>,
  render: { canvas: () => {} },
  export: {
    svg: (_el, data) => `<text>${data?.title ?? 'none'}</text>`,
  },
});

const plugin = definePlugin({
  id: 'export-test',
  elements: [sticky, frame, image, vectorCard, canvasCard, htmlCard, broken, dataCard],
});

let boards: Board[] = [];
afterEach(() => {
  for (const b of boards) b.dispose();
  boards = [];
  resolveItem = null;
});

function setup(
  options: { assets?: Record<string, string>; plugins?: AnyPluginDefinition[] } = {},
): Board {
  const board = createBoard({
    plugins: options.plugins ?? [plugin],
    resolvers: {
      item: () =>
        new Promise((resolve) => {
          resolveItem = resolve;
        }),
    },
    ...(options.assets ? { assets: { resolve: (id: string) => options.assets![id] ?? null } } : {}),
  });
  boards.push(board);
  return board;
}

/** Records drawing calls; `toBlob` returns a fixed PNG blob. */
function fakeCanvas(calls: string[] = []): ExportCanvasFactory {
  return (w, h) => {
    calls.push(`canvas ${w}x${h}`);
    const context = new Proxy(
      {},
      {
        get: (_t, key) =>
          key === 'measureText'
            ? () => ({ width: 0 })
            : (...args: unknown[]) => calls.push(`${String(key)}(${args.join(',')})`),
        set: () => true,
      },
    ) as CanvasRenderingContext2D;
    return {
      context,
      toBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    };
  };
}

const okFetch =
  (bodies: Record<string, { type: string; bytes?: number[] }>): ExportFetch =>
  async (url) => {
    const body = bodies[url];
    if (!body) throw new TypeError('Failed to fetch');
    return {
      ok: true,
      blob: async () => new Blob([new Uint8Array(body.bytes ?? [137, 80])], { type: body.type }),
    };
  };

describe('BOARD-1702: SVG export', () => {
  it('exports the whole page with vector shapes, real text, and the theme background', async () => {
    const board = setup();
    board.create({
      id: 'a',
      type: 'sticky',
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      props: { text: 'Ide <rapat> & "fokus"' },
    });
    board.create({
      id: 'b',
      type: 'sticky',
      x: 300,
      y: 50,
      w: 100,
      h: 100,
      rotation: 45,
      opacity: 0.5,
    });
    const result = await exportSVG(board);
    expect(result.format).toBe('svg');
    expect(result.mimeType).toBe('image/svg+xml');
    expect(result.warnings).toEqual([]);
    const svg = result.data;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    // Bounds include the rotated sticky (AABB), plus 16 units of padding.
    expect(svg).toMatch(/viewBox="-16 -16 /);
    expect(svg).toContain(`fill="${board.theme.canvas.background}"`);
    expect(svg).toContain(
      '<text x="16" y="16" font-family="Inter, sans-serif" font-size="16" dominant-baseline="text-before-edge" fill="#1F2328">Ide &lt;rapat&gt; &amp; "fokus"</text>',
    );
    expect(svg).toContain('<g transform="translate(300 50) rotate(45)" opacity="0.5">');
    expect(svg).not.toContain('<script');
  });

  it('supports transparent and custom backgrounds and the scale', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 100, h: 50 });
    const transparent = await exportSVG(board, { background: false, padding: 0, scale: 2 });
    expect(transparent.data).not.toContain('<rect x=');
    expect(transparent.width).toBe(200);
    expect(transparent.height).toBe(100);
    expect(transparent.data).toContain('viewBox="0 0 100 50"');
    const colored = await exportSVG(board, { background: '#123456' });
    expect(colored.data).toContain('fill="#123456"');
    await expect(exportSVG(board, { background: 'red;}</style><script>' })).rejects.toMatchObject({
      code: 'invalid-options',
    });
    await expect(exportSVG(board, { scale: 0 })).rejects.toBeInstanceOf(ExportError);
  });

  it('exports a selection with its descendants, or one frame cropped to it', async () => {
    const board = setup();
    board.create({
      id: 'f',
      type: 'frame',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      props: { name: 'Slide', clip: true },
    });
    board.create({
      id: 'in',
      type: 'sticky',
      parentId: 'f',
      x: 350,
      y: 10,
      w: 100,
      h: 100,
      props: { text: 'dalam' },
    });
    board.create({
      id: 'out',
      type: 'sticky',
      x: 1000,
      y: 1000,
      w: 100,
      h: 100,
      props: { text: 'luar' },
    });

    const selection = await exportSVG(board, { ids: ['out', 'missing'] });
    expect(selection.data).toContain('luar');
    expect(selection.data).not.toContain('dalam');

    const withChildren = await exportSVG(board, { ids: ['f'] });
    expect(withChildren.data).toContain('dalam');
    expect(withChildren.data).not.toContain('luar');
    // The child of a clipping frame is clipped to it.
    expect(withChildren.data).toMatch(
      /<clipPath id="[^"]+"><rect x="0" y="0" width="400" height="300"\/><\/clipPath>/,
    );

    const slide = await exportSVG(board, { frameId: 'f' });
    expect(slide.data).toContain('viewBox="0 0 400 300"');
    expect(slide.width).toBe(400);
    expect(slide.data).not.toContain('luar');

    await expect(exportSVG(board, { frameId: 'out' })).rejects.toMatchObject({
      code: 'frame-not-found',
    });
    await expect(exportSVG(board, { ids: ['missing'] })).rejects.toMatchObject({
      code: 'nothing-to-export',
    });
    await expect(exportSVG(setup())).rejects.toMatchObject({ code: 'nothing-to-export' });
  });

  it('uses a custom element export.svg, sanitized, with a warning (BOARD-1212)', async () => {
    const board = setup();
    board.create({
      id: 'v',
      type: 'vector-card',
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      props: { title: 'Halo' },
    });
    const result = await exportSVG(board);
    expect(result.data).toContain('<rect width="120" height="80" fill="#eee"/>');
    expect(result.data).toContain('<text y="20">Halo</text>');
    expect(result.data).not.toMatch(/onclick|<script|alert/);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'sanitized', elementId: 'v' }),
    ]);
  });

  it('captures custom elements without export.svg as a raster image of render.canvas', async () => {
    const board = setup();
    board.create({ id: 'c', type: 'canvas-card', x: 10, y: 10, w: 50, h: 40 });
    const calls: string[] = [];
    const result = await exportSVG(board, { createCanvas: fakeCanvas(calls), rasterScale: 2 });
    // 16 units of margin on each side, at 2 pixels per unit.
    expect(calls[0]).toBe('canvas 164x144');
    expect(calls).toContain('fillRect(0,0,50,40)');
    expect(result.data).toContain(
      '<image href="data:image/png;base64,AQID" x="-16" y="-16" width="82" height="72" preserveAspectRatio="none"/>',
    );

    const noCanvas = await exportSVG(board, { createCanvas: () => null });
    expect(noCanvas.data).toContain('fill="#336699"');
    expect(noCanvas.warnings).toEqual([expect.objectContaining({ code: 'raster-unavailable' })]);

    const vector = await exportSVG(board, { customElements: 'vector' });
    expect(vector.data).toContain('<path d="M0 0L50 0L50 40L0 40Z" fill="#336699"/>');
    expect(vector.warnings).toEqual([]);
  });

  it('draws placeholders with warnings for HTML-only, unknown, and failing elements', async () => {
    const doc = createEmptyDocument();
    const page = Object.values(doc.records).find((r) => r.kind === 'page')!;
    doc.records.u = {
      id: 'u',
      kind: 'element',
      type: 'not-installed',
      pageId: page.id,
      parentId: null,
      index: 'a0',
      x: 0,
      y: 0,
      w: 50,
      h: 50,
      rotation: 0,
      locked: false,
      opacity: 1,
      props: {},
      meta: {},
    };
    const board = createBoard({ plugins: [plugin], document: doc });
    boards.push(board);
    board.create({ id: 'h', type: 'html-card', x: 100, y: 0, w: 100, h: 60 });
    board.create({ id: 'x', type: 'broken', x: 300, y: 0, w: 100, h: 60 });
    const result = await exportSVG(board, { createCanvas: fakeCanvas() });
    expect(result.warnings.map((w) => [w.code, w.elementId])).toEqual([
      ['unknown-type', 'u'],
      ['html-only', 'h'],
      ['render-error', 'x'],
    ]);
    expect(result.data).toContain('>not-installed</text>');
    expect(result.data).toContain('>Kartu HTML</text>');
  });

  it('waits for external data, and falls back to a placeholder after the timeout', async () => {
    const board = setup();
    board.create({
      id: 'd',
      type: 'data-card',
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      props: { itemId: 'p1' },
    });
    const pending = exportSVG(board);
    await vi.waitFor(() => expect(resolveItem).not.toBeNull());
    resolveItem!({ title: 'Peluncuran' });
    const result = await pending;
    expect(result.data).toContain('<text>Peluncuran</text>');

    board.invalidate('item');
    const timedOut = await exportSVG(board, { dataTimeout: 10 });
    expect(timedOut.warnings).toEqual([
      expect.objectContaining({ code: 'data-unavailable', elementId: 'd' }),
    ]);
    expect(timedOut.data).toContain('Memuat…');
  });

  it('references or embeds images resolved through the AssetAdapter', async () => {
    const board = setup({
      assets: { a1: 'https://cdn.example/a.png', bad: 'javascript:alert(1)' },
    });
    board.create({ id: 'i', type: 'image', x: 0, y: 0, w: 100, h: 80, props: { assetId: 'a1' } });

    const byUrl = await exportSVG(board, { images: 'url' });
    expect(byUrl.data).toContain(
      '<image href="https://cdn.example/a.png" x="0" y="0" width="100" height="80" preserveAspectRatio="none"/>',
    );

    const embedded = await exportSVG(board, {
      fetch: okFetch({ 'https://cdn.example/a.png': { type: 'image/png', bytes: [1, 2, 3] } }),
    });
    expect(embedded.data).toContain('href="data:image/png;base64,AQID"');
    expect(embedded.warnings).toEqual([]);

    const cors = await exportSVG(board, { fetch: okFetch({}) });
    expect(cors.data).toContain('href="https://cdn.example/a.png"');
    expect(cors.warnings).toEqual([
      expect.objectContaining({ code: 'image-cors', elementId: 'i' }),
    ]);

    board.update('i', { props: { assetId: 'bad' } });
    const unsafe = await exportSVG(board, { images: 'url' });
    expect(unsafe.data).not.toContain('javascript');
    expect(unsafe.data).toContain('Gambar tidak tersedia');
    expect(unsafe.warnings).toEqual([expect.objectContaining({ code: 'image-unavailable' })]);
  });

  it('declares fonts by reference or embeds them', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 100, h: 50 });
    const faces = [
      { family: 'Plus "Jakarta" Sans', src: 'https://fonts.example/pjs.woff2', weight: 600 },
      { family: 'Evil', src: 'javascript:alert(1)' },
    ];
    const referenced = await exportSVG(board, { fontFaces: faces });
    expect(referenced.data).toContain(
      '<style>@font-face{font-family:"Plus \\"Jakarta\\" Sans";src:url("https://fonts.example/pjs.woff2") format("woff2");font-weight:600;font-style:normal;}</style>',
    );
    expect(referenced.data).not.toContain('javascript');
    expect(referenced.warnings).toEqual([expect.objectContaining({ code: 'font-not-embedded' })]);

    const embedded = await exportSVG(board, {
      fonts: 'embed',
      fontFaces: faces.slice(0, 1),
      fetch: okFetch({ 'https://fonts.example/pjs.woff2': { type: '', bytes: [0, 1] } }),
    });
    expect(embedded.data).toContain('src:url("data:font/woff2;base64,AAE=")');

    const missing = await exportSVG(board, { fonts: 'embed' });
    expect(missing.warnings).toEqual([expect.objectContaining({ code: 'font-not-embedded' })]);
  });

  it('adds an accessible title, escaped', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 10, h: 10 });
    const result = await exportSVG(board, { title: 'Papan </title><script>' });
    expect(result.data).toContain('<title>Papan &lt;/title&gt;&lt;script&gt;</title>');
  });
});
