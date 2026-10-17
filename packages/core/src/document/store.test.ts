import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { deepEqual } from '../utils/clone.js';
import {
  CHANGE_ORIGINS,
  InvalidDocumentError,
  ReadOnlyBoardError,
  createBoard,
  createEmptyDocument,
  validateDocument,
  type BoardDocument,
  type BoardRecord,
  type ChangeEvent,
  type ChangeOrigin,
  type ElementRecord,
  type Transaction,
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

function recordEvents(board: ReturnType<typeof createBoard>): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  board.on('change', (e) => events.push(e));
  return events;
}

/** Applies a diff to a plain record map (how consumers apply events to their own copy). */
function applyEvent(records: Record<string, BoardRecord>, event: ChangeEvent): void {
  for (const id of Object.keys(event.removed)) delete records[id];
  for (const [id, rec] of Object.entries(event.added)) records[id] = rec;
  for (const [id, { after }] of Object.entries(event.updated)) records[id] = after;
}

describe('transact (BOARD-204)', () => {
  it('satu transaksi menghasilkan satu event change berisi diff, origin, dan label', () => {
    const board = createBoard();
    const events = recordEvents(board);

    const result = board.transact(
      (tx) => {
        tx.put(makeElement({ id: 'el:1' }));
        tx.put(makeElement({ id: 'el:2' }));
        return 'selesai';
      },
      { label: 'tambah dua' },
    );

    expect(result).toBe('selesai');
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(Object.keys(event!.added).sort()).toEqual(['el:1', 'el:2']);
    expect(event!.updated).toEqual({});
    expect(event!.removed).toEqual({});
    expect(event!.origin).toBe('local');
    expect(event!.label).toBe('tambah dua');
    expect(board.getElement('el:2')).toEqual(makeElement({ id: 'el:2' }));
  });

  it('listener membaca state yang sudah di-commit', () => {
    const board = createBoard();
    let seen: unknown;
    board.on('change', () => {
      seen = board.getElement('el:1')?.x;
    });
    board.transact((tx) => tx.put(makeElement({ x: 7 })));
    expect(seen).toBe(7);
  });

  it('menerima semua origin yang valid dan menolak origin, label, atau fn yang salah', () => {
    const board = createBoard();
    const events = recordEvents(board);
    CHANGE_ORIGINS.forEach((origin, i) => {
      board.transact((tx) => tx.put(makeElement({ x: i + 1 })), { origin });
    });
    expect(events.map((e) => e.origin)).toEqual([...CHANGE_ORIGINS]);
    expect(events[0]!.label).toBeUndefined();

    expect(() => board.transact(() => {}, { origin: 'peer' as ChangeOrigin })).toThrow(RangeError);
    expect(() => board.transact(() => {}, { label: 5 as unknown as string })).toThrow(TypeError);
    expect(() => board.transact(null as unknown as () => void)).toThrow(TypeError);
  });

  it('transaksi tanpa perubahan bersih tidak memancarkan event dan tidak mengganti snapshot', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    const events = recordEvents(board);
    const before = board.getDocument();

    board.transact(() => {});
    board.transact((tx) => tx.put(makeElement())); // same content
    board.transact((tx) => {
      tx.put(makeElement({ id: 'el:baru' }));
      tx.remove('el:baru');
    });
    board.transact((tx) => {
      tx.put(makeElement({ x: 50 }));
      tx.put(makeElement({ x: 0 }));
    });
    board.transact((tx) => {
      tx.remove('el:1');
      tx.put(makeElement());
    });

    expect(events).toHaveLength(0);
    expect(board.getDocument()).toBe(before);
  });
});

