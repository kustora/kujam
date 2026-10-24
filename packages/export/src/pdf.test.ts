import { inflateSync } from 'node:zlib';
import { createBoard, defineElement, definePlugin, object, string, type Board } from '@kujam/core';
import { PDFDocument, PDFName, PDFRawStream, type PDFPage } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExportCanvasFactory } from './environment.js';
import { ExportError, exportPDF } from './index.js';
import { collectTextRuns, parseTransform } from './pdf.js';
import { el } from './svg/xml.js';

const PNG_1PX = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);

// Stand-ins for the built-in frame and a text element (`@kujam/shapes` cannot be imported here).
const frame = defineElement({
  type: 'frame',
  version: 1,
  props: object({ name: string() }),
  defaults: { name: '' },
  render: { canvas: (g, e) => g.strokeRect(0, 0, e.w, e.h) },
});
const label = defineElement({
  type: 'label',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
  render: {
    canvas: (g, e) => {
      g.font = '20px Inter';
      g.textBaseline = 'top';
      g.fillText(e.props.text, 0, 0);
    },
  },
});
const plugin = definePlugin({ id: 'pdf-test', elements: [frame, label] });

let boards: Board[] = [];
afterEach(() => {
  for (const b of boards) b.dispose();
  boards = [];
});

function setup(): Board {
  const board = createBoard({ plugins: [plugin] });
  boards.push(board);
  return board;
}

