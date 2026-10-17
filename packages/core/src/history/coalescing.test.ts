import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  DEFAULT_MERGE_WINDOW_MS,
  defineElement,
  definePlugin,
  defineTool,
  object,
  string,
  type Board,
  type BoardDocument,
  type ChangeEvent,
  type ElementRecord,
  type InputModifiers,
  type ToolPointerEvent,
} from '../index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});

const NO_MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

function pointer(type: ToolPointerEvent['type'], x: number, y: number): ToolPointerEvent {
  return {
    type,
    pointerId: 1,
    pointerType: 'mouse',
    point: { x, y },
    screen: { x, y },
    pressure: type === 'pointer-up' ? 0 : 0.5,
    tiltX: 0,
    tiltY: 0,
    button: 0,
    buttons: type === 'pointer-up' ? 0 : 1,
    modifiers: NO_MODS,
  };
}

/** Drag tool: moves element `n` with the pointer; one `ctx.change` per pointer move. */
const moveTool = defineTool({
  id: 'test.move',
  initial: 'idle',
  states: {
    idle: { onPointerDown: () => 'dragging' },
    dragging: {
      onPointerMove(ctx, e) {
        ctx.change((tx) => tx.put({ ...(tx.get('n') as ElementRecord), x: e.point.x }), 'move');
      },
      onPointerUp: () => 'idle',
    },
  },
});

const plugin = definePlugin({ id: 'test', elements: [noteElement], tools: [moveTool] });

function setup(history?: { limit?: number; mergeWindowMs?: number }): Board {
  const board = createBoard({ plugins: [plugin], history });
  board.create({ id: 'n', type: 'note', props: { text: '' } });
  board.history.clear();
  return board;
}

function type(board: Board, text: string, mergeKey = 'text:n'): void {
  board.update('n', { props: { text } }, { mergeKey });
}

const textOf = (board: Board): string => board.getElement<{ text: string }>('n')!.props.text;