describe('penggabungan perubahan berulang (BOARD-204b)', () => {
  it('update berkali-kali menjadi satu updated dengan before awal dan after akhir', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    const original = board.getElement('el:1');
    const events = recordEvents(board);

    board.transact((tx) => {
      for (let x = 1; x <= 5; x++) tx.put({ ...(tx.get('el:1') as ElementRecord), x });
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.updated['el:1']!.before).toBe(original);
    expect(events[0]!.updated['el:1']!.after).toMatchObject({ x: 5 });
  });

  it('record baru yang diubah lalu tetap ada muncul di added dengan nilai akhir', () => {
    const board = createBoard();
    const events = recordEvents(board);
    board.transact((tx) => {
      tx.put(makeElement({ x: 1 }));
      tx.put(makeElement({ x: 2 }));
    });
    expect(events[0]!.added['el:1']).toMatchObject({ x: 2 });
    expect(events[0]!.updated).toEqual({});
  });

  it('update lalu remove record lama menjadi removed dengan nilai sebelum transaksi', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    const original = board.getElement('el:1');
    const events = recordEvents(board);

    board.transact((tx) => {
      tx.put(makeElement({ x: 99 }));
      expect(tx.remove('el:1')).toBe(true);
      expect(tx.remove('el:1')).toBe(false);
      expect(tx.has('el:1')).toBe(false);
    });

    expect(events[0]!.removed['el:1']).toBe(original);
    expect(events[0]!.added).toEqual({});
    expect(events[0]!.updated).toEqual({});
  });

  it('remove lalu put record lama dengan isi berbeda menjadi updated', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    const events = recordEvents(board);
    board.transact((tx) => {
      tx.remove('el:1');
      tx.put(makeElement({ type: 'geo' }));
    });
    expect(Object.keys(events[0]!.updated)).toEqual(['el:1']);
    expect(events[0]!.updated['el:1']!.after.kind === 'element').toBe(true);
    expect(events[0]!.removed).toEqual({});
  });
});

describe('rollback (BOARD-204c)', () => {
  it('fn yang melempar membatalkan semua perubahan dan tidak memancarkan event', () => {
    const board = createBoard();
    board.transact((tx) => tx.put(makeElement()));
    const snapshot = board.getDocument();
    const events = recordEvents(board);

    const boom = new Error('gagal di tengah');
    expect(() =>
      board.transact((tx) => {
        tx.put(makeElement({ id: 'el:2' }));
        tx.put(makeElement({ x: 500 }));
        tx.remove('page:main');
        throw boom;
      }),
    ).toThrow(boom);

    expect(events).toHaveLength(0);
    expect(board.getDocument()).toBe(snapshot);
    expect(board.getElement('el:2')).toBeUndefined();
    expect(board.getElement('el:1')?.x).toBe(0);

    // The board is still usable after rollback.
    board.transact((tx) => tx.put(makeElement({ id: 'el:3' })));
    expect(events).toHaveLength(1);
  });

  it('record tidak valid ditolak dan seluruh transaksi dibatalkan', () => {
    const board = createBoard();
    expect(() =>
      board.transact((tx) => {
        tx.put(makeElement({ id: 'el:ok' }));
        tx.put(makeElement({ id: 'el:rusak', opacity: 3 }));
      }),
    ).toThrow(InvalidDocumentError);
    expect(board.getElement('el:ok')).toBeUndefined();

    const bad = [
      { id: '', kind: 'page', name: 'x', index: 'a1', meta: {} },
      { kind: 'page' },
      null,
    ];
    for (const rec of bad) {
      expect(() => board.transact((tx) => tx.put(rec as unknown as BoardRecord))).toThrow(
        InvalidDocumentError,
      );
    }
  });

  it('fn async ditolak dan dibatalkan', () => {
    const board = createBoard();
    expect(() =>
      board.transact(async (tx) => {
        tx.put(makeElement());
      }),
    ).toThrow(TypeError);
    expect(board.getElement('el:1')).toBeUndefined();
  });

  it('objek transaksi tidak bisa dipakai setelah transaksi selesai', () => {
    const board = createBoard();
    let leaked: Transaction | undefined;
    board.transact((tx) => {
      leaked = tx;
    });
    expect(() => leaked!.put(makeElement())).toThrow(/Transaksi sudah selesai/);
    expect(() => leaked!.get('page:main')).toThrow(/Transaksi sudah selesai/);
  });
});

