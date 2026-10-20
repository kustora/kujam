import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { deepEqual } from '../utils/clone.js';
import {
  DEFAULT_HISTORY_LIMIT,
  ReadOnlyBoardError,
  createBoard,
  createEmptyDocument,
  type Board,
  type BoardRecord,
  type ChangeEvent,
  type ElementRecord,
  type HistoryEvent,
} from '../index.js';

function makeElement(overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id: 'el:1',
    kind: 'element',
    type: 'sticky',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 0,
    y: 0,
    rotation: 0,
    w: 100,
    h: 100,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...overrides,
  };
}

function moveX(board: Board, id: string, x: number, label?: string): void {
  board.transact((tx) => tx.put({ ...(tx.get(id) as ElementRecord), x }), { label });
}

function recordEvents(board: Board): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  board.on('change', (e) => events.push(e));
  return events;
}

describe('undo/redo dasar (BOARD-301)', () => {
  it('undo dan redo membalik transaksi lokal dengan origin undo/redo dan label asli', () => {
    const board = createBoard();
    const initial = board.getDocument().records;
    expect(board.history.canUndo).toBe(false);
    expect(board.undo()).toBe(false);
    expect(board.redo()).toBe(false);

    board.transact((tx) => tx.put(makeElement()), { label: 'buat' });
    moveX(board, 'el:1', 50, 'geser');
    board.transact(() => {}, { label: 'kosong' }); // no net change: not recorded
    const events = recordEvents(board);

    expect(board.history.canUndo).toBe(true);
    expect(board.undo()).toBe(true);
    expect(board.getElement('el:1')?.x).toBe(0);
    expect(events.at(-1)).toMatchObject({ origin: 'undo', label: 'geser' });
    expect(board.history.canRedo).toBe(true);

    expect(board.undo()).toBe(true);
    expect(board.getElement('el:1')).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ origin: 'undo', label: 'buat' });
    expect(board.history.canUndo).toBe(false);
    expect(deepEqual(board.getDocument().records, initial)).toBe(true);

    expect(board.redo()).toBe(true);
    expect(events.at(-1)).toMatchObject({ origin: 'redo', label: 'buat' });
    expect(board.redo()).toBe(true);
    expect(events.at(-1)).toMatchObject({ origin: 'redo', label: 'geser' });
    expect(board.getElement('el:1')?.x).toBe(50);
    expect(board.history.canRedo).toBe(false);
    expect(board.redo()).toBe(false);
  });

  it('membalik penghapusan record', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement({ x: 7 });
    const board = createBoard({ document: doc });
    board.transact((tx) => tx.remove('el:1'));
    board.undo();
    expect(board.getElement('el:1')).toEqual(makeElement({ x: 7 }));
    board.redo();
    expect(board.getElement('el:1')).toBeUndefined();
  });

  it('hanya transaksi local yang masuk riwayat', () => {
    const board = createBoard();
    for (const origin of ['remote', 'undo', 'redo', 'load'] as const) {
      board.transact((tx) => tx.put(makeElement({ id: `el:${origin}` })), { origin });
    }
    expect(board.history.canUndo).toBe(false);
    expect(board.history.canRedo).toBe(false);
    expect(board.undo()).toBe(false);
    expect(board.getElement('el:remote')).toBeDefined();
  });

  it('perubahan lokal baru setelah undo membuang tumpukan redo', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    moveX(board, 'el:1', 10);
    board.undo();
    expect(board.history.canRedo).toBe(true);
    moveX(board, 'el:1', 20);
    expect(board.history.canRedo).toBe(false);
    expect(board.redo()).toBe(false);
    board.undo();
    expect(board.getElement('el:1')?.x).toBe(0);
  });

  it('perubahan remote tidak membuang tumpukan redo', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    board.undo();
    board.transact((tx) => tx.put(makeElement({ id: 'el:r' })), { origin: 'remote' });
    expect(board.history.canRedo).toBe(true);
    expect(board.redo()).toBe(true);
    expect(board.getElement('el:1')).toBeDefined();
  });
});

