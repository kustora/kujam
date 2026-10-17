import { describe, expect, it } from 'vitest';
import {
  BrushError,
  createBoard,
  DEFAULT_BRUSH_ID,
  defineBrush,
  definePlugin,
  type BrushInput,
} from './index.js';

function brushErrors(input: unknown): readonly string[] {
  try {
    defineBrush(input as BrushInput);
  } catch (error) {
    expect(error).toBeInstanceOf(BrushError);
    expect((error as BrushError).code).toBe('invalid-brush');
    return (error as BrushError).errors;
  }
  return [];
}

describe('BOARD-603: defineBrush', () => {
  it('maps perfect-freehand options and the blend mode', () => {
    const brush = defineBrush({
      id: 'marker',
      label: 'brush.marker',
      strokeOptions: {
        size: 8,
        thinning: -0.2,
        smoothing: 0.5,
        streamline: 1,
        taper: { start: 4, end: 0 },
        simulatePressure: false,
      },
      blend: 'multiply',
    });
    expect(brush).toEqual({
      id: 'marker',
      label: 'brush.marker',
      strokeOptions: {
        size: 8,
        thinning: -0.2,
        smoothing: 0.5,
        streamline: 1,
        taper: { start: 4, end: 0 },
        simulatePressure: false,
      },
      blend: 'multiply',
    });
    expect(Object.isFrozen(brush)).toBe(true);
    expect(Object.isFrozen(brush.strokeOptions)).toBe(true);
    expect(Object.isFrozen(brush.strokeOptions.taper)).toBe(true);
  });

  it('fills defaults and drops unknown stroke options', () => {
    expect(defineBrush({ id: 'plain' })).toEqual({
      id: 'plain',
      label: 'plain',
      strokeOptions: {},
      blend: 'source-over',
    });
    const brush = defineBrush({
      id: 'x',
      strokeOptions: { size: 2, taper: 3, extra: true } as BrushInput['strokeOptions'],
    });
    expect(brush.strokeOptions).toEqual({ size: 2, taper: 3 });
  });

  it('does not share the input objects', () => {
    const strokeOptions = { size: 2 };
    const brush = defineBrush({ id: 'x', strokeOptions });
    strokeOptions.size = 99;
    expect(brush.strokeOptions.size).toBe(2);
  });

  it('rejects invalid definitions with every problem listed', () => {
    expect(brushErrors(null)).toEqual(['wajib berupa objek.']);
    expect(
      brushErrors({
        id: 'Bad Id',
        label: '',
        strokeOptions: {
          size: 0,
          thinning: 2,
          smoothing: -0.1,
          streamline: Number.NaN,
          taper: -1,
          simulatePressure: 'yes',
        },
        blend: 'destination-out',
      }),
    ).toEqual([
      'id wajib huruf kecil, angka, titik, atau tanda hubung (misalnya "pen").',
      'label wajib berupa string tidak kosong.',
      'strokeOptions.size wajib berupa angka lebih dari 0.',
      'strokeOptions.thinning wajib berupa angka antara -1 dan 1.',
      'strokeOptions.smoothing wajib berupa angka antara 0 dan 1.',
      'strokeOptions.streamline wajib berupa angka antara 0 dan 1.',
      'strokeOptions.taper wajib berupa angka >= 0 atau objek { start?, end? }.',
      'strokeOptions.simulatePressure wajib berupa boolean.',
      expect.stringMatching(/^blend wajib salah satu dari: source-over, multiply/),
    ]);
    expect(brushErrors({ id: 'x', strokeOptions: [] })).toEqual([
      'strokeOptions wajib berupa objek.',
    ]);
    expect(brushErrors({ id: 'x', strokeOptions: { taper: { start: -1 } } })).toHaveLength(1);
  });

  it('accepts the range bounds', () => {
    expect(
      brushErrors({
        id: 'x',
        strokeOptions: { thinning: -1, smoothing: 0, streamline: 1, taper: 0 },
      }),
    ).toEqual([]);
  });
});

describe('BOARD-603: board.brushes', () => {
  const marker = defineBrush({ id: 'marker', blend: 'multiply' });
  const pen = defineBrush({ id: DEFAULT_BRUSH_ID, strokeOptions: { size: 3 } });

  it('registers plugin brushes, keeping defineBrush results as-is', () => {
    const board = createBoard({
      plugins: [
        definePlugin({ id: 'brushes', brushes: [pen, marker, { id: 'raw', blend: 'screen' }] }),
      ],
    });
    expect(board.brushes.list().map((b) => b.id)).toEqual(['pen', 'marker', 'raw']);
    expect(board.brushes.get('marker')).toBe(marker);
    expect(board.brushes.get('raw')).toEqual({
      id: 'raw',
      label: 'raw',
      strokeOptions: {},
      blend: 'screen',
    });
    expect(board.brushes.get('missing')).toBeUndefined();
    board.dispose();
  });

  it('resolve falls back to the registered pen, then to a built-in plain pen', () => {
    const withPen = createBoard({
      plugins: [definePlugin({ id: 'brushes', brushes: [pen, marker] })],
    });
    expect(withPen.brushes.resolve('marker')).toBe(marker);
    expect(withPen.brushes.resolve('from-another-plugin')).toBe(pen);
    expect(withPen.elementContext.resolveBrush('from-another-plugin')).toBe(pen);
    withPen.dispose();

    const bare = createBoard();
    expect(bare.brushes.resolve('anything')).toEqual({
      id: DEFAULT_BRUSH_ID,
      label: DEFAULT_BRUSH_ID,
      strokeOptions: {},
      blend: 'source-over',
    });
    bare.dispose();
  });

  it('register returns an unregister function and rejects duplicates', () => {
    const board = createBoard();
    const off = board.brushes.register(marker);
    expect(() => board.brushes.register({ id: 'marker' })).toThrow(BrushError);
    try {
      board.brushes.register({ id: 'marker' });
    } catch (error) {
      expect((error as BrushError).code).toBe('duplicate-brush');
      expect((error as BrushError).brushId).toBe('marker');
    }
    off();
    expect(board.brushes.get('marker')).toBeUndefined();

    // A stale unregister does not remove a brush registered again with the same ID.
    const again = defineBrush({ id: 'marker' });
    board.brushes.register(again);
    off();
    expect(board.brushes.get('marker')).toBe(again);
    expect(() => board.brushes.register({ id: '' })).toThrow(BrushError);
    board.dispose();
  });

  it('a brush ID used by two plugins fails installation and rolls back', () => {
    const a = definePlugin({ id: 'a', brushes: [marker] });
    const b = definePlugin({ id: 'b', brushes: [{ id: 'marker' }] });
    expect(() => createBoard({ plugins: [a, b] })).toThrow(BrushError);
  });

  it('dispose clears the registry', () => {
    const board = createBoard({ plugins: [definePlugin({ id: 'p', brushes: [marker] })] });
    board.dispose();
    expect(board.brushes.list()).toEqual([]);
  });
});