describe('transaksi bersarang', () => {
  it('digabung ke transaksi terluar: satu event, origin dan label terluar', () => {
    const board = createBoard();
    const events = recordEvents(board);

    board.transact(
      (tx) => {
        tx.put(makeElement({ id: 'el:1' }));
        const inner = board.transact(
          (innerTx) => {
            expect(innerTx).toBe(tx);
            expect(innerTx.get('el:1')).toBeDefined();
            innerTx.put(makeElement({ id: 'el:2' }));
            return 42;
          },
          { origin: 'remote', label: 'dalam' },
        );
        expect(inner).toBe(42);
        // Not committed until the outermost transaction finishes.
        expect(board.getElement('el:2')).toBeUndefined();
      },
      { label: 'luar' },
    );

    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]!.added).sort()).toEqual(['el:1', 'el:2']);
    expect(events[0]!.origin).toBe('local');
    expect(events[0]!.label).toBe('luar');
  });

  it('error di transaksi dalam hanya membatalkan perubahan dalam bila ditangkap', () => {
    const board = createBoard();
    const events = recordEvents(board);
    board.transact((tx) => {
      tx.put(makeElement({ id: 'el:1' }));
      expect(() =>
        board.transact((inner) => {
          inner.put(makeElement({ id: 'el:2' }));
          inner.put(makeElement({ id: 'el:1', x: 9 }));
          throw new Error('dalam gagal');
        }),
      ).toThrow('dalam gagal');
      expect(tx.get('el:2')).toBeUndefined();
      expect(tx.get('el:1')?.kind === 'element' && tx.get('el:1')).toMatchObject({ x: 0 });
      expect(() => board.transact(async () => {})).toThrow(TypeError);
    });
    expect(Object.keys(events[0]!.added)).toEqual(['el:1']);
  });

  it('error dalam yang tidak ditangkap membatalkan transaksi terluar', () => {
    const board = createBoard();
    const events = recordEvents(board);
    expect(() =>
      board.transact(() => {
        board.transact((tx) => tx.put(makeElement()));
        board.transact(() => {
          throw new Error('x');
        });
      }),
    ).toThrow('x');
    expect(events).toHaveLength(0);
    expect(board.getElement('el:1')).toBeUndefined();
  });
});

describe('readOnly', () => {
  it('menolak transaksi local tetapi menerima remote dan loadDocument', () => {
    const board = createBoard({ readOnly: true });
    const events = recordEvents(board);
    expect(() => board.transact((tx) => tx.put(makeElement()))).toThrow(ReadOnlyBoardError);
    expect(() => board.transact((tx) => tx.put(makeElement()), { origin: 'local' })).toThrow(
      /baca saja/,
    );
    expect(board.getElement('el:1')).toBeUndefined();

    board.transact((tx) => tx.put(makeElement()), { origin: 'remote' });
    expect(board.getElement('el:1')).toBeDefined();

    board.loadDocument(createEmptyDocument());
    expect(events.map((e) => e.origin)).toEqual(['remote', 'load']);
  });
});