/** Canvas that ignores drawing and encodes a valid 1 px PNG; records the requested sizes. */
function fakeCanvas(): { factory: ExportCanvasFactory; sizes: [number, number][] } {
  const sizes: [number, number][] = [];
  const factory: ExportCanvasFactory = (w, h) => {
    sizes.push([w, h]);
    const context = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => {
        if (key in target) return target[key as string];
        if (key === 'measureText') return () => ({ width: 0 });
        return () => {};
      },
      set: (target, key, value) => {
        target[key as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { context, toBlob: async (type) => new Blob([PNG_1PX], { type }) };
  };
  return { factory, sizes };
}

function addFrame(board: Board, id: string, x: number, y: number, text: string): void {
  board.create({ id, type: 'frame', x, y, w: 400, h: 200, props: { name: id } });
  board.create({
    id: `${id}-label`,
    type: 'label',
    parentId: id,
    x: x + 10,
    y: y + 10,
    w: 200,
    h: 30,
    props: { text },
  });
}

/** Decoded content streams of a page, joined. */
function pageContent(page: PDFPage): string {
  const contents = page.node.Contents();
  const refs = contents && 'asArray' in contents ? contents.asArray() : [contents];
  return refs
    .map((ref) => {
      const stream = page.doc.context.lookup(ref!);
      if (!(stream instanceof PDFRawStream)) return '';
      const filter = stream.dict.get(PDFName.of('Filter'));
      const bytes = filter ? inflateSync(stream.contents) : stream.contents;
      return Buffer.from(bytes).toString('latin1');
    })
    .join('\n');
}

function hex(text: string): string {
  return Buffer.from(text, 'latin1').toString('hex').toUpperCase();
}

describe('BOARD-1705: ekspor PDF', () => {
  it('satu frame per halaman, berurutan sesuai frames.list(), berukuran frame', async () => {
    const board = setup();
    addFrame(board, 'second', 0, 400, 'Halaman dua');
    addFrame(board, 'first', 0, 0, 'Halaman satu');
    const canvas = fakeCanvas();
    const result = await exportPDF(board, { createCanvas: canvas.factory, title: 'Rencana' });

    expect(result).toMatchObject({ format: 'pdf', mimeType: 'application/pdf', pageCount: 2 });
    expect(result.data.type).toBe('application/pdf');
    // Page images at the default scale 2.
    expect(canvas.sizes).toContainEqual([800, 400]);

    const pdf = await PDFDocument.load(await result.data.arrayBuffer());
    expect(pdf.getTitle()).toBe('Rencana');
    expect(pdf.getPageCount()).toBe(2);
    const [p1, p2] = pdf.getPages();
    expect(p1!.getSize()).toEqual({ width: 300, height: 150 });
    // Top-to-bottom order: the frame at y = 0 first.
    expect(pageContent(p1!)).toContain(hex('Halaman satu'));
    expect(pageContent(p2!)).toContain(hex('Halaman dua'));
  });

  it('teks ditulis sebagai lapisan tak terlihat (render mode 3) di atas gambar halaman', async () => {
    const board = setup();
    addFrame(board, 'f', 0, 0, 'Bisa dipilih');
    const result = await exportPDF(board, { createCanvas: fakeCanvas().factory });
    const pdf = await PDFDocument.load(await result.data.arrayBuffer());
    const content = pageContent(pdf.getPage(0));
    const image = content.indexOf(' Do');
    const text = content.indexOf(hex('Bisa dipilih'));
    expect(image).toBeGreaterThan(-1);
    expect(text).toBeGreaterThan(image);
    expect(content).toContain('3 Tr');
  });

  it('frameIds memilih dan mengurutkan halaman; frame tak dikenal ditolak', async () => {
    const board = setup();
    addFrame(board, 'a', 0, 0, 'A');
    addFrame(board, 'b', 0, 400, 'B');
    const canvas = fakeCanvas();
    const result = await exportPDF(board, { frameIds: ['b'], createCanvas: canvas.factory });
    expect(result.pageCount).toBe(1);
    const pdf = await PDFDocument.load(await result.data.arrayBuffer());
    expect(pageContent(pdf.getPage(0))).toContain(hex('B'));

    await expect(
      exportPDF(board, { frameIds: ['a-label'], createCanvas: canvas.factory }),
    ).rejects.toMatchObject({ code: 'frame-not-found' });
    await expect(
      exportPDF(board, { frameIds: [], createCanvas: canvas.factory }),
    ).rejects.toBeInstanceOf(ExportError);
  });

  it('halaman tanpa frame menjadi satu halaman berisi seluruh konten', async () => {
    const board = setup();
    board.create({ id: 't', type: 'label', x: 0, y: 0, w: 100, h: 30, props: { text: 'Bebas' } });
    const result = await exportPDF(board, { createCanvas: fakeCanvas().factory });
    expect(result.pageCount).toBe(1);
    const pdf = await PDFDocument.load(await result.data.arrayBuffer());
    // Default padding 16 around the 100 × 30 element.
    expect(pdf.getPage(0).getSize()).toEqual({ width: 132 * 0.75, height: 62 * 0.75 });
  });

  it('papan kosong melempar nothing-to-export', async () => {
    await expect(exportPDF(setup(), { createCanvas: fakeCanvas().factory })).rejects.toMatchObject({
      code: 'nothing-to-export',
    });
  });

  it('teks di luar Windows-1252 dilaporkan dan tidak masuk lapisan teks', async () => {
    const board = setup();
    addFrame(board, 'f', 0, 0, 'مرحبا');
    const result = await exportPDF(board, { createCanvas: fakeCanvas().factory });
    expect(result.warnings.map((w) => w.code)).toContain('text-not-selectable');
  });

  it('selectableText: false tidak menulis lapisan teks', async () => {
    const board = setup();
    addFrame(board, 'f', 0, 0, 'Tersembunyi');
    const result = await exportPDF(board, {
      selectableText: false,
      createCanvas: fakeCanvas().factory,
    });
    const pdf = await PDFDocument.load(await result.data.arrayBuffer());
    expect(pageContent(pdf.getPage(0))).not.toContain(hex('Tersembunyi'));
  });

  it('tanpa canvas melempar unsupported-environment', async () => {
    const board = setup();
    addFrame(board, 'f', 0, 0, 'x');
    await expect(exportPDF(board, { createCanvas: () => null })).rejects.toMatchObject({
      code: 'unsupported-environment',
    });
  });
});

describe('BOARD-1705: pembacaan pohon SVG untuk lapisan teks', () => {
  it('parseTransform menggabungkan translate, rotate, scale, dan matrix', () => {
    expect(parseTransform('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20]);
    const m = parseTransform('translate(10 0) rotate(90)');
    expect(m.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 1, -1, 0, 10, 0]);
    expect(parseTransform('scale(2) matrix(1 0 0 1 5 5)')).toEqual([2, 0, 0, 2, 10, 10]);
    expect(parseTransform(undefined)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('collectTextRuns mengikuti transform induk dan melewati defs', () => {
    const root = el('svg', { viewBox: '0 0 100 100' }, [
      el('defs', {}, [el('text', { 'font-size': 10 }, ['abaikan'])]),
      el('g', { transform: 'translate(5 6)' }, [
        el(
          'text',
          {
            x: 1,
            y: 2,
            'font-size': 12,
            'font-family': 'Inter',
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            textLength: 40,
          },
          ['Halo'],
        ),
        el('text', { 'font-size': 12 }, ['  ']),
      ]),
    ]);
    expect(collectTextRuns(root)).toEqual([
      {
        text: 'Halo',
        matrix: [1, 0, 0, 1, 5, 6],
        x: 1,
        y: 2,
        size: 12,
        font: '12px Inter',
        anchor: 'middle',
        baseline: 'central',
        length: 40,
      },
    ]);
  });
});
