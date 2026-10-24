import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createBoard,
  InvalidDocumentError,
  type BindingRecord,
  type BoardRecord,
  type ElementRecord,
} from '@kujam/core';
import { describe, expect, it } from 'vitest';
import { excalidrawToDocument, importExcalidraw } from './index.js';

const FIXTURE = readFileSync(
  resolve(__dirname, '../../../fixtures/excalidraw/basic.excalidraw'),
  'utf8',
);

function convert(input: unknown = FIXTURE) {
  const result = excalidrawToDocument(input);
  const records = Object.values(result.document.records);
  const element = (sourceId: string): ElementRecord => {
    const id = result.idMap.get(sourceId);
    const rec = id === undefined ? undefined : result.document.records[id];
    if (rec?.kind !== 'element') throw new Error(`Elemen untuk ${sourceId} tidak ada.`);
    return rec;
  };
  return { ...result, records, element };
}

function el(type: string, extra: Record<string, unknown> = {}) {
  return {
    id: `${type}-x`,
    type,
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    isDeleted: false,
    ...extra,
  };
}

function file(...elements: unknown[]) {
  return { type: 'excalidraw', version: 2, elements, files: {} };
}

describe('excalidrawToDocument (BOARD-1706)', () => {
  it('menolak input yang bukan Excalidraw', () => {
    expect(() => excalidrawToDocument('{oops')).toThrow(InvalidDocumentError);
    expect(() => excalidrawToDocument({ records: {} })).toThrow(InvalidDocumentError);
    expect(() => excalidrawToDocument({ type: 'tldraw', elements: [] })).toThrow(
      InvalidDocumentError,
    );
  });

  it('menerima payload clipboard dan objek yang sudah di-parse', () => {
    const clip = { type: 'excalidraw/clipboard', elements: [el('rectangle')], files: {} };
    expect(convert(clip).idMap.size).toBe(1);
  });

  it('memetakan bentuk ke geo dengan isian, garis, dan label teks terikat', () => {
    const { element } = convert();
    const rect = element('rect-1');
    expect(rect).toMatchObject({ type: 'geo', x: 0, y: 0, w: 200, h: 100 });
    expect(rect.props).toMatchObject({
      geo: 'rounded-rectangle',
      fill: 'solid',
      fillColor: 'red',
      strokeColor: 'black',
      label: [{ insert: 'Backlog\n' }],
    });

    expect(element('ellipse-1').props).toMatchObject({
      geo: 'ellipse',
      fill: 'semi',
      fillColor: 'blue',
      strokeColor: 'blue',
      dash: 'dashed',
    });
    expect(element('diamond-1').props).toMatchObject({
      geo: 'diamond',
      fill: 'none',
      strokeColor: 'green',
    });
  });

  it('teks terikat tidak diimpor dua kali sebagai elemen teks sendiri', () => {
    const { idMap, records } = convert();
    expect(idMap.has('label-1')).toBe(false);
    expect(idMap.has('arrow-label')).toBe(false);
    const texts = records.filter((r) => r.kind === 'element' && r.type === 'text');
    expect(texts).toHaveLength(1);
  });

  it('memetakan teks: ukuran terdekat, perataan logis, mode lebar, dan warna', () => {
    const text = convert().element('text-1');
    expect(text).toMatchObject({ type: 'text', x: 200, y: 330, w: 180, h: 50 });
    expect(text.props).toEqual({
      text: [{ insert: 'Line one\nLine two\n' }],
      size: 'l',
      align: 'end',
      widthMode: 'fixed',
      color: 'red',
    });
  });

  it('panah terikat jadi konektor dengan binding dan label', () => {
    const { element, records } = convert();
    const arrow = element('arrow-1');
    expect(arrow).toMatchObject({ type: 'connector', x: 200, y: 50, w: 200, h: 25, rotation: 0 });
    const props = arrow.props as Record<string, unknown>;
    expect(props).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 200, y: 25 },
      style: 'straight',
      startArrow: 'none',
      endArrow: 'arrow',
      label: [{ insert: 'next\n' }],
    });
    const bindings = records.filter((r): r is BindingRecord => r.kind === 'binding');
    expect(bindings).toHaveLength(2);
    const start = bindings.find((b) => b.id === props.startBindingId)!;
    const end = bindings.find((b) => b.id === props.endBindingId)!;
    expect(start).toMatchObject({ fromId: arrow.id, toId: element('rect-1').id });
    // The start point (200, 50) is on the right edge of the 200 × 100 rectangle at the middle.
    expect(start.anchor).toEqual({ x: 1, y: 0.5 });
    // `fixedPoint` wins over the endpoint position.
    expect(end).toMatchObject({ toId: element('ellipse-1').id, anchor: { x: 0, y: 0.5 } });
  });

  it('panah bebas dengan banyak titik jadi garis yang mempertahankan bentuknya', () => {
    const line = convert().element('arrow-2');
    expect(line).toMatchObject({ type: 'line', x: 600, y: 300, w: 100, h: 100 });
    expect(line.props).toMatchObject({
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 100 },
        { x: 100, y: 0 },
      ],
      startArrow: 'dot',
      endArrow: 'triangle',
    });
  });

  it('memetakan garis dengan tebal dan gaya putus-putus', () => {
    const line = convert().element('line-1');
    expect(line).toMatchObject({ type: 'line', x: 600, y: 450, w: 200, h: 20 });
    expect(line.props).toMatchObject({ strokeWidth: 4, dash: 'dotted', startArrow: 'none' });
  });

  it('memetakan coretan bebas dengan tekanan dan ketebalan setara', () => {
    const draw = convert().element('draw-1');
    expect(draw).toMatchObject({ type: 'draw', x: 900, y: 100, w: 30, h: 30 });
    expect(draw.props).toMatchObject({
      points: [
        [0, 0, 0.2],
        [10, 5, 0.5],
        [20, 20, 0.7],
        [30, 30, 0.4],
      ],
      thickness: 4.25,
      brush: 'pen',
    });
  });

  it('coretan yang melewati batas titik dipecah dan tetap tersambung', () => {
    const points = Array.from({ length: 12_000 }, (_, i) => [i, i % 7]);
    const { records } = convert(file(el('freedraw', { points, pressures: [] })));
    const draws = records.filter(
      (r): r is ElementRecord => r.kind === 'element' && r.type === 'draw',
    );
    expect(draws).toHaveLength(3);
    const chunks = draws.map((d) => (d.props as { points: number[][] }).points);
    expect(chunks.every((c) => c.length <= 5000)).toBe(true);
    expect(chunks[1]![0]).toEqual(chunks[0]![chunks[0]!.length - 1]);
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(12_000 + 2);
  });

  it('memetakan gambar ke elemen gambar dengan aset data URL', () => {
    const { element, document } = convert();
    const image = element('image-1');
    expect(image).toMatchObject({ type: 'image', w: 64, h: 64 });
    const asset = document.records[(image.props as { assetId: string }).assetId];
    expect(asset).toMatchObject({ kind: 'asset', mimeType: 'image/png', w: 64, h: 64 });
    expect((asset as { meta: { url: string } }).meta.url).toMatch(/^data:image\/png;base64,/);
  });

  it('crop gambar diubah ke rasio, dan URL selain data:image tidak disalin', () => {
    const input = {
      ...file(
        el('image', {
          fileId: 'f',
          crop: { x: 10, y: 20, width: 50, height: 40, naturalWidth: 100, naturalHeight: 80 },
        }),
      ),
      files: { f: { mimeType: 'image/svg+xml', dataURL: 'javascript:alert(1)' } },
    };
    const { element, document } = convert(input);
    const image = element('image-x');
    expect((image.props as { crop: unknown }).crop).toEqual({ x: 0.1, y: 0.25, w: 0.5, h: 0.5 });
    const asset = document.records[(image.props as { assetId: string }).assetId];
    expect((asset as { meta: Record<string, unknown> }).meta.url).toBeUndefined();
  });

  it('frame menjadi induk anaknya dan berada di bawah anak-anaknya', () => {
    const { element } = convert();
    const frame = element('frame-1');
    expect(frame).toMatchObject({ type: 'frame', parentId: null });
    expect(frame.props).toEqual({ name: 'Sprint plan', fill: 'none', clip: true });
    for (const id of ['rect-1', 'ellipse-1', 'arrow-1']) {
      expect(element(id).parentId).toBe(frame.id);
      expect(element(id).index > frame.index).toBe(true);
    }
  });

  it('groupIds menjadi grup bersarang di dalam frame', () => {
    const { element, document } = convert();
    const diamond = element('diamond-1');
    const text = element('text-1');
    expect(diamond.parentId).not.toBeNull();
    expect(text.parentId).toBe(diamond.parentId);
    const group = document.records[diamond.parentId!] as ElementRecord;
    expect(group).toMatchObject({ type: 'group', parentId: element('frame-1').id, props: {} });
    expect(group.index < diamond.index).toBe(true);

    const nested = convert(
      file(
        el('rectangle', { id: 'a', groupIds: ['inner', 'outer'] }),
        el('rectangle', { id: 'b', groupIds: ['outer'] }),
      ),
    );
    const inner = nested.document.records[nested.element('a').parentId!] as ElementRecord;
    expect(inner.parentId).toBe(nested.element('b').parentId);
  });

  it('melaporkan elemen yang tidak didukung dan melewati yang terhapus tanpa laporan', () => {
    const { unsupported, idMap } = convert();
    expect(unsupported).toEqual([
      { id: 'embed-1', type: 'embeddable', reason: 'unsupported-type' },
    ]);
    expect(idMap.has('deleted-1')).toBe(false);
  });

  it('melaporkan elemen rusak, kosong, dan garis dengan titik terlalu banyak', () => {
    const many = Array.from({ length: 1001 }, (_, i) => [i, 0]);
    const { unsupported } = convert(
      file(
        el('rectangle', { id: 'nan', x: Number.NaN }),
        el('text', { id: 'blank', text: '   ' }),
        el('freedraw', { id: 'nopoints', points: 'x' }),
        el('line', { id: 'long', points: many }),
        { type: 'rectangle' },
      ),
    );
    expect(unsupported).toEqual([
      { id: 'nan', type: 'rectangle', reason: 'invalid' },
      { id: 'blank', type: 'text', reason: 'empty' },
      { id: 'nopoints', type: 'freedraw', reason: 'invalid' },
      { id: 'long', type: 'line', reason: 'too-many-points' },
      { id: '', type: 'rectangle', reason: 'invalid' },
    ]);
  });

  it('rotasi radian jadi derajat, opasitas jadi 0..1, dan kunci dipertahankan', () => {
    const { element } = convert(
      file(el('rectangle', { angle: Math.PI / 2, opacity: 40, locked: true })),
    );
    expect(element('rectangle-x')).toMatchObject({ rotation: 90, opacity: 0.4, locked: true });
  });

  it('rotasi panah dan garis dimasukkan ke titiknya', () => {
    const { element } = convert(
      file(
        el('line', {
          x: 0,
          y: 0,
          points: [
            [0, 0],
            [100, 0],
          ],
          angle: Math.PI / 2,
        }),
      ),
    );
    const line = element('line-x');
    expect(line.rotation).toBe(0);
    expect(line.x).toBeCloseTo(50);
    expect(line.y).toBeCloseTo(-50);
    expect(line.w).toBeCloseTo(0);
    expect(line.h).toBeCloseTo(100);
  });

  it('warna dipetakan ke kunci tema terdekat', () => {
    const colors: [string, string][] = [
      ['#1e1e1e', 'black'],
      ['#868e96', 'grey'],
      ['#ffffff', 'white'],
      ['#e03131', 'red'],
      ['#f08c00', 'orange'],
      ['#ffec99', 'yellow'],
      ['#2f9e44', 'green'],
      ['#1971c2', 'blue'],
      ['#6741d9', 'violet'],
      ['#c2255c', 'red'],
      ['#be4bdb', 'purple'],
      ['not-a-color', 'black'],
    ];
    const { records } = convert(
      file(...colors.map(([strokeColor], i) => el('rectangle', { id: `c${i}`, strokeColor }))),
    );
    const byIndex = records
      .filter((r): r is ElementRecord => r.kind === 'element')
      .map((r) => (r.props as { strokeColor: string }).strokeColor);
    expect(byIndex).toEqual(colors.map(([, key]) => key));
  });

  it('urutan lapisan mengikuti urutan array Excalidraw', () => {
    const { records } = convert(
      file(el('rectangle', { id: 'a' }), el('ellipse', { id: 'b' }), el('diamond', { id: 'c' })),
    );
    const elements = records.filter((r): r is ElementRecord => r.kind === 'element');
    const sorted = [...elements].sort((a, b) => (a.index < b.index ? -1 : 1));
    expect(sorted.map((e) => (e.props as { geo: string }).geo)).toEqual([
      'rectangle',
      'ellipse',
      'diamond',
    ]);
  });

  it('memakai createId dan pageId dari opsi', () => {
    let n = 0;
    const { document } = excalidrawToDocument(file(el('rectangle')), {
      createId: () => `id${n++}`,
      pageId: 'page:x',
      pageName: 'Diagram',
    });
    expect(document.records['page:x']).toMatchObject({ kind: 'page', name: 'Diagram' });
    expect(
      Object.values(document.records).every(
        (r: BoardRecord) => r.kind !== 'element' || r.pageId === 'page:x',
      ),
    ).toBe(true);
  });
});

describe('importExcalidraw (BOARD-1706)', () => {
  it('mengimpor ke halaman aktif sebagai satu langkah undo, tanpa menambah halaman', () => {
    const board = createBoard();
    const pagesBefore = board.pages.list().length;
    const result = importExcalidraw(board, FIXTURE);
    expect(board.pages.list()).toHaveLength(pagesBefore);
    expect(result.unsupported).toHaveLength(1);
    expect(result.rejected).toEqual([]);
    const rectId = result.idMap.get('rect-1')!;
    expect(board.getElement(rectId)).toMatchObject({ type: 'geo', pageId: board.pages.current });

    board.undo();
    expect(board.getElement(rectId)).toBeUndefined();
    board.dispose();
  });

  it('ke papan yang sudah berisi, ID baru dipetakan dari ID Excalidraw', () => {
    const board = createBoard();
    importExcalidraw(board, FIXTURE);
    const second = importExcalidraw(board, FIXTURE, { at: { x: 5000, y: 5000 } });
    expect(second.keptIds).toBe(false);
    const id = second.idMap.get('rect-1')!;
    expect(board.getElement(id)).toBeDefined();
    board.dispose();
  });
});
