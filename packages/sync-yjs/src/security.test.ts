import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  InvalidDocumentError,
  array,
  attachSync,
  createBoard,
  createElementRegistry,
  defineElement,
  definePlugin,
  number,
  object,
  string,
  validateBoardRecord,
  validateDocument,
  type Board,
  type BoardErrorEvent,
  type BoardLimits,
  type ElementRecord,
} from '@kujam/core';
import {
  InvalidUpdateError,
  createYjsSyncAdapter,
  documentToUpdate,
  recordToYMap,
  updateToDocument,
  updateToYDoc,
} from './index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string({ maxLength: 20 }) }),
  defaults: { text: '' },
});
const strokeElement = defineElement({
  type: 'stroke',
  version: 1,
  props: object({ points: array(array(number())) }),
  defaults: { points: [] },
});
const elements = [noteElement, strokeElement];
const plugin = definePlugin({ id: 'security-elements', elements });
const registry = createElementRegistry(elements);

function note(id: string, overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'note',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 0,
    y: 0,
    rotation: 0,
    w: 10,
    h: 10,
    locked: false,
    opacity: 1,
    props: { text: 'ok' },
    meta: {},
    ...overrides,
  };
}

function points(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => [i, i]);
}

interface Client {
  board: Board;
  doc: Y.Doc;
  errors: BoardErrorEvent[];
}

function client(limits?: Partial<BoardLimits>): Client {
  const board = createBoard({ plugins: [plugin], ...(limits ? { limits } : {}) });
  const doc = new Y.Doc();
  attachSync(board, createYjsSyncAdapter({ doc, history: false, indexeddb: false }));
  const errors: BoardErrorEvent[] = [];
  board.on('error', (e) => errors.push(e));
  return { board, doc, errors };
}

/** A peer that bypasses every client-side check and writes straight to its own `Y.Doc`. */
function attacker() {
  const doc = new Y.Doc();
  const records = doc.getMap<Y.Map<unknown>>('records');
  return {
    doc,
    records,
    /** Writes a record with the regular mapping (props as a nested `Y.Map`). */
    put(record: Record<string, unknown>, key = record.id as string) {
      doc.transact(() => {
        const map = new Y.Map<unknown>();
        records.set(key, map);
        recordToYMap(record as unknown as ElementRecord, map);
      });
    },
    /** Writes raw values into a record map without any mapping. */
    raw(key: string, fields: Record<string, unknown>) {
      doc.transact(() => {
        const map = new Y.Map<unknown>();
        records.set(key, map);
        for (const [k, v] of Object.entries(fields)) map.set(k, v);
      });
    },
    /** Sends everything the attacker has to the given clients, as a relay server would. */
    broadcast(...clients: Client[]) {
      for (const c of clients) {
        Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(c.doc)), 'relay');
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(c.doc, Y.encodeStateVector(doc)), 'relay');
      }
    },
  };
}

function relay(from: Client, ...to: Client[]): void {
  for (const c of to) {
    Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(from.doc, Y.encodeStateVector(c.doc)), 'relay');
  }
}

function codes(c: Client): string[] {
  return c.errors.map((e) => e.code);
}