describe('batas riwayat', () => {
  it('bawaan 200 langkah; langkah tertua dibuang', () => {
    expect(DEFAULT_HISTORY_LIMIT).toBe(200);
    const board = createBoard();
    expect(board.history.limit).toBe(200);
    board.transact((tx) => tx.put(makeElement()), { origin: 'remote' });
    for (let i = 1; i <= 205; i++) moveX(board, 'el:1', i);
    let count = 0;
    while (board.undo()) count++;
    expect(count).toBe(200);
    expect(board.getElement('el:1')?.x).toBe(5);
  });

  it('bisa diubah lewat opsi history.limit, termasuk 0 dan Infinity', () => {
    const board = createBoard({ history: { limit: 2 } });
    board.transact((tx) => tx.put(makeElement()));
    for (let i = 1; i <= 3; i++) moveX(board, 'el:1', i);
    expect(board.undo()).toBe(true);
    expect(board.undo()).toBe(true);
    expect(board.undo()).toBe(false);
    expect(board.getElement('el:1')?.x).toBe(1);
    expect(board.redo()).toBe(true);
    expect(board.redo()).toBe(true);
    expect(board.getElement('el:1')?.x).toBe(3);

    const off = createBoard({ history: { limit: 0 } });
    off.transact((tx) => tx.put(makeElement()));
    expect(off.history.canUndo).toBe(false);
    expect(off.undo()).toBe(false);

    expect(createBoard({ history: { limit: Infinity } }).history.limit).toBe(Infinity);
    expect(createBoard({ history: {} }).history.limit).toBe(200);
  });

  it.each([-1, 1.5, Number.NaN, '10' as unknown as number])('menolak limit %s', (limit) => {
    expect(() => createBoard({ history: { limit } })).toThrow(RangeError);
  });
});

describe('interaksi riwayat', () => {
  it('clear mengosongkan undo dan redo tanpa mengubah dokumen', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    moveX(board, 'el:1', 1);
    board.undo();
    const doc = board.getDocument();
    board.history.clear();
    expect(board.history.canUndo).toBe(false);
    expect(board.history.canRedo).toBe(false);
    expect(board.getDocument()).toBe(doc);
  });

  it('loadDocument dan transaksi migration mengosongkan riwayat (BOARD-206)', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    moveX(board, 'el:1', 1);
    board.undo();
    board.loadDocument(board.getDocument());
    expect(board.history.canUndo).toBe(false);
    expect(board.history.canRedo).toBe(false);

    board.transact((tx) => tx.put(makeElement({ id: 'el:2' })));
    board.transact((tx) => tx.put(makeElement({ id: 'el:3' })), { origin: 'migration' });
    expect(board.history.canUndo).toBe(false);
  });

  it('papan readOnly: riwayat selalu kosong, undo/redo mengembalikan false tanpa melempar', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement();
    const board = createBoard({ document: doc, readOnly: true });
    expect(() => moveX(board, 'el:1', 5)).toThrow(ReadOnlyBoardError);
    board.transact((tx) => tx.put(makeElement({ x: 9 })), { origin: 'remote' });
    expect(board.history.canUndo).toBe(false);
    expect(board.undo()).toBe(false);
    expect(board.redo()).toBe(false);
    expect(board.getElement('el:1')?.x).toBe(9);
  });

  it('undo/redo di dalam transact ditolak tanpa mengubah riwayat', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    expect(() => board.transact(() => board.undo())).toThrow(/undo.*di dalam transaksi/);
    expect(() => board.transact(() => board.redo())).toThrow(/redo.*di dalam transaksi/);
    expect(board.history.canUndo).toBe(true);
    expect(board.getElement('el:1')).toBeDefined();
  });

  it('undo boleh dipanggil dari listener change (setelah commit)', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    moveX(board, 'el:1', 1);
    const origins: string[] = [];
    const off = board.on('change', (e) => {
      origins.push(e.origin);
      if (origins.length === 1) board.undo();
    });
    board.undo();
    off();
    expect(origins).toEqual(['undo', 'undo']);
    expect(board.getElement('el:1')).toBeUndefined();
    expect(board.history.canUndo).toBe(false);
    board.redo();
    board.redo();
    expect(board.getElement('el:1')?.x).toBe(1);
  });

  it('transaksi manual berorigin undo tidak masuk tumpukan redo', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    board.transact((tx) => tx.remove('el:1'), { origin: 'undo' });
    expect(board.history.canRedo).toBe(false);
    expect(board.history.canUndo).toBe(true);
  });

  it('dispose mengosongkan riwayat dan undo/redo melempar setelahnya', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    board.dispose();
    expect(board.history.canUndo).toBe(false);
    expect(() => board.undo()).toThrow(/dispose/);
    expect(() => board.redo()).toThrow(/dispose/);
  });
});

