/**
 * Export lab logic (BOARD-2413): options in the query string, scopes, and the export call.
 */

import { createBoard, type Board } from '@kujam/core';
import { defaultElements } from '@kujam/shapes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LAB_OPTIONS,
  formatBytes,
  labFileName,
  LabScopeError,
  listFrames,
  readLabOptions,
  runLabExport,
  writeLabOptions,
  type LabExporters,
  type LabOptions,
} from './export-lab.js';
import type { ScenarioState } from './scenario.js';

let boards: Board[] = [];
afterEach(() => {
  for (const b of boards) b.dispose();
  boards = [];
});

function memoryState(initial: Record<string, string> = {}): ScenarioState & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      if (value === null) values.delete(key);
      else values.set(key, value);
    },
  };
}

function seed(): Board {
  const board = createBoard({ plugins: [defaultElements] });
  boards.push(board);
  board.create({ id: 'note', type: 'sticky', x: 0, y: 0, w: 200, h: 200 });
  board.create({
    id: 'frame:b',
    type: 'frame',
    x: 400,
    y: 0,
    w: 300,
    h: 300,
    props: { name: 'Zeta Plan' },
  });
  board.create({
    id: 'frame:a',
    type: 'frame',
    x: 800,
    y: 0,
    w: 300,
    h: 300,
    props: { name: 'Alpha Retro' },
  });
  return board;
}

/** Exporters that record their options and return small fixed results. */
function fakeExporters(): LabExporters & { calls: { name: string; options: unknown }[] } {
  const calls: { name: string; options: unknown }[] = [];
  return {
    calls,
    exportPNG: vi.fn(async (_board, options) => {
      calls.push({ name: 'png', options });
      return {
        format: 'png' as const,
        mimeType: 'image/png' as const,
        data: new Blob([new Uint8Array(10)], { type: 'image/png' }),
        width: 400,
        height: 300,
        scale: 1.5,
        warnings: [{ code: 'image-failed' as never, message: 'gagal', elementId: 'x' }],
      };
    }),
    exportSVG: vi.fn(async (_board, options) => {
      calls.push({ name: 'svg', options });
      return {
        format: 'svg' as const,
        mimeType: 'image/svg+xml' as const,
        data: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        width: 100,
        height: 50,
        warnings: [],
      };
    }),
    exportPDF: vi.fn(async (_board, options) => {
      calls.push({ name: 'pdf', options });
      return {
        format: 'pdf' as const,
        mimeType: 'application/pdf' as const,
        data: new Blob([new Uint8Array(20)], { type: 'application/pdf' }),
        pageCount: 2,
        warnings: [],
      };
    }),
    exportText: vi.fn((_board, options) => {
      calls.push({ name: 'text', options });
      return 'halo';
    }),
    exportJSON: vi.fn((_board, options) => {
      calls.push({ name: 'json', options });
      return { schemaVersion: 1 } as never;
    }),
  };
}

const opts = (patch: Partial<LabOptions>): LabOptions => ({ ...DEFAULT_LAB_OPTIONS, ...patch });

describe('BOARD-2413: export lab options', () => {
  it('reads defaults and falls back for invalid values', () => {
    expect(readLabOptions(memoryState())).toEqual(DEFAULT_LAB_OPTIONS);
    expect(
      readLabOptions(
        memoryState({ format: 'gif', scope: 'all', scale: '9', bg: 'red', padding: '-4' }),
      ),
    ).toEqual(DEFAULT_LAB_OPTIONS);
  });

  it('round-trips options through the query string, leaving defaults out', () => {
    const state = memoryState();
    const options = opts({
      format: 'svg',
      scope: 'frame',
      frameId: 'frame:a',
      scale: 3,
      background: '#ff00aa',
      padding: 24,
    });
    writeLabOptions(state, options);
    expect(readLabOptions(state)).toEqual(options);

    writeLabOptions(state, DEFAULT_LAB_OPTIONS);
    expect([...state.values.keys()]).toEqual([]);
  });

  it('drops the frame id unless the frame scope is chosen', () => {
    const state = memoryState();
    writeLabOptions(state, opts({ scope: 'board', frameId: 'frame:a' }));
    expect(state.get('frame')).toBeNull();
  });

  it('lists frames by name', () => {
    expect(listFrames(seed())).toEqual([
      { id: 'frame:a', name: 'Alpha Retro' },
      { id: 'frame:b', name: 'Zeta Plan' },
    ]);
  });
});