describe('loadDocument sebagai transaksi origin load', () => {
  it('memancarkan diff terhadap dokumen lama dan mempertahankan record yang sama', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement({ id: 'el:1' });
    doc.records['el:2'] = makeElement({ id: 'el:2' });
    const board = createBoard({ document: doc });
    const keep = board.getElement('el:1');
    const events = recordEvents(board);

    const next = createEmptyDocument({ versi: 2 });
    next.records['el:1'] = makeElement({ id: 'el:1' });
    next.records['el:2'] = makeElement({ id: 'el:2', x: 5 });
    next.records['el:3'] = makeElement({ id: 'el:3' });
    board.loadDocument(next);

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event!.origin).toBe('load');
    expect(Object.keys(event!.added)).toEqual(['el:3']);
    expect(Object.keys(event!.updated)).toEqual(['el:2']);
    expect(event!.removed).toEqual({});
    expect(board.getElement('el:1')).toBe(keep);
    expect(board.getDocument().meta).toEqual({ versi: 2 });

    board.loadDocument(createEmptyDocument({ versi: 3 }));
    expect(Object.keys(events[1]!.removed).sort()).toEqual(['el:1', 'el:2', 'el:3']);

    // An identical document still emits one event (meta may change), with an empty diff.
    board.loadDocument(createEmptyDocument({ versi: 4 }));
    expect(events).toHaveLength(3);
    expect(events[2]!.added).toEqual({});
    expect(board.getDocument().meta).toEqual({ versi: 4 });
  });

  it('dokumen tidak valid tidak mengubah state dan tidak memancarkan event', () => {
    const board = createBoard();
    const events = recordEvents(board);
    const broken = { schemaVersion: 1, meta: {}, records: [] } as unknown as BoardDocument;
    expect(() => board.loadDocument(broken)).toThrow(InvalidDocumentError);
    expect(events).toHaveLength(0);
  });

  it('tidak boleh dipanggil di dalam transaksi', () => {
    const board = createBoard();
    expect(() => board.transact(() => board.loadDocument(createEmptyDocument()))).toThrow(
      /di dalam transaksi/,
    );
  });
});

describe('snapshot immutable dan structural sharing (BOARD-204a)', () => {
  it('mode bawaan membekukan snapshot, record, dan event', () => {
    const board = createBoard();
    const events = recordEvents(board);
    board.transact((tx) => tx.put(makeElement({ props: { nested: { a: 1 } } })));

    const doc = board.getDocument();
    expect(Object.isFrozen(doc)).toBe(true);
    expect(Object.isFrozen(doc.records)).toBe(true);
    const el = board.getElement('el:1')!;
    expect(Object.isFrozen((el.props as { nested: object }).nested)).toBe(true);
    expect(() => {
      (el as ElementRecord).x = 1;
    }).toThrow(TypeError);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0]!.added)).toBe(true);
  });

  it('record masukan disalin sehingga mutasi setelah put tidak bocor', () => {
    const board = createBoard();
    const input = makeElement({ props: { text: 'a' } });
    board.transact((tx) => tx.put(input));
    input.props.text = 'b';
    input.x = 77;
    expect(board.getElement('el:1')).toMatchObject({ x: 0, props: { text: 'a' } });
  });

  it('record yang tidak berubah tetap objek yang sama antar transaksi', () => {
    const doc = createEmptyDocument();
    for (let i = 0; i < 50; i++) doc.records[`el:${i}`] = makeElement({ id: `el:${i}` });
    const board = createBoard({ document: doc });
    const before = board.getDocument();

    board.transact((tx) => tx.put(makeElement({ id: 'el:0', x: 1 })));
    const after = board.getDocument();

    expect(after).not.toBe(before);
    expect(after.records).not.toBe(before.records);
    expect(after.meta).toBe(before.meta);
    expect(after.records['el:1']).toBe(before.records['el:1']);
    expect(after.records['page:main']).toBe(before.records['page:main']);
    expect(before.records['el:0']).toMatchObject({ x: 0 });
  });

  it('freezeSnapshots: false tidak membekukan tetapi tetap structural sharing', () => {
    const board = createBoard({ freezeSnapshots: false });
    const events = recordEvents(board);
    board.transact((tx) => tx.put(makeElement()));
    const before = board.getDocument();
    expect(Object.isFrozen(before)).toBe(false);
    expect(Object.isFrozen(board.getElement('el:1'))).toBe(false);
    expect(Object.isFrozen(events[0])).toBe(false);

    board.transact((tx) => tx.put(makeElement({ id: 'el:2' })));
    expect(board.getDocument()).not.toBe(before);
    expect(board.getDocument().records['el:1']).toBe(before.records['el:1']);
    expect(before.records['el:2']).toBeUndefined();

    board.loadDocument(createEmptyDocument());
    expect(Object.isFrozen(board.getDocument())).toBe(false);
  });

  it('performa wajar untuk 5.000 elemen: 1.000 transaksi kecil tanpa deep-clone dokumen', () => {
    const doc = createEmptyDocument();
    for (let i = 0; i < 5000; i++) {
      doc.records[`el:${i}`] = makeElement({ id: `el:${i}`, props: { text: `isi ${i}` } });
    }
    for (const freezeSnapshots of [true, false]) {
      const board = createBoard({ document: doc, freezeSnapshots });
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        board.transact((tx) => tx.put(makeElement({ id: `el:${i}`, x: i + 1 })));
      }
      const elapsed = performance.now() - start;
      expect(board.getElement('el:999')?.x).toBe(1000);
      // Loose bound so CI is not flaky; measured far below it on developer machines.
      expect(elapsed).toBeLessThan(5000);
    }
  });
});