describe('perubahan remote di antara undo (strategi 0.1)', () => {
  it('record yang diubah remote dilewati; record lain tetap dibalik', () => {
    const board = createBoard();
    board.transact((tx) => {
      tx.put(makeElement({ id: 'el:a' }));
      tx.put(makeElement({ id: 'el:b' }));
    });
    board.transact(
      (tx) => {
        tx.put(makeElement({ id: 'el:a', x: 10 }));
        tx.put(makeElement({ id: 'el:b', x: 10 }));
      },
      { label: 'geser dua' },
    );
    board.transact((tx) => tx.put(makeElement({ id: 'el:a', x: 99 })), { origin: 'remote' });
    const events = recordEvents(board);

    expect(board.undo()).toBe(true);
    expect(board.getElement('el:a')?.x).toBe(99); // the remote change wins
    expect(board.getElement('el:b')?.x).toBe(0);
    expect(Object.keys(events[0]!.updated)).toEqual(['el:b']);

    // Redo only reapplies the part that was actually undone.
    expect(board.redo()).toBe(true);
    expect(board.getElement('el:a')?.x).toBe(99);
    expect(board.getElement('el:b')?.x).toBe(10);
  });

  it('record yang dihapus remote tidak dihidupkan kembali oleh undo update', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    moveX(board, 'el:1', 5);
    board.transact((tx) => tx.remove('el:1'), { origin: 'remote' });
    // The "move" step cannot be reversed at all: it is dropped, then undo continues to "create",
    // which no longer applies either (the record is gone). Nothing changes.
    expect(board.undo()).toBe(false);
    expect(board.getElement('el:1')).toBeUndefined();
    expect(board.history.canUndo).toBe(false);
    expect(board.history.canRedo).toBe(false);
  });

  it('langkah yang seluruhnya konflik dibuang dan undo lanjut ke langkah sebelumnya', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement({ id: 'el:a' })), { label: 'buat a' });
    board.transact((tx) => tx.put(makeElement({ id: 'el:b' })), { label: 'buat b' });
    board.transact((tx) => tx.put(makeElement({ id: 'el:b', x: 3 })), { origin: 'remote' });
    const events = recordEvents(board);
    expect(board.undo()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ origin: 'undo', label: 'buat a' });
    expect(board.getElement('el:a')).toBeUndefined();
    expect(board.getElement('el:b')?.x).toBe(3);
  });

  it('record yang dihapus lokal lalu dibuat ulang remote tidak ditimpa', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement();
    const board = createBoard({ document: doc });
    board.transact((tx) => tx.remove('el:1'));
    board.transact((tx) => tx.put(makeElement({ x: 42 })), { origin: 'remote' });
    expect(board.undo()).toBe(false);
    expect(board.getElement('el:1')?.x).toBe(42);
  });

  it('record yang dihapus lokal, lalu dibuat dan dihapus lagi oleh remote, tidak dihidupkan', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement();
    const board = createBoard({ document: doc });
    board.transact((tx) => tx.remove('el:1'));
    board.transact((tx) => tx.put(makeElement({ x: 1 })), { origin: 'remote' });
    board.transact((tx) => tx.remove('el:1'), { origin: 'remote' });
    expect(board.undo()).toBe(false);
    expect(board.getElement('el:1')).toBeUndefined();
  });

  it('langkah lokal sesudah perubahan remote tetap bisa dibalik ke nilai remote', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    board.transact((tx) => tx.put(makeElement({ x: 9 })), { origin: 'remote' });
    moveX(board, 'el:1', 2);
    expect(board.undo()).toBe(true);
    expect(board.getElement('el:1')?.x).toBe(9);
    // The "create" step is older than the remote change: skipped.
    expect(board.undo()).toBe(false);
    expect(board.getElement('el:1')?.x).toBe(9);
  });

  it('nilai remote yang identik secara isi tidak dianggap konflik', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    moveX(board, 'el:1', 5);
    // Remote rewrites the same value (new object, same content).
    board.transact((tx) => tx.put(makeElement({ x: 5 })), { origin: 'remote' });
    expect(board.undo()).toBe(true);
    expect(board.getElement('el:1')?.x).toBe(0);
  });
});