/** Undoes until nothing is left and returns how many steps were undone. */
function undoAll(board: Board): number {
  let steps = 0;
  while (board.undo()) steps++;
  return steps;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BOARD-302: coalescing continuous interactions', () => {
  it('a drag through a tool is one undo step however many transactions it makes', () => {
    const board = setup();
    const changes: ChangeEvent[] = [];
    board.on('change', (e) => changes.push(e));
    board.setTool('test.move');
    board.dispatch(pointer('pointer-down', 0, 0));
    for (let x = 1; x <= 20; x++) board.dispatch(pointer('pointer-move', x, 0));
    board.dispatch(pointer('pointer-up', 20, 0));

    expect(changes).toHaveLength(20);
    expect(board.getElement('n')!.x).toBe(20);
    expect(undoAll(board)).toBe(1);
    expect(board.getElement('n')!.x).toBe(0);
  });

  it('merges local transactions with the same mergeKey into one step', () => {
    const board = setup();
    for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
      type(board, text);
      vi.advanceTimersByTime(200);
    }
    expect(board.history.canUndo).toBe(true);
    expect(undoAll(board)).toBe(1);
    expect(textOf(board)).toBe('');
    expect(board.redo()).toBe(true);
    expect(textOf(board)).toBe('hello');
  });

  it('merges per pause: continuous typing longer than the window stays one step', () => {
    const board = setup();
    // 20 keystrokes 500 ms apart: 10 s of typing without a pause over 1 s.
    for (let i = 1; i <= 20; i++) {
      type(board, 'x'.repeat(i));
      vi.advanceTimersByTime(500);
    }
    expect(undoAll(board)).toBe(1);
  });

  it('a pause longer than the window starts a new step', () => {
    const board = setup();
    type(board, 'a');
    vi.advanceTimersByTime(DEFAULT_MERGE_WINDOW_MS);
    type(board, 'ab'); // exactly at the window edge: still merged
    vi.advanceTimersByTime(DEFAULT_MERGE_WINDOW_MS + 1);
    type(board, 'abc');
    expect(board.undo()).toBe(true);
    expect(textOf(board)).toBe('ab');
    expect(board.undo()).toBe(true);
    expect(textOf(board)).toBe('');
    expect(board.history.canUndo).toBe(false);
  });

  it('changing the key splits steps, for example per word', () => {
    const board = setup();
    let word = 0;
    for (const text of ['hi', 'hi ', 'hi there']) {
      if (text.endsWith(' ')) word++;
      type(board, text, `text:n:${word}`);
    }
    expect(board.undo()).toBe(true);
    expect(textOf(board)).toBe('hi');
    expect(board.undo()).toBe(true);
    expect(textOf(board)).toBe('');
  });

  it('transactions without a mergeKey are never merged', () => {
    const board = setup();
    board.update('n', { x: 1 });
    board.update('n', { x: 2 });
    expect(undoAll(board)).toBe(2);
  });

  it('a different key or an unkeyed transaction in between starts a new step', () => {
    const board = setup();
    type(board, 'a');
    board.update('n', { x: 5 });
    type(board, 'ab');
    board.update('n', { y: 5 }, { mergeKey: 'move:n' });
    type(board, 'abc');
    expect(undoAll(board)).toBe(5);
  });

  it('does not merge into a step after undo, and a merged new step clears redo', () => {
    const board = setup();
    type(board, 'a');
    type(board, 'ab');
    board.undo();
    type(board, 'x');
    type(board, 'xy');
    expect(board.history.canRedo).toBe(false);
    expect(board.undo()).toBe(true);
    expect(textOf(board)).toBe('');
    expect(board.history.canUndo).toBe(false);
  });

  it('a remote change in between starts a new step and is not undone', () => {
    const board = setup();
    board.create({ id: 'm', type: 'note' });
    board.history.clear();
    type(board, 'a');
    board.transact((tx) => tx.put({ ...(tx.get('m') as ElementRecord), x: 99 }), {
      origin: 'remote',
    });
    type(board, 'ab');
    expect(undoAll(board)).toBe(2);
    expect(textOf(board)).toBe('');
    expect(board.getElement('m')!.x).toBe(99);
  });

  it('a tool interaction in between starts a new step', () => {
    const board = setup();
    type(board, 'a');
    board.setTool('test.move');
    board.dispatch(pointer('pointer-down', 0, 0));
    board.dispatch(pointer('pointer-move', 7, 0));
    board.dispatch(pointer('pointer-up', 7, 0));
    type(board, 'ab');
    expect(undoAll(board)).toBe(3);
  });

  it('removes the step when merged changes cancel out', () => {
    const board = setup();
    board.create({ id: 'tmp', type: 'note' }, { mergeKey: 'scratch' });
    board.delete('tmp', { mergeKey: 'scratch' });
    expect(board.history.canUndo).toBe(false);
    expect(board.getElement('tmp')).toBeUndefined();
  });

  it('keeps the label of the first transaction and exposes mergeKey on change events', () => {
    const board = setup();
    const changes: ChangeEvent[] = [];
    board.on('change', (e) => changes.push(e));
    board.update('n', { x: 1 }, { label: 'drag', mergeKey: 'move' });
    board.update('n', { x: 2 }, { label: 'drag-end', mergeKey: 'move' });
    expect(changes.map((e) => e.mergeKey)).toEqual(['move', 'move']);
    board.undo();
    expect(changes.at(-1)).toMatchObject({ origin: 'undo', label: 'drag' });
    expect(board.getElement('n')!.x).toBe(0);
  });

  it('omits mergeKey from change events that were not given one', () => {
    const board = setup();
    const changes: ChangeEvent[] = [];
    board.on('change', (e) => changes.push(e));
    board.update('n', { x: 1 });
    expect('mergeKey' in changes[0]!).toBe(false);
  });

  it('respects the history limit', () => {
    const board = setup({ limit: 1 });
    board.update('n', { x: 1 });
    type(board, 'a');
    type(board, 'ab');
    expect(undoAll(board)).toBe(1);
    expect(textOf(board)).toBe('');
    expect(board.getElement('n')!.x).toBe(1);
  });

  it('mergeWindowMs is configurable and validated', () => {
    expect(setup().history.mergeWindowMs).toBe(DEFAULT_MERGE_WINDOW_MS);
    const board = setup({ mergeWindowMs: Infinity });
    type(board, 'a');
    vi.advanceTimersByTime(60_000);
    type(board, 'ab');
    expect(undoAll(board)).toBe(1);

    const strict = setup({ mergeWindowMs: 0 });
    type(strict, 'a');
    type(strict, 'ab'); // same instant: still merged
    vi.advanceTimersByTime(1);
    type(strict, 'abc');
    expect(undoAll(strict)).toBe(2);

    expect(() => createBoard({ history: { mergeWindowMs: -1 } })).toThrow(RangeError);
    expect(() => createBoard({ history: { mergeWindowMs: Number.NaN } })).toThrow(RangeError);
    expect(() => createBoard({ history: { mergeWindowMs: '5' as never } })).toThrow(RangeError);
  });

  it('rejects a non-string mergeKey', () => {
    const board = setup();
    expect(() => board.transact(() => {}, { mergeKey: 1 as never })).toThrow(TypeError);
  });
});