describe('BOARD-2004: a malicious peer cannot change the state of other clients', () => {
  it('drops elements whose props fail the registered schema', () => {
    const a = client();
    const b = client();
    const evil = attacker();
    evil.put(note('ok'));
    evil.put(note('wrong-type', { props: { text: 123 } as never }));
    evil.put(note('too-long', { props: { text: 'x'.repeat(100) } }));
    evil.broadcast(a, b);

    for (const c of [a, b]) {
      expect(c.board.getElement('ok')).toBeDefined();
      expect(c.board.getElement('wrong-type')).toBeUndefined();
      expect(c.board.getElement('too-long')).toBeUndefined();
      expect(codes(c).filter((code) => code === 'invalid-record')).toHaveLength(2);
    }
    const cause = a.errors[0]!.cause as { id: string; errors: string[] };
    expect(cause.errors[0]).toContain('props tidak lolos skema tipe "note"');
  });

  it('keeps the last valid value when a peer corrupts an existing element', () => {
    const a = client();
    const b = client();
    a.board.transact((tx) => tx.put(note('n1', { props: { text: 'hello' } })));
    relay(a, b);
    expect(b.board.getElement('n1')?.props).toEqual({ text: 'hello' });

    // The attacker joins and edits the nested props map directly.
    const evil = attacker();
    evil.broadcast(b);
    const props = evil.records.get('n1')!.get('props') as Y.Map<unknown>;
    evil.doc.transact(() => props.set('text', { $evil: true }));
    evil.broadcast(a, b);

    expect(a.board.getElement('n1')?.props).toEqual({ text: 'hello' });
    expect(b.board.getElement('n1')?.props).toEqual({ text: 'hello' });

    // A later valid write from an honest client is applied again.
    a.board.update('n1', { props: { text: 'fixed' } });
    relay(a, b);
    expect(b.board.getElement('n1')?.props).toEqual({ text: 'fixed' });
  });

  it('drops strokes over the point limit', () => {
    const b = client({ maxDrawPoints: 10 });
    const evil = attacker();
    evil.put(note('s-ok', { type: 'stroke', props: { points: points(10) } }));
    evil.put(note('s-big', { type: 'stroke', props: { points: points(11) } }));
    evil.broadcast(b);
    expect(b.board.getElement('s-ok')).toBeDefined();
    expect(b.board.getElement('s-big')).toBeUndefined();
  });

  it('drops new elements beyond maxElements but keeps updating existing ones', () => {
    const b = client({ maxElements: 3 });
    b.board.transact((tx) => tx.put(note('mine')));
    const evil = attacker();
    evil.broadcast(b);
    for (let i = 0; i < 5; i++) evil.put(note(`spam-${i}`));
    evil.broadcast(b);

    const ids = Object.values(b.board.getDocument().records)
      .filter((r) => r.kind === 'element')
      .map((r) => r.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('mine');
    expect(codes(b)).toContain('limit-exceeded');

    // Updates to elements the board already has are still applied at the limit.
    evil.put(note('mine', { x: 42 }));
    evil.broadcast(b);
    expect(b.board.getElement('mine')?.x).toBe(42);
  });

  it('drops records the store would reject without dropping the rest of the update', () => {
    const b = client();
    const evil = attacker();
    // These pass the structural check of `isValidBoardRecord` but not the store's rules; before
    // BOARD-2004 the store threw inside the remote transaction and the whole update was lost.
    evil.put(note('bad-opacity', { opacity: 5 }));
    evil.put(note('negative-size', { w: -1 }));
    evil.put(note('fine'));
    // A missing meta is filled in by the mapping, so the record is accepted.
    evil.put({ ...note('no-meta'), meta: undefined });
    evil.broadcast(b);

    expect(b.board.getElement('fine')).toBeDefined();
    expect(b.board.getElement('no-meta')?.meta).toEqual({});
    for (const id of ['bad-opacity', 'negative-size']) {
      expect(b.board.getElement(id)).toBeUndefined();
    }
  });

  it('drops records stored under a key that differs from their id', () => {
    const b = client();
    b.board.transact((tx) => tx.put(note('victim', { x: 1 })));
    const evil = attacker();
    evil.put(note('victim', { x: 999 }), 'decoy');
    evil.broadcast(b);
    expect(b.board.getElement('victim')?.x).toBe(1);
    expect(b.board.getElement('decoy')).toBeUndefined();
  });

  it('does not pollute prototypes through __proto__ keys', () => {
    const b = client();
    const evil = attacker();
    evil.put(note('__proto__'));
    evil.raw('constructor', { id: 'constructor', kind: 'element', polluted: true });
    evil.put(note('n', { props: { text: 'ok', __proto__: { polluted: true } } as never }));
    evil.broadcast(b);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(validateDocument(b.board.getDocument(), registry).valid).toBe(true);
  });

  it('validates the initial sync too and keeps local copies of invalid remote records', () => {
    const evil = attacker();
    evil.put(note('shared', { props: { text: 7 } as never }));
    evil.put(note('remote-ok'));

    const board = createBoard({ plugins: [plugin] });
    board.transact((tx) => tx.put(note('shared', { props: { text: 'local' } })));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(evil.doc));
    attachSync(board, createYjsSyncAdapter({ doc, history: false, indexeddb: false }));

    expect(board.getElement('remote-ok')).toBeDefined();
    expect(board.getElement('shared')?.props).toEqual({ text: 'local' });
  });

  it('fuzz: random peer records never break the board or reach it invalid', () => {
    const value = fc.oneof(
      fc.jsonValue(),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, -0, '', '__proto__'),
    );
    const field = fc.constantFrom(
      'id',
      'kind',
      'type',
      'pageId',
      'parentId',
      'index',
      'x',
      'w',
      'opacity',
      'locked',
      'props',
      'meta',
      'typeVersion',
    );
    const record = fc.record({
      key: fc.constantFrom('a', 'b', 'c', '__proto__', 'page:main'),
      type: fc.constantFrom('note', 'stroke', 'unknown'),
      // Mostly valid records with one or two bad fields, so updates are often partly accepted.
      overrides: fc.oneof(fc.constant({}), fc.dictionary(field, value, { maxKeys: 2 })),
    });

    let accepted = 0;
    fc.assert(
      fc.property(fc.array(record, { maxLength: 8 }), (writes) => {
        const b = client({ maxElements: 5, maxDrawPoints: 50 });
        const evil = attacker();
        evil.broadcast(b);
        for (const { key, type, overrides } of writes) {
          evil.put({ ...note(key, { type }), ...overrides }, key);
        }
        expect(() => evil.broadcast(b)).not.toThrow();
        accepted += Object.keys(b.board.getDocument().records).length > 1 ? 1 : 0;

        const doc = b.board.getDocument();
        const result = validateDocument(doc, registry, { limits: b.board.limits });
        expect(result.errors).toEqual([]);
        for (const r of Object.values(doc.records)) {
          expect(validateBoardRecord(r, registry, { limits: b.board.limits })).toEqual([]);
        }
      }),
      { numRuns: 150, seed: 2004 },
    );
    // Guard against a generator that only produces records that are rejected outright.
    expect(accepted).toBeGreaterThan(50);
  });
});