describe('meta tidak pernah disentuh package (BOARD-201)', () => {
  it('meta dokumen dan record bertahan utuh melewati transaksi dan load', () => {
    const meta = { owner: 'u1', nested: { list: [1, 'dua', null], kosong: undefined } };
    const doc = createEmptyDocument(meta);
    doc.records['el:1'] = makeElement({ meta: { custom: { deep: [true] }, n: Number.NaN } });
    const board = createBoard({ document: doc });
    const docMeta = board.getDocument().meta;

    board.transact((tx) => tx.put(makeElement({ id: 'el:2' })));
    board.transact((tx) => tx.put({ ...(tx.get('el:1') as ElementRecord), x: 3 }));

    expect(board.getDocument().meta).toBe(docMeta);
    expect(board.getDocument().meta).toEqual(meta);
    expect('kosong' in (board.getDocument().meta.nested as object)).toBe(true);
    expect(board.getElement('el:1')!.meta).toEqual({ custom: { deep: [true] }, n: Number.NaN });
    // Consumer input is not frozen or modified.
    expect(Object.isFrozen(meta)).toBe(false);
    expect(Object.isFrozen(doc.records['el:1']!)).toBe(false);
  });
});

describe('event change', () => {
  it('on mengembalikan unsubscribe dan dua board tidak berbagi listener', () => {
    const a = createBoard();
    const b = createBoard();
    const fa = vi.fn();
    const fb = vi.fn();
    const offA = a.on('change', fa);
    b.on('change', fb);

    a.transact((tx) => tx.put(makeElement()));
    expect(fa).toHaveBeenCalledTimes(1);
    expect(fb).not.toHaveBeenCalled();

    offA();
    offA();
    a.transact((tx) => tx.put(makeElement({ x: 1 })));
    expect(fa).toHaveBeenCalledTimes(1);
  });

  it('fungsi yang sama boleh didaftarkan dua kali dan dilepas satu per satu', () => {
    const board = createBoard();
    const fn = vi.fn();
    const off1 = board.on('change', fn);
    board.on('change', fn);
    off1();
    board.transact((tx) => tx.put(makeElement()));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(() => board.on('change', 'x' as unknown as () => void)).toThrow(TypeError);
  });

  it('listener yang melempar tidak menghentikan listener lain; error diteruskan ke event error', () => {
    // BOARD-207 replaces the BOARD-204 behavior: listener errors are no longer rethrown from
    // transact, but emitted as an `error` event (one per throwing listener).
    const board = createBoard();
    const later = vi.fn();
    const errors: unknown[] = [];
    board.on('error', (e) => errors.push(e.cause));
    board.on('change', () => {
      throw new Error('listener rusak');
    });
    board.on('change', () => {
      throw new Error('kedua');
    });
    board.on('change', later);
    expect(() => board.transact((tx) => tx.put(makeElement()))).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    expect(board.getElement('el:1')).toBeDefined();
    expect(errors.map((e) => (e as Error).message)).toEqual(['listener rusak', 'kedua']);
  });

  it('listener yang dilepas oleh listener lain selama emit tidak dipanggil', () => {
    const board = createBoard();
    const second = vi.fn();
    let offSecond = (): void => {};
    board.on('change', () => offSecond());
    offSecond = board.on('change', second);
    board.transact((tx) => tx.put(makeElement()));
    expect(second).not.toHaveBeenCalled();
  });

  it('listener boleh menjalankan transaksi baru (event terpisah)', () => {
    const board = createBoard();
    const origins: string[] = [];
    board.on('change', (e) => {
      origins.push(e.origin);
      if (e.origin === 'local') {
        board.transact((tx) => tx.put(makeElement({ id: 'el:echo' })), { origin: 'remote' });
      }
    });
    board.transact((tx) => tx.put(makeElement()));
    expect(origins).toEqual(['local', 'remote']);
    expect(board.getElement('el:echo')).toBeDefined();
  });

  it('dispose melepas listener dan menolak transaksi berikutnya', () => {
    const board = createBoard();
    const fn = vi.fn();
    board.on('change', fn);
    board.dispose();
    expect(() => board.transact(() => {})).toThrow(/dispose/);
    expect(() => board.loadDocument(createEmptyDocument())).toThrow(/dispose/);
    const off = board.on('change', fn);
    off();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('ID record khusus', () => {
  it('ID "__proto__" dan nama properti Object.prototype diperlakukan sebagai data biasa', () => {
    const board = createBoard();
    expect(board.getElement('toString')).toBeUndefined();
    board.transact((tx) => {
      expect(tx.get('constructor')).toBeUndefined();
      expect(tx.remove('hasOwnProperty')).toBe(false);
      tx.put(makeElement({ id: '__proto__' }));
    });
    const records = board.getDocument().records;
    expect(Object.getPrototypeOf(records)).toBe(Object.prototype);
    expect(Object.keys(records)).toContain('__proto__');
    expect(board.getElement('__proto__')?.id).toBe('__proto__');

    const events: ChangeEvent[] = [];
    board.on('change', (e) => events.push(e));
    board.transact((tx) => tx.remove('__proto__'));
    expect(Object.keys(events[0]!.removed)).toEqual(['__proto__']);
    expect(Object.keys(board.getDocument().records)).not.toContain('__proto__');
  });
});

describe('deepEqual', () => {
  it.each([
    [1, 1, true],
    [Number.NaN, Number.NaN, true],
    [0, -0, false],
    [{ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }, true],
    [{ a: undefined }, {}, false],
    [{ a: 1 }, { b: 1 }, false],
    [[1, 2], { 0: 1, 1: 2 }, false],
    [new Uint8Array([1, 2]), new Uint8Array([1, 2]), true],
    [new Uint8Array([1, 2]), new Uint8Array([1, 3]), false],
    [new Uint8Array([1]), [1], false],
    [null, {}, false],
    ['a', 'a', true],
  ])('deepEqual(%o, %o) = %s', (a, b, expected) => {
    expect(deepEqual(a, b)).toBe(expected);
  });
});

// --- Property-based tests ---------------------------------------------------------------

const IDS = ['el:a', 'el:b', 'el:c', 'el:d', 'page:main'] as const;

type Op =
  | { kind: 'put'; id: string; x: number; text: string }
  | { kind: 'remove'; id: string }
  | { kind: 'nested'; ops: Op[]; fail: boolean };

const leafOp: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('put' as const),
    id: fc.constantFrom(...IDS),
    x: fc.integer({ min: 0, max: 3 }),
    text: fc.constantFrom('', 'a', 'b'),
  }),
  fc.record({ kind: fc.constant('remove' as const), id: fc.constantFrom(...IDS) }),
);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: leafOp },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('nested' as const),
      ops: fc.array(leafOp, { maxLength: 4 }),
      fail: fc.boolean(),
    }),
  },
);

