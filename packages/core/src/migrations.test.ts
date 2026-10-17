import { describe, expect, it, vi } from 'vitest';
import {
  CORE_MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  MigrationError,
  createBoard,
  createEmptyDocument,
  deepClone,
  defineElement,
  definePlugin,
  migrateSchema,
  number,
  object,
  optional,
  string,
  validateDocument,
  type BoardDocument,
  type ChangeOrigin,
  type ElementRecord,
  type SchemaMigrations,
} from './index.js';

function docAt(version: number, meta: Record<string, unknown> = {}): BoardDocument {
  return { ...createEmptyDocument(meta), schemaVersion: version };
}

describe('BOARD-701: core schema migrations', () => {
  it('has a step for every version below CURRENT_SCHEMA_VERSION', () => {
    for (let v = 1; v < CURRENT_SCHEMA_VERSION; v++) {
      expect(typeof CORE_MIGRATIONS[v]).toBe('function');
    }
    for (const key of Object.keys(CORE_MIGRATIONS)) {
      expect(Number(key)).toBeLessThan(CURRENT_SCHEMA_VERSION);
    }
  });

  it('every core step is pure and produces a valid document at the target version', () => {
    // Runs each real step on its own; covers future steps automatically.
    for (let v = 1; v < CURRENT_SCHEMA_VERSION; v++) {
      const input = docAt(v);
      const before = deepClone(input);
      const output = migrateSchema(input, CORE_MIGRATIONS, v + 1);
      expect(input).toEqual(before);
      expect(output.schemaVersion).toBe(v + 1);
    }
    const migrated = migrateSchema(docAt(1));
    expect(validateDocument(migrated)).toEqual({ valid: true, errors: [] });
  });

  it('runs steps in order until the target version', () => {
    const calls: number[] = [];
    const steps: SchemaMigrations = {
      1: (doc) => (calls.push(1), { ...doc, meta: { ...doc.meta, a: true } }),
      2: (doc) => (calls.push(2), { ...doc, meta: { ...doc.meta, b: doc.meta.a } }),
      3: (doc) => (calls.push(3), { ...doc, meta: { ...doc.meta, c: true } }),
    };
    const result = migrateSchema(docAt(2, { a: 'x' }), steps, 4);
    expect(calls).toEqual([2, 3]);
    expect(result.schemaVersion).toBe(4);
    expect(result.meta).toEqual({ a: 'x', b: 'x', c: true });
    expect(Object.isFrozen(result)).toBe(false);
  });

  it('sets schemaVersion itself, regardless of what a step returns', () => {
    const steps: SchemaMigrations = { 1: (doc) => ({ ...doc, schemaVersion: 99 }) };
    expect(migrateSchema(docAt(1), steps, 2).schemaVersion).toBe(2);
  });

  it('never mutates the input; a mutating step fails', () => {
    const input = docAt(1, { n: 1 });
    const steps: SchemaMigrations = {
      1: (doc) => {
        doc.meta.n = 2;
        return doc;
      },
    };
    const error = (() => {
      try {
        migrateSchema(input, steps, 2);
      } catch (e) {
        return e;
      }
    })() as MigrationError;
    expect(error).toBeInstanceOf(MigrationError);
    expect(error.fromVersion).toBe(1);
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(input.meta.n).toBe(1);
  });

  it('fails on a missing step or a non-object result', () => {
    expect(() => migrateSchema(docAt(1), {}, 2)).toThrow(MigrationError);
    expect(() => migrateSchema(docAt(1), { 1: () => null as never }, 2)).toThrow(
      /wajib mengembalikan objek dokumen/,
    );
  });

  it('returns current, newer, and malformed documents unchanged', () => {
    const steps: SchemaMigrations = { 1: () => ({}) as never };
    const current = docAt(2);
    const newer = docAt(5);
    const malformed = { ...docAt(1), schemaVersion: 1.5 };
    expect(migrateSchema(current, steps, 2)).toBe(current);
    expect(migrateSchema(newer, steps, 2)).toBe(newer);
    expect(migrateSchema(malformed, steps, 2)).toBe(malformed);
  });
});

// ---------- BOARD-702 ----------

