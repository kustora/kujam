import { describe, expect, it } from 'vitest';
import {
  MAX_SCHEMA_ISSUES,
  array,
  boolean,
  enumOf,
  literal,
  nullable,
  number,
  object,
  optional,
  schema,
  string,
  validate,
  type Schema,
} from '../index.js';

const issuesOf = (s: Schema<unknown>, value: unknown) => {
  const result = validate(s, value);
  return result.ok ? [] : result.issues.map(({ path, code }) => ({ path, code }));
};

describe('schema primitif (BOARD-203)', () => {
  it('string dengan batas panjang', () => {
    expect(issuesOf(string(), 'a')).toEqual([]);
    expect(issuesOf(string(), 1)).toEqual([{ path: [], code: 'type' }]);
    expect(issuesOf(string({ minLength: 2 }), 'a')).toEqual([{ path: [], code: 'too_small' }]);
    expect(issuesOf(string({ maxLength: 2 }), 'abc')).toEqual([{ path: [], code: 'too_big' }]);
    expect(issuesOf(string({ minLength: 1, maxLength: 3 }), 'ab')).toEqual([]);
  });

  it('number menolak NaN dan Infinity, dengan min, max, dan int', () => {
    expect(issuesOf(number(), 1.5)).toEqual([]);
    for (const bad of [Number.NaN, Infinity, -Infinity, '1', null]) {
      expect(issuesOf(number(), bad)).toEqual([{ path: [], code: 'type' }]);
    }
    expect(issuesOf(number({ int: true }), 1.5)).toEqual([{ path: [], code: 'not_integer' }]);
    expect(issuesOf(number({ min: 0 }), -1)).toEqual([{ path: [], code: 'too_small' }]);
    expect(issuesOf(number({ max: 10 }), 11)).toEqual([{ path: [], code: 'too_big' }]);
    expect(issuesOf(number({ min: 0, max: 10, int: true }), 10)).toEqual([]);
  });

  it('boolean, literal, dan enumOf', () => {
    expect(issuesOf(boolean(), false)).toEqual([]);
    expect(issuesOf(boolean(), 0)).toEqual([{ path: [], code: 'type' }]);
    expect(issuesOf(literal('sticky'), 'sticky')).toEqual([]);
    expect(issuesOf(literal(null), null)).toEqual([]);
    expect(issuesOf(literal(1), '1')).toEqual([{ path: [], code: 'literal' }]);
    expect(issuesOf(enumOf(['s', 'm', 'l']), 'm')).toEqual([]);
    expect(issuesOf(enumOf(['s', 'm', 'l']), 'xl')).toEqual([{ path: [], code: 'enum' }]);
  });

  it('nullable dan optional', () => {
    expect(issuesOf(nullable(string()), null)).toEqual([]);
    expect(issuesOf(nullable(string()), 1)).toEqual([{ path: [], code: 'type' }]);
    expect(issuesOf(optional(string()), undefined)).toEqual([]);
    expect(issuesOf(optional(string()), 1)).toEqual([{ path: [], code: 'type' }]);
  });

  it('array dengan path indeks dan batas panjang', () => {
    expect(issuesOf(array(number()), [1, 2])).toEqual([]);
    expect(issuesOf(array(number()), {})).toEqual([{ path: [], code: 'type' }]);
    expect(issuesOf(array(number()), [1, 'x', 3, null])).toEqual([
      { path: [1], code: 'type' },
      { path: [3], code: 'type' },
    ]);
    expect(issuesOf(array(number(), { maxLength: 2 }), [1, 2, 3])).toEqual([
      { path: [], code: 'too_big' },
    ]);
  });
});

describe('schema objek (BOARD-203)', () => {
  const props = schema({
    refId: string({ minLength: 1 }),
    size: enumOf(['s', 'm', 'l']),
    note: optional(string()),
    link: nullable(string()),
    points: array(array(number())),
  });
  const valid = { refId: 'r1', size: 'm', link: null, points: [[0, 1, 0.5]] };

  it('schema adalah alias object dan menyimpan bentuknya', () => {
    expect(schema).toBe(object);
    expect(Object.keys(props.shape)).toEqual(['refId', 'size', 'note', 'link', 'points']);
  });

  it('mengembalikan objek yang sama tanpa salinan', () => {
    const result = validate(props, valid);
    expect(result).toEqual({ ok: true, value: valid });
    expect(result.ok && result.value).toBe(valid);
  });

  it('kunci opsional boleh tidak ada atau undefined', () => {
    expect(issuesOf(props, { ...valid, note: undefined })).toEqual([]);
    expect(issuesOf(props, { ...valid, note: 'ok' })).toEqual([]);
  });

  it('menolak bukan-objek', () => {
    for (const bad of [null, [], 'x', 1])
      expect(issuesOf(props, bad)).toEqual([{ path: [], code: 'type' }]);
  });

  it('melaporkan kunci wajib, kunci tidak dikenal, dan path bersarang', () => {
    expect(issuesOf(props, { size: 'xl', link: null, points: [[0, 'y']], extra: true })).toEqual([
      { path: ['refId'], code: 'required' },
      { path: ['size'], code: 'enum' },
      { path: ['points', 0, 1], code: 'type' },
      { path: ['extra'], code: 'unknown_key' },
    ]);
  });

  it('hanya membaca properti milik sendiri, termasuk __proto__ dari JSON', () => {
    const inherited = Object.create({ refId: 'r1' }) as Record<string, unknown>;
    Object.assign(inherited, { size: 'm', link: null, points: [] });
    expect(issuesOf(props, inherited)).toEqual([{ path: ['refId'], code: 'required' }]);

    const polluted = JSON.parse(
      '{"refId":"r1","size":"m","link":null,"points":[],"__proto__":{"x":1}}',
    );
    expect(issuesOf(props, polluted)).toEqual([{ path: ['__proto__'], code: 'unknown_key' }]);
  });

  it('pesan issue tidak memuat nilai input', () => {
    const secret = 'rahasia-isi-papan';
    const result = validate(props, { ...valid, size: secret, [secret]: secret });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Unknown keys appear in the path (that is the key name, not the value); values must not appear in the message.
    for (const issue of result.issues) expect(issue.message).not.toContain(secret);
    expect(result.issues.map((i) => Object.keys(i).sort())).toEqual([
      ['code', 'message', 'path'],
      ['code', 'message', 'path'],
    ]);
  });
});

describe('batas jumlah issue (BOARD-203)', () => {
  it('berhenti setelah MAX_SCHEMA_ISSUES di objek', () => {
    const junk = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    const result = validate(object({}), junk);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(MAX_SCHEMA_ISSUES + 1);
    expect(result.issues.at(-1)).toMatchObject({ path: [], code: 'too_many_issues' });
  });

  it('berhenti setelah MAX_SCHEMA_ISSUES di array dan objek bersarang', () => {
    const result = validate(object({ items: array(number()) }), {
      items: Array.from({ length: 1000 }, () => 'x'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(MAX_SCHEMA_ISSUES + 1);

    const required = validate(
      object(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, string()]))),
      {},
    );
    if (!required.ok) expect(required.issues).toHaveLength(MAX_SCHEMA_ISSUES + 1);
  });
});