describe('event history (notifikasi canUndo/canRedo)', () => {
  it('dipancarkan hanya saat canUndo atau canRedo berubah, setelah event change', () => {
    const board = createBoard();
    const log: string[] = [];
    const states: HistoryEvent[] = [];
    board.on('change', (e) => log.push(`change:${e.origin}:${board.history.canUndo}`));
    board.on('history', (e) => {
      log.push('history');
      states.push(e);
    });

    board.transact((tx) => tx.put(makeElement()));
    moveX(board, 'el:1', 1); // canUndo stays true: no history event
    board.undo();
    board.undo();
    board.redo();
    board.history.clear();
    board.history.clear(); // unchanged: no event

    expect(log).toEqual([
      'change:local:true',
      'history',
      'change:local:true',
      'change:undo:true',
      'history',
      'change:undo:false',
      'history',
      'change:redo:true',
      'history',
      'history',
    ]);
    expect(states).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: true, canRedo: true },
      { canUndo: false, canRedo: true },
      { canUndo: true, canRedo: true },
      { canUndo: false, canRedo: false },
    ]);
  });

  it('dipancarkan saat undo membuang langkah konflik tanpa perubahan', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    board.transact((tx) => tx.remove('el:1'), { origin: 'remote' });
    const fn = vi.fn();
    board.on('history', fn);
    expect(board.undo()).toBe(false);
    expect(fn).toHaveBeenCalledWith({ canUndo: false, canRedo: false });
  });
});

// ---------------------------------------------------------------------------------------------
// Property-based: random sequences of local transactions, undo, and redo compared against a
// "list of states + pointer" model. Undo followed by redo always returns to the original state.

const IDS = ['el:a', 'el:b', 'el:c', 'page:x'];

type LocalOp = { kind: 'put'; id: string; x: number } | { kind: 'remove'; id: string };
type Step = { kind: 'local'; ops: LocalOp[] } | { kind: 'undo' } | { kind: 'redo' };

const localOp: fc.Arbitrary<LocalOp> = fc.oneof(
  fc.record({
    kind: fc.constant('put' as const),
    id: fc.constantFrom(...IDS),
    x: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({ kind: fc.constant('remove' as const), id: fc.constantFrom(...IDS) }),
);

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('local' as const),
      ops: fc.array(localOp, { maxLength: 4 }),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'redo' as const }) },
);

function recordFor(id: string, x: number): BoardRecord {
  if (id.startsWith('page:')) return { id, kind: 'page', name: 'p', index: 'a0', meta: { x } };
  return makeElement({ id, x });
}

function applyLocal(board: Board, ops: LocalOp[]): void {
  board.transact(
    (tx) => {
      for (const op of ops) {
        if (op.kind === 'put') tx.put(recordFor(op.id, op.x));
        else tx.remove(op.id);
      }
    },
    { label: 'acak' },
  );
}