const txArb = fc.record({
  ops: fc.array(opArb, { maxLength: 8 }),
  fail: fc.boolean(),
  origin: fc.constantFrom<ChangeOrigin>(...CHANGE_ORIGINS),
});

function recordFor(id: string, x: number, text: string): BoardRecord {
  if (id.startsWith('page:')) {
    return { id, kind: 'page', name: text, index: 'a0', meta: { x } };
  }
  return makeElement({ id, x, props: { text } });
}

/** Reference model: a plain Map with rollback via copies. */
function applyModel(model: Map<string, BoardRecord>, ops: Op[]): void {
  for (const op of ops) {
    if (op.kind === 'put') model.set(op.id, recordFor(op.id, op.x, op.text));
    else if (op.kind === 'remove') model.delete(op.id);
    else {
      const copy = new Map(model);
      applyModel(copy, op.ops);
      if (!op.fail) {
        model.clear();
        for (const [k, v] of copy) model.set(k, v);
      }
    }
  }
}

function applyBoard(board: ReturnType<typeof createBoard>, tx: Transaction, ops: Op[]): void {
  for (const op of ops) {
    if (op.kind === 'put') tx.put(recordFor(op.id, op.x, op.text));
    else if (op.kind === 'remove') tx.remove(op.id);
    else {
      try {
        board.transact((inner) => {
          applyBoard(board, inner, op.ops);
          if (op.fail) throw new Error('gagal bersarang');
        });
      } catch {
        // Caught by the outer transaction: only the inner changes are rolled back.
      }
    }
  }
}

