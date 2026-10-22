import {
  boolean,
  createBoard,
  defineElement,
  definePlugin,
  object,
  string,
  type AnyPluginDefinition,
  type Board,
} from '@kujam/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportError, exportImage, exportText, listExportFormats } from './index.js';

const sticky = defineElement({
  type: 'sticky',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
  render: {
    canvas: (g, el) => {
      g.fillRect(0, 0, el.w, el.h);
    },
  },
  export: { text: (el) => el.props.text },
});
const frame = defineElement({
  type: 'frame',
  version: 1,
  props: object({ name: string(), clip: boolean() }),
  defaults: { name: '', clip: true },
  export: { text: (el) => el.props.name },
});
const card = defineElement({
  type: 'card',
  version: 1,
  props: object({ itemId: string() }),
  defaults: { itemId: '' },
  resolve: (el) => ({ title: `Item ${el.props.itemId}` }),
  export: { text: (_el, data: { title: string } | undefined) => data?.title ?? 'Item' },
});
const failing = defineElement({
  type: 'failing',
  version: 1,
  props: object({}),
  defaults: {},
  export: {
    text: () => {
      throw new Error('boom');
    },
  },
});
const silent = defineElement({ type: 'silent', version: 1, props: object({}), defaults: {} });
const elements = definePlugin({
  id: 'text-test',
  elements: [sticky, frame, card, failing, silent],
});

let boards: Board[] = [];
afterEach(() => {
  for (const b of boards) b.dispose();
  boards = [];
});

function setup(plugins: AnyPluginDefinition[] = [elements]): Board {
  const board = createBoard({ plugins });
  boards.push(board);
  return board;
}

describe('BOARD-1704: plain-text export', () => {
  it('orders text per frame, then by reading position (top to bottom, left to right)', () => {
    const board = setup();
    board.create({
      id: 'late',
      type: 'sticky',
      x: 0,
      y: 900,
      w: 100,
      h: 100,
      props: { text: 'Paling bawah' },
    });
    board.create({
      id: 'f',
      type: 'frame',
      x: 0,
      y: 100,
      w: 600,
      h: 400,
      props: { name: 'Sprint 12', clip: true },
    });
    board.create({
      id: 'f2',
      type: 'sticky',
      parentId: 'f',
      x: 300,
      y: 120,
      w: 100,
      h: 100,
      props: { text: 'Kanan' },
    });
    board.create({
      id: 'f1',
      type: 'sticky',
      parentId: 'f',
      x: 20,
      y: 130,
      w: 100,
      h: 100,
      props: { text: 'Kiri' },
    });
    board.create({
      id: 'f3',
      type: 'sticky',
      parentId: 'f',
      x: 20,
      y: 300,
      w: 100,
      h: 100,
      props: { text: 'Baris dua\r\nbaris tiga' },
    });
    board.create({
      id: 'top-right',
      type: 'sticky',
      x: 800,
      y: 0,
      w: 100,
      h: 100,
      props: { text: 'Atas kanan' },
    });
    board.create({
      id: 'top-left',
      type: 'sticky',
      x: 0,
      y: 0,
      w: 100,
      h: 60,
      props: { text: 'Atas kiri' },
    });

    expect(exportText(board)).toBe(
      [
        'Atas kiri',
        'Atas kanan',
        'Sprint 12',
        'Kiri',
        'Kanan',
        'Baris dua\nbaris tiga',
        'Paling bawah',
      ].join('\n\n'),
    );
    expect(exportText(board, { frameId: 'f', separator: '\n' })).toBe(
      'Sprint 12\nKiri\nKanan\nBaris dua\nbaris tiga',
    );
    expect(exportText(board, { ids: ['late', 'top-left'] })).toBe('Atas kiri\n\nPaling bawah');
  });

  it('uses export.text of custom elements with their loaded data and skips failures (BOARD-1212)', () => {
    const board = setup();
    board.create({ id: 'c', type: 'card', x: 0, y: 0, w: 10, h: 10, props: { itemId: '7' } });
    board.create({ id: 'x', type: 'failing', x: 0, y: 20, w: 10, h: 10 });
    board.create({ id: 's', type: 'silent', x: 0, y: 40, w: 10, h: 10 });
    board.create({ id: 'e', type: 'sticky', x: 0, y: 60, w: 10, h: 10, props: { text: '   ' } });
    // Data not loaded yet: export.text gets `undefined`.
    expect(exportText(board)).toBe('Item');
    board.getElementData('c');
    expect(exportText(board)).toBe('Item 7');
  });

  it('returns an empty string for an empty page and validates options', () => {
    const board = setup();
    expect(exportText(board)).toBe('');
    expect(exportText(board, { ids: ['missing'] })).toBe('');
    expect(() => exportText(board, { frameId: 'nope' })).toThrow(ExportError);
    expect(() => exportText(board, { separator: 1 as never })).toThrow(ExportError);
  });
});

describe('BOARD-1707: unified exportImage API', () => {
  const pdf = definePlugin({
    id: 'pdf-plugin',
    exporters: [
      {
        format: 'pdf',
        label: 'export.pdf',
        export: async (_board, options) => ({ pdf: true, options }),
      },
      { format: 'png', export: () => 'hijack' },
    ],
  });
  const second = definePlugin({
    id: 'second',
    exporters: [
      { format: 'pdf', export: () => 'second' },
      { format: 'md', export: () => new Blob(['# x'], { type: 'text/markdown' }) },
    ],
  });

  it('dispatches svg and png to the built-in exporters', async () => {
    const board = setup();
    board.create({ type: 'sticky', x: 0, y: 0, w: 10, h: 10 });
    const svg = await exportImage(board, { format: 'svg', scale: 2, background: false });
    expect(svg.format).toBe('svg');
    expect(svg.width).toBe(84);
    expect(svg.data).toContain('<svg');
    await expect(
      exportImage(board, { format: 'png', createCanvas: () => null }),
    ).rejects.toMatchObject({
      code: 'unsupported-environment',
    });
  });

  it('runs plugin exporters registered through definePlugin({ exporters })', async () => {
    const board = setup([elements, pdf, second]);
    expect(listExportFormats(board)).toEqual([
      { format: 'png', label: 'PNG', source: 'built-in' },
      { format: 'svg', label: 'SVG', source: 'built-in' },
      { format: 'pdf', label: 'export.pdf', source: 'pdf-plugin' },
      { format: 'md', label: 'md', source: 'second' },
    ]);
    const result = await exportImage(board, { format: 'pdf', ids: ['a'], scale: 2 });
    expect(result).toEqual({
      format: 'pdf',
      mimeType: '',
      data: { pdf: true, options: { format: 'pdf', ids: ['a'], scale: 2 } },
      warnings: [],
    });
    const md = await exportImage(board, { format: 'md' });
    expect(md.mimeType).toBe('text/markdown');
  });

  it('rejects unknown formats', async () => {
    const board = setup();
    await expect(exportImage(board, { format: 'gif' })).rejects.toMatchObject({
      code: 'unsupported-format',
    });
    await expect(exportImage(board, {} as never)).rejects.toMatchObject({
      code: 'invalid-options',
    });
  });
});
