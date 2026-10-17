import { describe, expect, it } from 'vitest';
import {
  CORE_MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  MigrationError,
  createEmptyDocument,
  deepClone,
  migrateSchema,
  validateDocument,
  type BoardDocument,
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