describe('property-based (BOARD-204)', () => {
  it('menerapkan semua diff ke salinan dokumen menghasilkan state yang sama', () => {
    fc.assert(
      fc.property(fc.array(txArb, { maxLength: 15 }), fc.boolean(), (txs, freezeSnapshots) => {
        const board = createBoard({ freezeSnapshots });
        const mirror: Record<string, BoardRecord> = structuredClone({
          ...board.getDocument().records,
        });
        const model = new Map<string, BoardRecord>(Object.entries(mirror));
        const events: ChangeEvent[] = [];
        let previous = board.getDocument().records;
        board.on('change', (event) => {
          events.push(event);
          // The diff is consistent with the previous snapshot.
          for (const [id, rec] of Object.entries(event.removed)) {
            expect(previous[id]).toBe(rec);
          }
          for (const [id, { before, after }] of Object.entries(event.updated)) {
            expect(previous[id]).toBe(before);
            expect(deepEqual(before, after)).toBe(false);
          }
          for (const id of Object.keys(event.added)) {
            expect(Object.prototype.hasOwnProperty.call(previous, id)).toBe(false);
          }
          previous = board.getDocument().records;
          applyEvent(mirror, event);
        });

        for (const t of txs) {
          const countBefore = events.length;
          const snapshotBefore = board.getDocument();
          try {
            board.transact(
              (tx) => {
                applyBoard(board, tx, t.ops);
                if (t.fail) throw new Error('gagal');
              },
              { origin: t.origin, label: 'acak' },
            );
          } catch (error) {
            expect((error as Error).message).toBe('gagal');
          }
          if (t.fail) {
            expect(board.getDocument()).toBe(snapshotBefore);
          } else {
            applyModel(model, t.ops);
          }
          // One transaction produces at most one event.
          expect(events.length - countBefore).toBeLessThanOrEqual(1);
        }

        const records = board.getDocument().records;
        expect(deepEqual(mirror, records)).toBe(true);
        expect(deepEqual(Object.fromEntries(model), records)).toBe(true);
        expect(validateDocument(board.getDocument()).valid).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
