import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidDocumentError,
  createBoard,
  createElementRegistry,
  createEmptyDocument,
  defineElement,
  definePlugin,
  object,
  string,
  validateDocument,
  type BoardDocument,
} from '../index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string({ maxLength: 20 }) }),
  defaults: { text: '' },
});
const plugin = definePlugin({ id: 'fuzz-elements', elements: [noteElement] });
const registry = createElementRegistry([noteElement]);
const limits = { maxElements: 10, maxDrawPoints: 20, maxDocumentBytes: 20_000 };

const nasty = fc.oneof(
  fc.jsonValue({ maxDepth: 3 }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, -0, undefined, null, '', '__proto__'),
);

/** Element-like records with a few fields replaced by random values. */
const looseRecord = fc
  .record({
    id: fc.constantFrom('a', 'b', 'c', '__proto__', 'constructor', 'page:main'),
    overrides: fc.oneof(
      fc.constant({}),
      fc.dictionary(
        fc.constantFrom('id', 'kind', 'type', 'pageId', 'x', 'w', 'opacity', 'props', 'meta'),
        nasty,
        { maxKeys: 2 },
      ),
    ),
  })
  .map(({ id, overrides }) => ({
    key: id,
    value: {
      id,
      kind: 'element',
      type: 'note',
      pageId: 'page:main',
      parentId: null,
      index: 'a1',
      x: 0,
      y: 0,
      rotation: 0,
      w: 1,
      h: 1,
      locked: false,
      opacity: 1,
      props: { text: 'ok' },
      meta: {},
      ...overrides,
    } as Record<string, unknown>,
  }));

/** Documents ranging from random JSON to almost-valid boards. */
const untrustedDocument = fc.oneof(
  { arbitrary: nasty, weight: 1 },
  {
    weight: 5,
    arbitrary: fc.record({
      schemaVersion: fc.oneof(
        { arbitrary: fc.constant(1), weight: 9 },
        { arbitrary: nasty, weight: 1 },
      ),
      meta: fc.oneof({ arbitrary: fc.constant({}), weight: 9 }, { arbitrary: nasty, weight: 1 }),
      records: fc.oneof(
        { arbitrary: nasty, weight: 1 },
        {
          weight: 9,
          arbitrary: fc.array(looseRecord, { maxLength: 15 }).map((items) => {
            const records: Record<string, unknown> = { ...createEmptyDocument().records };
            for (const { key, value } of items) {
              Object.defineProperty(records, key, { value, enumerable: true, configurable: true });
            }
            return records;
          }),
        },
      ),
    }),
  },
);

function expectOnlyInvalidDocumentError(run: () => void): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidDocumentError);
  }
}

describe('BOARD-2004: fuzz incoming JSON documents', () => {
  it('validateDocument never throws and reports a result', () => {
    fc.assert(
      fc.property(untrustedDocument, (doc) => {
        const result = validateDocument(doc, registry, { limits });
        expect(typeof result.valid).toBe('boolean');
      }),
      { numRuns: 500, seed: 2004 },
    );
  });

  it('createBoard and loadDocument only throw InvalidDocumentError and keep a valid document', () => {
    fc.assert(
      fc.property(untrustedDocument, (doc) => {
        expectOnlyInvalidDocumentError(() => {
          const board = createBoard({ plugins: [plugin], limits, document: doc as BoardDocument });
          expect(validateDocument(board.getDocument(), registry, { limits }).valid).toBe(true);
        });

        const board = createBoard({ plugins: [plugin], limits });
        const before = board.getDocument();
        try {
          board.loadDocument(doc as BoardDocument);
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidDocumentError);
          // A rejected document leaves the board untouched.
          expect(board.getDocument()).toBe(before);
        }
        expect(validateDocument(board.getDocument(), registry, { limits }).valid).toBe(true);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      }),
      { numRuns: 500, seed: 2004 },
    );
  });
});
