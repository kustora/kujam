import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BOARD_LIMITS,
  InvalidDocumentError,
  array,
  createBoard,
  createElementRegistry,
  createEmptyDocument,
  defineElement,
  definePlugin,
  number,
  object,
  string,
  validateBoardRecord,
  validateDocument,
  type BoardDocument,
  type BoardErrorEvent,
  type ElementRecord,
} from '../index.js';

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
const plugin = definePlugin({ id: 'test-elements', elements: [noteElement, strokeElement] });
const registry = createElementRegistry([noteElement, strokeElement]);

function el(id: string, overrides: Partial<ElementRecord> = {}): ElementRecord {
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

function docOf(...records: unknown[]): BoardDocument {
  const doc = createEmptyDocument();
  const out: Record<string, unknown> = { ...doc.records };
  for (const rec of records) out[(rec as { id: string }).id] = rec;
  return { ...doc, records: out as BoardDocument['records'] };
}

function points(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => [i, i]);
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BOARD-210: validateDocument(doc, registry)', () => {
  it('reports record-level problems per record ID', () => {
    const doc = docOf(
      el('good'),
      el('bad-shape', { x: Number.NaN }),
      el('bad-props', { props: { text: 'x'.repeat(21) } }),
      el('extra-key', { props: { text: 'ok', stray: 1 } }),
    );
    const result = validateDocument(doc, registry);
    expect(result.valid).toBe(false);
    expect(Object.keys(result.invalidRecords).sort()).toEqual([
      'bad-props',
      'bad-shape',
      'extra-key',
    ]);
    expect(result.invalidRecords['bad-props']![0]).toContain('tidak lolos skema tipe "note"');
    expect(result.errors).toHaveLength(3);
  });

  it('checks structure only without a registry, and skips unregistered types with one', () => {
    const doc = docOf(
      el('bad-props', { props: { text: 42 } }),
      el('foreign', { type: 'vendor.thing', props: { anything: [1, 2] } }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect(Object.keys(validateDocument(doc, registry).invalidRecords)).toEqual(['bad-props']);
  });

  it('keeps document-level problems out of invalidRecords', () => {
    const result = validateDocument({ schemaVersion: 1, meta: {}, records: [] });
    expect(result.valid).toBe(false);
    expect(result.invalidRecords).toEqual({});
  });

  it('accepts a plain registry-like validator (for servers)', () => {
    const doc = docOf(el('a'));
    const validator = { validateElementProps: vi.fn(registry.validateElementProps) };
    expect(validateDocument(doc, validator).valid).toBe(true);
    expect(validator.validateElementProps).toHaveBeenCalledWith('note', { text: 'ok' });
  });
});

describe('BOARD-210: default and configurable limits', () => {
  it('defaults to 10 MB, 5,000 elements, and 5,000 points per stroke', () => {
    expect(DEFAULT_BOARD_LIMITS).toEqual({
      maxDocumentBytes: 10 * 1024 * 1024,
      maxElements: 5_000,
      maxDrawPoints: 5_000,
    });
    expect(createBoard().limits).toEqual(DEFAULT_BOARD_LIMITS);
  });

  it('enforces the element count by default and through limits', () => {
    const many = (n: number): BoardDocument =>
      docOf(...Array.from({ length: n }, (_, i) => el(`e${i}`)));
    expect(validateDocument(many(5_000)).valid).toBe(true);
    const over = validateDocument(many(5_001));
    expect(over.valid).toBe(false);
    expect(over.errors[0]).toContain('melebihi batas maksimum (5000)');

    expect(validateDocument(many(3), undefined, { limits: { maxElements: 2 } }).valid).toBe(false);
    expect(validateDocument(many(2), undefined, { limits: { maxElements: 2 } }).valid).toBe(true);
  });

  it('does not count rejected records toward the element limit', () => {
    const doc = docOf(el('a'), el('b'), el('broken', { w: -1 }));
    const result = validateDocument(doc, undefined, { limits: { maxElements: 2 } });
    expect(Object.keys(result.invalidRecords)).toEqual(['broken']);
    expect(result.errors).toHaveLength(1);
  });

  it('enforces stroke points per record, by default and through limits', () => {
    const doc = docOf(
      el('ok', { type: 'stroke', props: { points: points(5_000) } }),
      el('long', { type: 'stroke', props: { points: points(5_001) } }),
    );
    expect(Object.keys(validateDocument(doc).invalidRecords)).toEqual(['long']);
    const custom = validateDocument(doc, undefined, { limits: { maxDrawPoints: 10 } });
    expect(Object.keys(custom.invalidRecords).sort()).toEqual(['long', 'ok']);
  });

  it('measures the document as UTF-8 JSON bytes', () => {
    const doc = docOf(el('u', { props: { text: 'ünï 📌 漢字' } }));
    const exact = utf8Bytes(doc);
    expect(validateDocument(doc, undefined, { limits: { maxDocumentBytes: exact } }).valid).toBe(
      true,
    );
    const over = validateDocument(doc, undefined, { limits: { maxDocumentBytes: exact - 1 } });
    expect(over.valid).toBe(false);
    expect(over.invalidRecords).toEqual({});
    expect(over.errors[0]).toContain(`(${exact} byte)`);
  });

  it('rejects the 10 MB default for an oversized document', () => {
    const big = docOf(el('big', { type: 'blob', props: { data: 'x'.repeat(10 * 1024 * 1024) } }));
    expect(validateDocument(big).valid).toBe(false);
  });

  it('rejects invalid limits options', () => {
    expect(() => validateDocument(docOf(), undefined, { limits: { maxElements: 0 } })).toThrow(
      RangeError,
    );
  });

  it('board.create and board.update enforce maxDrawPoints with limit-exceeded', () => {
    const board = createBoard({ plugins: [plugin], limits: { maxDrawPoints: 3 } });
    const errors: BoardErrorEvent[] = [];
    board.on('error', (e) => errors.push(e));

    expect(board.create({ type: 'stroke', props: { points: points(4) } })).toBeUndefined();
    const s = board.create({ id: 's', type: 'stroke', props: { points: points(3) } });
    expect(s).toBeDefined();
    expect(board.update('s', { props: { points: points(4) } })).toBeUndefined();
    expect(board.getElement('s')!.props).toEqual({ points: points(3) });
    expect(errors.map((e) => e.code)).toEqual(['limit-exceeded', 'limit-exceeded']);
  });

  it('createBoard and loadDocument throw for documents over the byte or element limit', () => {
    const doc = docOf(el('a'), el('b'), el('c'));
    expect(() => createBoard({ document: doc, limits: { maxElements: 2 } })).toThrow(
      InvalidDocumentError,
    );

    const board = createBoard({ limits: { maxDocumentBytes: 1_000 } });
    const before = board.getDocument();
    const big = docOf(el('big', { type: 'blob', props: { data: 'x'.repeat(2_000) } }));
    expect(() => board.loadDocument(big)).toThrow(InvalidDocumentError);
    expect(board.getDocument()).toBe(before);
  });
});

describe('BOARD-210: invalid incoming records are rejected one by one', () => {
  const mixed = (): BoardDocument =>
    docOf(
      el('good'),
      el('good-foreign', { type: 'vendor.thing', props: { keep: true } }),
      el('bad-shape', { opacity: 5 }),
      el('bad-props', { props: { text: 7 } }),
      el('too-long', { type: 'stroke', props: { points: points(6) } }),
      { id: 'bad-kind', kind: 'mystery' },
    );

  it('loadDocument loads the rest and reports each rejected record after change', () => {
    const board = createBoard({ plugins: [plugin], limits: { maxDrawPoints: 5 } });
    const log: string[] = [];
    const errors: BoardErrorEvent[] = [];
    board.on('change', () => log.push('change'));
    board.on('error', (e) => {
      log.push('error');
      errors.push(e);
    });

    board.loadDocument(mixed());

    expect(Object.keys(board.getDocument().records).sort()).toEqual([
      'good',
      'good-foreign',
      'page:main',
    ]);
    expect(errors.every((e) => e.code === 'invalid-record')).toBe(true);
    expect(errors.map((e) => (e.cause as { id: string }).id).sort()).toEqual([
      'bad-kind',
      'bad-props',
      'bad-shape',
      'too-long',
    ]);
    const cause = errors.find((e) => (e.cause as { id: string }).id === 'bad-props')!.cause as {
      errors: string[];
      record: unknown;
    };
    expect(cause.errors[0]).toContain('props tidak lolos skema');
    expect(cause.record).toMatchObject({ id: 'bad-props', props: { text: 7 } });
    expect(log).toEqual(['change', 'error', 'error', 'error', 'error']);
  });

  it('createBoard loads the rest and reports to listeners attached right after creation', async () => {
    const board = createBoard({
      plugins: [plugin],
      document: mixed(),
      limits: { maxDrawPoints: 5 },
    });
    const errors: BoardErrorEvent[] = [];
    board.on('error', (e) => errors.push(e));

    expect(board.getElement('good')).toBeDefined();
    expect(board.getElement('bad-props')).toBeUndefined();
    expect(errors).toHaveLength(0);

    await Promise.resolve();
    expect(errors.map((e) => e.code)).toEqual(Array(4).fill('invalid-record'));
  });

  it('logs rejected records to console.error when there is no error listener', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createBoard({ document: docOf(el('good'), el('bad', { x: Number.NaN })) });
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain('Record "bad"');
  });

  it('does not report after the board is disposed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const board = createBoard({ document: docOf(el('bad', { x: Number.NaN })) });
    board.dispose();
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps a valid record with the ID __proto__ as data when others are rejected', () => {
    const json = JSON.stringify(docOf(el('bad', { w: -1 }))).replace(
      '"records":{',
      `"records":{"__proto__":${JSON.stringify(el('__proto__'))},`,
    );
    const doc = JSON.parse(json) as BoardDocument;
    const board = createBoard();
    board.on('error', () => {});
    board.loadDocument(doc);
    expect(Object.keys(board.getDocument().records).sort()).toEqual(['__proto__', 'page:main']);
    expect(board.getElement('__proto__')).toMatchObject({ kind: 'element' });
  });
});