describe('BOARD-2004: corrupt or oversized Yjs updates', () => {
  const sample = documentToUpdate({
    schemaVersion: 1,
    meta: { title: 'fuzz' },
    records: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`n${i}`, note(`n${i}`, { x: i })]),
    ),
  });

  /** Only these errors may come out of decoding untrusted bytes. */
  function expectSafe(run: () => unknown): void {
    try {
      const doc = run();
      if (doc && typeof doc === 'object' && 'records' in doc) {
        for (const r of Object.values((doc as { records: object }).records)) {
          expect(validateBoardRecord(r, registry)).toEqual([]);
        }
      }
    } catch (error) {
      expect([InvalidUpdateError, InvalidDocumentError]).toContainEqual(
        (error as object).constructor,
      );
    }
  }

  it('rejects updates over maxUpdateBytes before decoding them', () => {
    const target = new Y.Doc();
    expect(() => updateToYDoc(sample, { doc: target, maxUpdateBytes: 10 })).toThrow(
      InvalidUpdateError,
    );
    expect(target.getMap('records').size).toBe(0);
    expect(() => updateToDocument(sample, { maxUpdateBytes: sample.byteLength - 1 })).toThrow(
      /melebihi batas maksimum/,
    );
    expect(updateToDocument(sample, { maxUpdateBytes: sample.byteLength }).records).toHaveProperty(
      'n0',
    );
    // limits.maxDocumentBytes is the default update size limit.
    expect(() => updateToDocument(sample, { limits: { maxDocumentBytes: 10 } })).toThrow(
      InvalidUpdateError,
    );
  });

  it('validates its input type and maxUpdateBytes', () => {
    expect(() => updateToYDoc([1, 2] as unknown as Uint8Array)).toThrow(TypeError);
    expect(() => updateToYDoc(sample, { maxUpdateBytes: 0 })).toThrow(RangeError);
  });

  it('wraps Yjs decoding errors in InvalidUpdateError with the cause', () => {
    const error = (() => {
      try {
        updateToDocument(sample.slice(0, 7));
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(InvalidUpdateError);
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it('rejects decoded documents over the element limit', () => {
    expect(() => updateToDocument(sample, { limits: { maxElements: 5 } })).toThrow(
      InvalidDocumentError,
    );
  });

  it('drops records with invalid props when given a registry', () => {
    const update = documentToUpdate({
      schemaVersion: 1,
      meta: {},
      records: { good: note('good'), bad: note('bad', { props: { text: 1 } as never }) },
    });
    expect(Object.keys(updateToDocument(update).records).sort()).toEqual(['bad', 'good']);
    expect(Object.keys(updateToDocument(update, { registry }).records)).toEqual(['good']);
  });

  it('fuzz: random bytes only produce InvalidUpdateError', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        expectSafe(() => updateToDocument(bytes, { registry }));
      }),
      { numRuns: 1000, seed: 2004 },
    );
  });

  it('fuzz: mutated and truncated valid updates only produce typed errors', () => {
    const mutation = fc.record({
      cut: fc.nat({ max: sample.byteLength }),
      flips: fc.array(
        fc.tuple(fc.nat({ max: sample.byteLength - 1 }), fc.integer({ min: 0, max: 255 })),
        {
          maxLength: 6,
        },
      ),
    });
    fc.assert(
      fc.property(mutation, ({ cut, flips }) => {
        const bytes = sample.slice();
        for (const [at, value] of flips) bytes[at] = value;
        expectSafe(() => updateToDocument(bytes.slice(0, Math.max(cut, 1)), { registry }));
        expectSafe(() => updateToDocument(bytes, { registry }));
      }),
      { numRuns: 1000, seed: 2004 },
    );
  });
});