describe('BOARD-2413: export lab runs', () => {
  it('exports PNG with scale, background, and padding, reporting the scale actually used', async () => {
    const board = seed();
    const exporters = fakeExporters();
    let t = 0;
    const result = await runLabExport(
      board,
      opts({ format: 'png', scale: 4, background: 'transparent', padding: 8 }),
      exporters,
      () => (t += 5),
    );
    expect(exporters.calls[0]).toEqual({
      name: 'png',
      options: { ids: undefined, frameId: undefined, background: false, padding: 8, scale: 4 },
    });
    expect(result).toMatchObject({
      format: 'png',
      width: 400,
      height: 300,
      scale: 1.5,
      fileName: 'kujam-papan.png',
      ms: 5,
    });
    expect(result.warnings).toHaveLength(1);
  });

  it('exports the selection, or one frame cropped to it', async () => {
    const board = seed();
    const exporters = fakeExporters();
    board.select(['note']);
    await runLabExport(board, opts({ format: 'svg', scope: 'selection' }), exporters);
    const frame = await runLabExport(
      board,
      opts({ format: 'svg', scope: 'frame', frameId: 'frame:a', background: '#123456' }),
      exporters,
    );
    expect(exporters.calls.map((c) => c.options)).toEqual([
      { ids: ['note'], frameId: undefined, background: true, scale: 2 },
      { ids: undefined, frameId: 'frame:a', background: '#123456', scale: 2 },
    ]);
    expect(frame.fileName).toBe('kujam-frame-alpha-retro.svg');
    expect(frame.text).toContain('<svg');
    expect(frame.blob.type).toBe('image/svg+xml');
  });

  it('exports text and JSON without image options; a frame JSON keeps the frame', async () => {
    const board = seed();
    const exporters = fakeExporters();
    const text = await runLabExport(board, opts({ format: 'text', scale: 4 }), exporters);
    const json = await runLabExport(
      board,
      opts({ format: 'json', scope: 'frame', frameId: 'frame:b' }),
      exporters,
    );
    expect(exporters.calls).toEqual([
      { name: 'text', options: { ids: undefined, frameId: undefined } },
      { name: 'json', options: { ids: ['frame:b'] } },
    ]);
    expect(text).toMatchObject({ text: 'halo', fileName: 'kujam-papan.txt', width: null });
    expect(json.text).toBe('{\n  "schemaVersion": 1\n}');
    expect(json.fileName).toBe('kujam-frame-zeta-plan.json');
  });

  it('exports a PDF of every frame, or of one frame; not of a selection (BOARD-1705)', async () => {
    const board = seed();
    const exporters = fakeExporters();
    const all = await runLabExport(board, opts({ format: 'pdf', scale: 3 }), exporters);
    await runLabExport(
      board,
      opts({ format: 'pdf', scope: 'frame', frameId: 'frame:a', background: 'transparent' }),
      exporters,
    );
    expect(exporters.calls).toEqual([
      { name: 'pdf', options: { background: true, scale: 3 } },
      { name: 'pdf', options: { background: false, scale: 2, frameIds: ['frame:a'] } },
    ]);
    expect(all).toMatchObject({ format: 'pdf', pages: 2, fileName: 'kujam-papan.pdf' });
    expect(all.blob.type).toBe('application/pdf');

    board.select(['note']);
    await expect(
      runLabExport(board, opts({ format: 'pdf', scope: 'selection' }), exporters),
    ).rejects.toThrow(LabScopeError);
  });

  it('rejects an empty selection and an unknown frame', async () => {
    const board = seed();
    const exporters = fakeExporters();
    await expect(runLabExport(board, opts({ scope: 'selection' }), exporters)).rejects.toThrow(
      LabScopeError,
    );
    await expect(
      runLabExport(board, opts({ scope: 'frame', frameId: 'note' }), exporters),
    ).rejects.toThrow(LabScopeError);
    expect(exporters.calls).toEqual([]);
  });

  it('runs the real exporters for text and JSON', async () => {
    const board = seed();
    board.select(['note']);
    const json = await runLabExport(board, opts({ format: 'json', scope: 'selection' }));
    const doc = JSON.parse(json.text!) as { records: Record<string, { kind: string }> };
    expect(Object.keys(doc.records)).toContain('note');
    expect(Object.keys(doc.records)).not.toContain('frame:a');
  });
});

describe('BOARD-2413: helpers', () => {
  it('formats sizes and file names', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
    expect(labFileName('text', 'seleksi')).toBe('kujam-seleksi.txt');
  });
});
