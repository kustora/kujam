/**
 * Integration of `@kujam/export` with the real built-in elements of `@kujam/shapes`
 * (BOARD-1702, BOARD-1703, BOARD-1704, BOARD-1708). The export package cannot import shapes,
 * so this lives in the playground, which depends on both.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBoard, type Board, type BoardDocument, type ElementLodState } from '@kujam/core';
import {
  createThumbnail,
  exportPNG,
  exportSVG,
  exportText,
  type ExportCanvasFactory,
} from '@kujam/export';
import { defaultElements } from '@kujam/shapes';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const kitchenSink = JSON.parse(
  readFileSync(resolve(__dirname, '../../../fixtures/documents/0.1.0/kitchen-sink.json'), 'utf8'),
) as BoardDocument;

let boards: Board[] = [];
afterEach(() => {
  for (const b of boards) b.dispose();
  boards = [];
  vi.unstubAllGlobals();
});

function seed(): Board {
  const board = createBoard({
    plugins: [defaultElements],
    document: kitchenSink,
    assets: { resolve: (id) => (id === 'asset:logo' ? PNG_1PX : null) },
  });
  boards.push(board);
  board.create({
    id: 'frame:a',
    type: 'frame',
    x: 0,
    y: 1200,
    w: 600,
    h: 400,
    props: { name: 'Retro <Sprint>', fill: 'surface', clip: true },
  });
  board.create({
    id: 'sticky:in-frame',
    type: 'sticky',
    parentId: 'frame:a',
    x: 40,
    y: 1260,
    w: 200,
    h: 200,
    props: { text: [{ insert: 'Di dalam frame & "aman"\n' }], color: 'green', authorId: null },
  });
  board.create({
    id: 'line:a',
    type: 'line',
    x: 700,
    y: 1200,
    w: 200,
    h: 100,
    props: {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 0 },
      ],
      endArrow: 'arrow',
    },
  });
  board.create({
    id: 'connector:a',
    type: 'connector',
    x: 700,
    y: 1400,
    w: 300,
    h: 10,
    props: {
      start: { x: 0, y: 0 },
      end: { x: 300, y: 0 },
      label: [{ insert: 'mengalir ke\n', attributes: { bold: true } }],
    },
  });
  board.create({ id: 'group:a', type: 'group', x: 1100, y: 1200, w: 300, h: 200 });
  board.create({
    id: 'geo:in-group',
    type: 'geo',
    parentId: 'group:a',
    x: 1100,
    y: 1200,
    w: 140,
    h: 100,
    props: { geo: 'ellipse', fill: 'solid', label: [{ insert: 'Lingkaran\n' }] },
  });
  board.create({
    id: 'image:a',
    type: 'image',
    x: 1500,
    y: 1200,
    w: 160,
    h: 120,
    props: { assetId: 'asset:logo', alt: 'Logo', crop: { x: 0.25, y: 0, w: 0.5, h: 1 } },
  });
  return board;
}

/** Fake 2D context: records `fillText` and every render call's LOD, measures nothing. */
function fakeCanvas(texts: string[] = []): ExportCanvasFactory {
  return () => {
    const context = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => {
        if (key in target) return target[key as string];
        if (key === 'measureText') return (t: string) => ({ width: t.length * 7 });
        if (key === 'fillText') return (t: string) => texts.push(t);
        return () => {};
      },
      set: (target, key, value) => {
        target[key as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { context, toBlob: async (type) => new Blob([new Uint8Array([1])], { type }) };
  };
}

describe('export with the built-in elements', () => {
  it('BOARD-1702: exports every built-in element as well-formed, script-free vector SVG', async () => {
    const board = seed();
    const result = await exportSVG(board, { images: 'url' });
    const svg = result.data;
    expect(result.warnings).toEqual([]);

    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(svg).not.toMatch(/<script|foreignObject|onload=|javascript:/i);

    // Text stays text: sticky rich text, frame title, geo label, connector label.
    const texts = [...parsed.getElementsByTagName('text')].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(['Retro <Sprint>', 'Lingkaran', 'mengalir ke']));
    expect(texts.join(' ')).toContain('Di dalam frame & "aman"');
    expect(svg).toContain('font-weight="bold"');
    // Line with an arrowhead, freehand strokes, and shapes are paths.
    expect(parsed.getElementsByTagName('path').length).toBeGreaterThan(10);
    // The image is cropped through a nested viewport and keeps its URL.
    expect(svg).toContain('viewBox="250 0 500 1000"');
    expect(svg).toContain(`href="${PNG_1PX}"`);
    // Children of the clipping frame are clipped to it.
    expect(svg).toMatch(
      /<clipPath id="[^"]+"><rect x="0" y="1200" width="600" height="400"\/><\/clipPath>/,
    );
  });

  it('BOARD-1702: exports one frame cropped to it', async () => {
    const board = seed();
    const result = await exportSVG(board, { frameId: 'frame:a' });
    expect(result.data).toContain('viewBox="0 1200 600 400"');
    expect(result.data).toContain('>Di dalam</text>');
    expect(result.data).not.toContain('Lingkaran');
  });

  it('BOARD-1703: paints the built-in elements onto a canvas with their own text', async () => {
    // happy-dom cannot decode images (its <img> never loads).
    vi.stubGlobal('Image', undefined);
    const board = seed();
    const texts: string[] = [];
    const result = await exportPNG(board, {
      scale: 2,
      createCanvas: fakeCanvas(texts),
      // Without a decoder the image element becomes a placeholder with a warning.
      fetch: async () => ({
        ok: true,
        blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
      }),
    });
    expect(texts).toEqual(expect.arrayContaining(['Retro <Sprint>', 'Lingkaran']));
    expect(result.warnings.map((w) => w.code)).toEqual(['image-unavailable']);
  });

  it('BOARD-1704: exports the text per frame, then in reading order', () => {
    const board = seed();
    const text = exportText(board);
    const frameAt = text.indexOf('Retro <Sprint>');
    expect(frameAt).toBeGreaterThan(-1);
    expect(text.indexOf('Di dalam frame & "aman"')).toBeGreaterThan(frameAt);
    expect(text).toContain('mengalir ke');
    expect(text).toContain('Lingkaran');
    expect(text).toContain('Logo');
    expect(exportText(board, { frameId: 'frame:a' })).toBe(
      'Retro <Sprint>\n\nDi dalam frame & "aman"',
    );
  });

  it('BOARD-1708: paints a 1,000-element thumbnail in under 200 ms with compact rendering', async () => {
    const board = createBoard({ plugins: [defaultElements] });
    boards.push(board);
    const lods: ElementLodState[] = [];
    const def = board.elements.get('sticky')!;
    const canvas = def.render!.canvas!;
    // Spy on the compact flag without changing the drawing.
    (def.render as { canvas: typeof canvas }).canvas = (g, el, data, lod, ctx) => {
      lods.push(lod);
      canvas(g, el, data, lod, ctx);
    };
    try {
      board.transact((tx) => {
        for (let i = 0; i < 1000; i++) {
          const kind = i % 4;
          const base = {
            id: `e${i}`,
            kind: 'element' as const,
            pageId: board.pages.current,
            parentId: null,
            index: `a${String(i).padStart(4, '0')}`,
            x: (i % 40) * 240,
            y: Math.floor(i / 40) * 240,
            w: 200,
            h: 200,
            rotation: 0,
            locked: false,
            opacity: 1,
            meta: {},
          };
          if (kind === 0 || kind === 1) {
            tx.put({
              ...base,
              type: 'sticky',
              props: {
                text: [{ insert: `Catatan nomor ${i}\nbaris kedua\n` }],
                color: 'yellow',
                authorId: null,
              },
            });
          } else if (kind === 2) {
            tx.put({
              ...base,
              type: 'geo',
              props: {
                geo: 'rectangle',
                fill: 'semi',
                fillColor: 'blue',
                strokeColor: 'black',
                strokeWidth: 2,
                dash: 'solid',
                label: [{ insert: 'Kotak\n' }],
                textColor: 'black',
              },
            });
          } else {
            tx.put({
              ...base,
              type: 'draw',
              props: {
                points: Array.from({ length: 50 }, (_, k) => [
                  k * 4,
                  Math.sin(k / 5) * 40 + 100,
                  0.5,
                ]),
                color: 'black',
                thickness: 4,
                brush: 'pen',
              },
            });
          }
        }
      });
      // Warm up module caches, as a long-open board would have.
      await createThumbnail(board, { width: 320, createCanvas: fakeCanvas() });
      lods.length = 0;
      const result = await createThumbnail(board, { width: 320, createCanvas: fakeCanvas() });
      expect(lods).toHaveLength(500);
      expect(lods.every((lod) => lod.compact)).toBe(true);
      expect(result.paintMs).toBeLessThan(200);
    } finally {
      (def.render as { canvas: typeof canvas }).canvas = canvas;
    }
  });
});