/** Version 3 of a card: v1 `{ title }` → v2 `{ label }` → v3 `{ label, size }`. */
const cardV3 = defineElement({
  type: 'card',
  version: 3,
  props: object({ label: string(), size: number() }),
  defaults: { label: '', size: 1 },
  migrate: {
    1: (props) => ({ label: props.title }),
    2: (props) => ({ ...props, size: 1 }),
  },
});

/** Version 3 without a step from 1 to 2: that version leaves props unchanged. */
const tagV3 = defineElement({
  type: 'tag',
  version: 3,
  props: object({ name: string(), color: optional(string()) }),
  defaults: { name: '' },
  migrate: { 2: (props) => ({ ...props, color: 'gray' }) },
});

const cards = definePlugin({ id: 'cards', elements: [cardV3, tagV3] });

function element(
  id: string,
  type: string,
  props: Record<string, unknown>,
  typeVersion?: number,
): ElementRecord {
  return {
    id,
    kind: 'element',
    type,
    pageId: 'page:main',
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    rotation: 0,
    w: 10,
    h: 10,
    locked: false,
    opacity: 1,
    props,
    meta: {},
    ...(typeVersion !== undefined ? { typeVersion } : {}),
  };
}

function docWith(...elements: ElementRecord[]): BoardDocument {
  const doc = createEmptyDocument();
  for (const el of elements) doc.records[el.id] = el;
  return doc;
}