describe('BOARD-302: board.history.batch', () => {
  it('folds every local transaction of fn into one step regardless of keys and time', () => {
    const board = setup();
    const before = board.getElement('n');
    const result = board.history.batch('resize', () => {
      board.update('n', { w: 10 });
      vi.advanceTimersByTime(5_000);
      board.update('n', { h: 20 }, { mergeKey: 'other' });
      board.transact((tx) => tx.put({ ...(tx.get('n') as ElementRecord), rotation: 45 }));
      return 'done';
    });
    expect(result).toBe('done');
    expect(undoAll(board)).toBe(1);
    expect(board.getElement('n')).toEqual(before);
  });

  it('separate batches with the same key merge only within the window', () => {
    const board = setup();
    board.history.batch('k', () => board.update('n', { x: 1 }));
    board.history.batch('k', () => board.update('n', { x: 2 }));
    vi.advanceTimersByTime(DEFAULT_MERGE_WINDOW_MS + 1);
    board.history.batch('k', () => board.update('n', { x: 3 }));
    expect(undoAll(board)).toBe(2);
  });

  it('does not merge with the following transaction of another key', () => {
    const board = setup();
    board.history.batch('k', () => board.update('n', { x: 1 }));
    board.update('n', { x: 2 }, { mergeKey: 'other' });
    expect(undoAll(board)).toBe(2);
  });

  it('nested batches join the outermost one', () => {
    const board = setup();
    board.history.batch('outer', () => {
      board.update('n', { x: 1 });
      board.history.batch('inner', () => board.update('n', { y: 1 }));
      board.update('n', { w: 1 });
    });
    expect(undoAll(board)).toBe(1);
  });

  it('keeps transactions committed before fn throws', () => {
    const board = setup();
    expect(() =>
      board.history.batch('k', () => {
        board.update('n', { x: 1 });
        board.update('n', { y: 1 });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(board.getElement('n')).toMatchObject({ x: 1, y: 1 });
    expect(undoAll(board)).toBe(1);
    // The batch ended: later keyed transactions do not join it.
    board.update('n', { x: 2 });
    board.update('n', { x: 3 });
    expect(undoAll(board)).toBe(2);
  });

  it('rejects invalid use', () => {
    const board = setup();
    expect(() => board.history.batch(1 as never, () => {})).toThrow(TypeError);
    expect(() => board.history.batch('k', null as never)).toThrow(TypeError);
    expect(() => board.history.batch('k', () => Promise.resolve())).toThrow(TypeError);
    expect(() => board.transact(() => board.history.batch('k', () => {}))).toThrow(
      'history.batch tidak boleh dipanggil di dalam transaksi.',
    );
    board.dispose();
    expect(() => board.history.batch('k', () => {})).toThrow('Papan sudah di-dispose.');
  });
});

// ---------------------------------------------------------------------------------------------
// Property-based: random local edits with random merge keys and pauses. However the steps are
// merged, undoing everything restores the initial document, and redoing everything restores the
// final one.

type Op =
  | { kind: 'move'; x: number; key: string | null; gap: number }
  | { kind: 'text'; text: string; key: string | null; gap: number }
  | { kind: 'toggle'; key: string | null; gap: number }
  | { kind: 'batch'; xs: number[]; key: string; gap: number };

const keyArb = fc.constantFrom<string | null>(null, 'a', 'b');
const gapArb = fc.constantFrom(0, 300, 1000, 1500);
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('move' as const), x: fc.integer(), key: keyArb, gap: gapArb }),
  fc.record({ kind: fc.constant('text' as const), text: fc.string(), key: keyArb, gap: gapArb }),
  fc.record({ kind: fc.constant('toggle' as const), key: keyArb, gap: gapArb }),
  fc.record({
    kind: fc.constant('batch' as const),
    xs: fc.array(fc.integer(), { maxLength: 3 }),
    key: fc.constantFrom('a', 'b'),
    gap: gapArb,
  }),
);

function apply(board: Board, op: Op): void {
  vi.advanceTimersByTime(op.gap);
  const opts = op.kind !== 'batch' && op.key !== null ? { mergeKey: op.key } : {};
  switch (op.kind) {
    case 'move':
      board.update('n', { x: op.x }, opts);
      return;
    case 'text':
      board.update('n', { props: { text: op.text } }, opts);
      return;
    case 'toggle':
      if (board.getElement('extra')) board.delete('extra', opts);
      else board.create({ id: 'extra', type: 'note' }, opts);
      return;
    case 'batch':
      board.history.batch(op.key, () => {
        for (const x of op.xs) board.update('n', { y: x });
      });
      return;
  }
}

const recordsOf = (doc: BoardDocument): unknown => JSON.parse(JSON.stringify(doc.records));

describe('BOARD-302: property-based coalescing', () => {
  it('undo-all restores the initial document and redo-all the final one', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        vi.setSystemTime(0);
        const board = setup({ limit: Infinity });
        const initial = recordsOf(board.getDocument());
        for (const op of ops) apply(board, op);
        const final = recordsOf(board.getDocument());

        const undone = undoAll(board);
        expect(recordsOf(board.getDocument())).toEqual(initial);
        let redone = 0;
        while (board.redo()) redone++;
        expect(redone).toBe(undone);
        expect(recordsOf(board.getDocument())).toEqual(final);
        // Merging never creates more steps than transactions.
        expect(undone).toBeLessThanOrEqual(
          ops.length + ops.reduce((n, op) => n + (op.kind === 'batch' ? op.xs.length : 0), 0),
        );
        board.dispose();
      }),
      { numRuns: 300 },
    );
  });
});