describe('property-based (BOARD-301)', () => {
  it('undo/redo mengikuti model daftar state dengan batas acak', () => {
    fc.assert(
      fc.property(
        fc.array(stepArb, { maxLength: 30 }),
        fc.integer({ min: 0, max: 6 }),
        fc.boolean(),
        (steps, limit, freezeSnapshots) => {
          const board = createBoard({ history: { limit }, freezeSnapshots });
          // Model: states[pointer] is the current state; states[< pointer] can be undone.
          let states = [board.getDocument().records];
          let pointer = 0;

          for (const step of steps) {
            if (step.kind === 'local') {
              applyLocal(board, step.ops);
              const next = board.getDocument().records;
              if (!deepEqual(next, states[pointer])) {
                states = [...states.slice(0, pointer + 1), next];
                pointer += 1;
                // Limit: at most `limit` undo steps.
                const drop = Math.max(0, pointer - limit);
                states = states.slice(drop);
                pointer -= drop;
              }
            } else if (step.kind === 'undo') {
              expect(board.history.canUndo).toBe(pointer > 0);
              expect(board.undo()).toBe(pointer > 0);
              if (pointer > 0) pointer -= 1;
            } else {
              const canRedo = pointer < states.length - 1;
              expect(board.history.canRedo).toBe(canRedo);
              expect(board.redo()).toBe(canRedo);
              if (canRedo) pointer += 1;
            }
            expect(deepEqual(board.getDocument().records, states[pointer])).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('undo semua lalu redo semua kembali ke state awal dan akhir', () => {
    fc.assert(
      fc.property(fc.array(fc.array(localOp, { maxLength: 4 }), { maxLength: 20 }), (txs) => {
        const board = createBoard();
        const initial = board.getDocument().records;
        for (const ops of txs) applyLocal(board, ops);
        const final = board.getDocument().records;

        while (board.undo());
        expect(deepEqual(board.getDocument().records, initial)).toBe(true);
        while (board.redo());
        expect(deepEqual(board.getDocument().records, final)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('dengan perubahan remote acak di sela, undo tidak pernah melempar dan tidak menimpa remote', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            remote: fc.boolean(),
            ops: fc.array(localOp, { minLength: 1, maxLength: 3 }),
          }),
          { maxLength: 15 },
        ),
        (txs) => {
          const board = createBoard();
          // Last writer per record: 'remote' when its last net change came from remote.
          const lastWriter = new Map<string, 'local' | 'remote'>();
          board.on('change', (e) => {
            const origin = e.origin === 'remote' ? 'remote' : 'local';
            for (const diff of [e.added, e.updated, e.removed]) {
              for (const id of Object.keys(diff)) lastWriter.set(id, origin);
            }
          });
          for (const t of txs) {
            if (t.remote) {
              board.transact(
                (tx) => {
                  for (const op of t.ops) {
                    if (op.kind === 'put') tx.put(recordFor(op.id, op.x + 10));
                    else tx.remove(op.id);
                  }
                },
                { origin: 'remote' },
              );
            } else {
              applyLocal(board, t.ops);
            }
          }
          const beforeUndo = board.getDocument().records;
          const remoteOwned = [...lastWriter].filter(([, w]) => w === 'remote').map(([id]) => id);
          while (board.undo());
          const after = board.getDocument().records;
          // Records last changed by remote (including deletion) are never touched by undo.
          for (const id of remoteOwned) expect(after[id]).toBe(beforeUndo[id]);
          expect(board.history.canUndo).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  describe('BOARD-303: tx.onUndo and tx.onRedo hooks', () => {
    it('calls tx.onUndo with transaction context when step is undone', () => {
      const board = createBoard();
      const undoCalls: { label?: string }[] = [];

      board.transact(
        (tx) => {
          tx.put(recordFor('elem-1', 10));
          tx.onUndo((ctx) => {
            undoCalls.push(ctx);
          });
        },
        { label: 'create-elem-1' },
      );

      expect(undoCalls).toHaveLength(0);
      expect(board.undo()).toBe(true);
      expect(undoCalls).toEqual([{ label: 'create-elem-1' }]);
    });

    it('calls tx.onRedo when step is redone', () => {
      const board = createBoard();
      const redoCalls: { label?: string }[] = [];

      board.transact(
        (tx) => {
          tx.put(recordFor('elem-2', 20));
          tx.onRedo((ctx) => {
            redoCalls.push(ctx);
          });
        },
        { label: 'create-elem-2' },
      );

      board.undo();
      expect(redoCalls).toHaveLength(0);
      expect(board.redo()).toBe(true);
      expect(redoCalls).toEqual([{ label: 'create-elem-2' }]);
    });

    it('handles async hooks gracefully without blocking undo', async () => {
      const board = createBoard();
      let asyncRan = false;

      board.transact((tx) => {
        tx.put(recordFor('elem-3', 30));
        tx.onUndo(async () => {
          await Promise.resolve();
          asyncRan = true;
        });
      });

      expect(board.undo()).toBe(true);
      expect(board.getDocument().records['elem-3']).toBeUndefined();
      await Promise.resolve();
      expect(asyncRan).toBe(true);
    });
  });
});
