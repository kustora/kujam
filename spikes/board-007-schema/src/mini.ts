/**
 * BOARD-007 — prototipe mini-lib skema props (kandidat untuk BOARD-203).
 *
 * Prinsip:
 * - Validator, bukan parser: nilai tidak diubah, tidak ada transform atau default
 *   (default milik `defineElement({ defaults })`). Hasil sukses mengembalikan nilai yang sama.
 * - Tidak melempar exception. Error berisi `path`, `code`, dan `message`.
 * - Objek ketat: kunci yang tidak dikenal ditolak.
 * - Hanya nilai yang bisa diserialisasi ke JSON: number wajib finite.
 */

export type PathSegment = string | number;

export type IssueCode =
  | 'type'
  | 'enum'
  | 'literal'
  | 'required'
  | 'unknown_key'
  | 'too_small'
  | 'too_big'
  | 'not_integer'
  | 'too_many_issues';

export interface Issue {
  path: PathSegment[];
  code: IssueCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/** Batas jumlah issue per validasi, agar input jahat tidak membuat kerja tak terbatas. */
const MAX_ISSUES = 20;

interface Ctx {
  issues: Issue[];
}

export interface Schema<T> {
  readonly kind: string;
  /** @internal hanya untuk inferensi tipe */
  readonly _t?: T;
  /** @internal */
  readonly _opt?: boolean;
  /** @internal mengembalikan false bila validasi harus berhenti */
  _check(value: unknown, path: PathSegment[], ctx: Ctx): boolean;
}

/** Penanda kunci opsional di objek. */
export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly _opt: true;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

function report(ctx: Ctx, path: PathSegment[], code: IssueCode, message: string): boolean {
  if (ctx.issues.length >= MAX_ISSUES) {
    ctx.issues.push({
      path: [],
      code: 'too_many_issues',
      message: `more than ${MAX_ISSUES} issues`,
    });
    return false;
  }
  ctx.issues.push({ path: [...path], code, message });
  return true;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return typeof value;
}

function make<T>(kind: string, check: Schema<T>['_check']): Schema<T> {
  return { kind, _check: check };
}

// ---------- Primitif ----------

export function string(opts: { minLength?: number; maxLength?: number } = {}): Schema<string> {
  return make('string', (v, path, ctx) => {
    if (typeof v !== 'string')
      return report(ctx, path, 'type', `expected string, got ${describe(v)}`);
    if (opts.minLength !== undefined && v.length < opts.minLength)
      return report(ctx, path, 'too_small', `expected at least ${opts.minLength} characters`);
    if (opts.maxLength !== undefined && v.length > opts.maxLength)
      return report(ctx, path, 'too_big', `expected at most ${opts.maxLength} characters`);
    return true;
  });
}

export function number(opts: { min?: number; max?: number; int?: boolean } = {}): Schema<number> {
  return make('number', (v, path, ctx) => {
    if (typeof v !== 'number' || !Number.isFinite(v))
      return report(ctx, path, 'type', `expected finite number, got ${describe(v)}`);
    if (opts.int && !Number.isInteger(v))
      return report(ctx, path, 'not_integer', 'expected integer');
    if (opts.min !== undefined && v < opts.min)
      return report(ctx, path, 'too_small', `expected >= ${opts.min}`);
    if (opts.max !== undefined && v > opts.max)
      return report(ctx, path, 'too_big', `expected <= ${opts.max}`);
    return true;
  });
}

export function boolean(): Schema<boolean> {
  return make('boolean', (v, path, ctx) =>
    typeof v === 'boolean'
      ? true
      : report(ctx, path, 'type', `expected boolean, got ${describe(v)}`),
  );
}

export function literal<const T extends string | number | boolean | null>(expected: T): Schema<T> {
  return make('literal', (v, path, ctx) =>
    v === expected ? true : report(ctx, path, 'literal', `expected ${JSON.stringify(expected)}`),
  );
}

export function enumOf<const T extends readonly [string, ...string[]]>(
  values: T,
): Schema<T[number]> {
  const set = new Set<unknown>(values);
  return make('enum', (v, path, ctx) =>
    set.has(v) ? true : report(ctx, path, 'enum', `expected one of ${values.join(', ')}`),
  );
}

// ---------- Komposisi ----------

export function optional<T>(inner: Schema<T>): OptionalSchema<T> {
  return {
    kind: 'optional',
    _opt: true,
    _check: (v, path, ctx) => v === undefined || inner._check(v, path, ctx),
  };
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return make('nullable', (v, path, ctx) => v === null || inner._check(v, path, ctx));
}

export function array<T>(item: Schema<T>, opts: { maxLength?: number } = {}): Schema<T[]> {
  return make('array', (v, path, ctx) => {
    if (!Array.isArray(v)) return report(ctx, path, 'type', `expected array, got ${describe(v)}`);
    if (opts.maxLength !== undefined && v.length > opts.maxLength)
      return report(ctx, path, 'too_big', `expected at most ${opts.maxLength} items`);
    for (let i = 0; i < v.length; i++) {
      path.push(i);
      const go = item._check(v[i], path, ctx);
      path.pop();
      if (!go) return false;
    }
    return true;
  });
}

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends { readonly _opt: true } ? K : never;
}[keyof S];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type InferShape<S extends Shape> = Simplify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>;
  }
>;

export function object<S extends Shape>(shape: S): Schema<InferShape<S>> & { readonly shape: S } {
  const keys = Object.keys(shape);
  return {
    kind: 'object',
    shape,
    _check(v, path, ctx) {
      if (typeof v !== 'object' || v === null || Array.isArray(v))
        return report(ctx, path, 'type', `expected object, got ${describe(v)}`);
      const rec = v as Record<string, unknown>;
      for (const key of keys) {
        const s = shape[key]!;
        path.push(key);
        const go =
          !(key in rec) && !s._opt
            ? report(ctx, path, 'required', 'required')
            : s._check(rec[key], path, ctx);
        path.pop();
        if (!go) return false;
      }
      for (const key in rec) {
        if (!Object.prototype.hasOwnProperty.call(shape, key)) {
          path.push(key);
          const go = report(ctx, path, 'unknown_key', 'unknown key');
          path.pop();
          if (!go) return false;
        }
      }
      return true;
    },
  };
}

/** Nama dari PRD untuk skema props tingkat atas. Sama dengan `object`. */
export const schema = object;

// ---------- Validasi ----------

export function validate<T>(s: Schema<T>, value: unknown): Result<T> {
  const ctx: Ctx = { issues: [] };
  s._check(value, [], ctx);
  return ctx.issues.length === 0
    ? { ok: true, value: value as T }
    : { ok: false, issues: ctx.issues };
}