describe('BOARD-2004: validateBoardRecord(record, registry)', () => {
  it('accepts a valid record and matches validateDocument per record', () => {
    expect(validateBoardRecord(el('a'), registry)).toEqual([]);
    const bad = el('b', { props: { text: 123 } as never, opacity: 2 });
    expect(validateBoardRecord(bad, registry)).toEqual(
      validateDocument(docOf(bad), registry).invalidRecords['b'],
    );
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['an empty id', { ...el('a'), id: '' }],
    ['a missing meta', { ...el('a'), meta: undefined }],
    ['an unknown kind', { id: 'a', kind: 'evil' }],
    ['NaN coordinates', el('a', { x: Number.NaN })],
  ])('rejects %s', (_label, record) => {
    expect(validateBoardRecord(record, registry).length).toBeGreaterThan(0);
  });

  it('checks props against the registered schema only with a registry', () => {
    const bad = el('a', { props: { text: 'x'.repeat(50) } });
    expect(validateBoardRecord(bad)).toEqual([]);
    expect(validateBoardRecord(bad, registry)[0]).toContain('props tidak lolos skema tipe "note"');
  });

  it('skips props of unregistered types and of other type versions', () => {
    expect(validateBoardRecord(el('a', { type: 'custom', props: { any: 1 } }), registry)).toEqual(
      [],
    );
    const migrating = el('a', { typeVersion: 2, props: { text: 1 } as never });
    expect(validateBoardRecord(migrating, registry)).toEqual([]);
    // Without `get`, the type version cannot be compared, so props are checked.
    const propsOnly = { validateElementProps: registry.validateElementProps };
    expect(validateBoardRecord(migrating, propsOnly).length).toBe(1);
  });

  it('enforces the stroke point limit', () => {
    const stroke = el('s', { type: 'stroke', props: { points: points(11) } });
    expect(validateBoardRecord(stroke, registry, { limits: { maxDrawPoints: 10 } })[0]).toContain(
      'melebihi batas maksimum (10)',
    );
    expect(validateBoardRecord(stroke, registry, { limits: { maxDrawPoints: 11 } })).toEqual([]);
  });
});