describe('BOARD-702: element and plugin migrations', () => {
  it('board.create stores the type version', () => {
    const board = createBoard({ plugins: [cards] });
    expect(board.create({ type: 'card' })?.typeVersion).toBe(3);
  });

  it('migrates props from typeVersion (missing means 1) to the definition version', () => {
    const board = createBoard({ plugins: [cards] });
    board.loadDocument(
      docWith(
        element('v1', 'card', { title: 'old' }),
        element('v2', 'card', { label: 'mid' }, 2),
        element('v3', 'card', { label: 'new', size: 5 }, 3),
        element('t1', 'tag', { name: 'x' }, 1),
      ),
    );
    expect(board.getElement('v1')).toMatchObject({
      props: { label: 'old', size: 1 },
      typeVersion: 3,
    });
    expect(board.getElement('v2')).toMatchObject({
      props: { label: 'mid', size: 1 },
      typeVersion: 3,
    });
    expect(board.getElement('v3')).toMatchObject({
      props: { label: 'new', size: 5 },
      typeVersion: 3,
    });
    expect(board.getElement('t1')).toMatchObject({
      props: { name: 'x', color: 'gray' },
      typeVersion: 3,
    });
  });

  it('leaves unregistered types untouched', () => {
    const board = createBoard({ plugins: [cards] });
    const unknown = element('u', 'mystery', { anything: 1 });
    board.loadDocument(docWith(unknown));
    expect(board.getElement('u')).toEqual(unknown);
  });

  it('applies migrations with origin migration after load, outside undo history', () => {
    const board = createBoard({ plugins: [cards] });
    board.create({ type: 'card' });
    const origins: ChangeOrigin[] = [];
    board.on('change', (e) => origins.push(e.origin));

    board.loadDocument(docWith(element('v1', 'card', { title: 'old' })));
    expect(origins).toEqual(['load', 'migration']);
    expect(board.history.canUndo).toBe(false);
    expect(board.undo()).toBe(false);
    expect(board.getElement('v1')?.props).toEqual({ label: 'old', size: 1 });
  });

  it('emits only load when nothing needs migrating', () => {
    const board = createBoard({ plugins: [cards] });
    const origins: ChangeOrigin[] = [];
    board.on('change', (e) => origins.push(e.origin));
    board.loadDocument(docWith(element('v3', 'card', { label: 'new', size: 5 }, 3)));
    expect(origins).toEqual(['load']);
  });

  it('migrates the initial document of createBoard', () => {
    const board = createBoard({
      plugins: [cards],
      document: docWith(element('v1', 'card', { title: 'old' })),
    });
    expect(board.getElement('v1')?.props).toEqual({ label: 'old', size: 1 });
    expect(board.history.canUndo).toBe(false);
  });

  it('runs plugin document migrations after core and element migrations', () => {
    const seen: unknown[] = [];
    const plugin = definePlugin({
      id: 'audit',
      dependsOn: ['cards'],
      migrations: {
        0: (doc) => {
          seen.push((doc.records.v1 as ElementRecord).props);
          return { ...doc, meta: { ...doc.meta, audited: true } };
        },
      },
    });
    const board = createBoard({ plugins: [cards, plugin] });
    board.loadDocument(docWith(element('v1', 'card', { title: 'old' })));
    expect(seen).toEqual([{ label: 'old', size: 1 }]);
    expect(board.getDocument().meta).toEqual({ audited: true });
    expect(board.getDocument().pluginVersions).toEqual({ audit: 1 });
  });

  it('runs plugin steps only from the recorded plugin version', () => {
    const steps = { 0: vi.fn((d: BoardDocument) => d), 1: vi.fn((d: BoardDocument) => d) };
    const board = createBoard({ plugins: [definePlugin({ id: 'p', migrations: steps })] });
    board.loadDocument({ ...createEmptyDocument(), pluginVersions: { p: 1, other: 7 } });
    expect(steps[0]).not.toHaveBeenCalled();
    expect(steps[1]).toHaveBeenCalledTimes(1);
    expect(board.getDocument().pluginVersions).toEqual({ p: 2, other: 7 });
  });

  it('does not let plugin steps change schemaVersion or plugin versions', () => {
    const plugin = definePlugin({
      id: 'p',
      migrations: {
        0: (doc) => ({ ...doc, schemaVersion: 42, pluginVersions: { p: 9, q: 3 } }),
      },
    });
    const board = createBoard({ plugins: [plugin] });
    board.loadDocument(createEmptyDocument());
    expect(board.getDocument().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(board.getDocument().pluginVersions).toEqual({ p: 1 });
  });

  it('starts new boards at the latest plugin versions, so no plugin step runs', () => {
    const step = vi.fn((d: BoardDocument) => d);
    const board = createBoard({
      plugins: [definePlugin({ id: 'p', migrations: { 0: step, 1: step } })],
    });
    expect(board.getDocument().pluginVersions).toEqual({ p: 2 });
    expect(step).not.toHaveBeenCalled();
  });

  it('keeps pluginVersions through store snapshots and transactions', () => {
    const board = createBoard({ plugins: [cards] });
    board.loadDocument({ ...createEmptyDocument(), pluginVersions: { x: 3 } });
    board.create({ type: 'card' });
    expect(board.getDocument().pluginVersions).toEqual({ x: 3 });
    expect(createBoard().getDocument()).not.toHaveProperty('pluginVersions');
  });

  it('passes frozen copies: a mutating step fails and leaves the board unchanged', () => {
    const mutating = defineElement({
      type: 'bad',
      version: 2,
      props: object({ n: number() }),
      migrate: {
        1: (props) => {
          props.n = 2;
          return props;
        },
      },
    });
    const board = createBoard({ plugins: [definePlugin({ id: 'bad', elements: [mutating] })] });
    const before = board.getDocument();
    let error: unknown;
    try {
      board.loadDocument(docWith(element('b', 'bad', { n: 1 })));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({ fromVersion: 1, source: { kind: 'element', type: 'bad' } });
    expect(board.getDocument()).toBe(before);
  });

  it('createBoard disposes the board when an initial migration fails', () => {
    const teardown = vi.fn();
    const plugin = definePlugin({
      id: 'p',
      migrations: {
        0: () => {
          throw new Error('boom');
        },
      },
      setup: () => teardown,
    });
    expect(() => createBoard({ plugins: [plugin], document: createEmptyDocument() })).toThrow(
      MigrationError,
    );
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('validates typeVersion and pluginVersions', () => {
    const badType = docWith(element('a', 'card', {}, 0));
    expect(validateDocument(badType).errors).toEqual([
      'records["a"].typeVersion wajib berupa bilangan bulat positif.',
    ]);
    const badPlugins = { ...createEmptyDocument(), pluginVersions: { p: -1 } };
    expect(validateDocument(badPlugins).valid).toBe(false);
  });
});
