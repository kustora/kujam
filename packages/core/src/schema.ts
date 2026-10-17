/**
 * Mini schema library for props validation with type inference (BOARD-203, decision ADR-007).
 *
 * A validator, not a parser: values are never changed; there are no transforms, coercion, or defaults.
 * Validation never throws, objects are strict, and issues never carry the input value.
 */

import { DEFAULT_URL_SCHEMES, MAX_URL_LENGTH, sanitizeUrl } from './url.js';

/**
 * Path segment leading to the invalid value: an object key or an array index.
 *
 * @public
 */
export type SchemaPathSegment = string | number;

/**
 * Validation issue code. Codes are a public contract; `message` is for developers only.
 *
 * @public
 */
export type SchemaIssueCode =
  | 'type'
  | 'enum'
  | 'literal'
  | 'required'
  | 'unknown_key'
  | 'too_small'
  | 'too_big'
  | 'not_integer'
  | 'unsafe_url'
  | 'too_many_issues';

/**
 * A single validation issue. Does not include the input value, so board content never leaks into logs.
 *
 * @public
 */
export interface SchemaIssue {
  readonly path: readonly SchemaPathSegment[];
  readonly code: SchemaIssueCode;
  /** English message for developers. UIs that need localized text map `code`. */
  readonly message: string;
}

/**
 * Result of {@link validate}. On success, `value` is the same object as the input (not a copy).
 *
 * @public
 */
export type SchemaResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

/**
 * Maximum number of issues per validation, so malicious input cannot cause unbounded work.
 *
 * @public
 */
export const MAX_SCHEMA_ISSUES = 20;

/** @internal */
interface CheckContext {
  issues: SchemaIssue[];
}

/**
 * Schema for a value of type `T`. Created with primitives such as {@link string} or {@link object}.
 *
 * @public
 */
export interface Schema<T> {
  readonly kind: string;
  /** @internal Type carrier only, for {@link Infer}; always `undefined` at runtime. */
  readonly _type?: T;
  /** @internal Marks an optional key in {@link object}. */
  readonly _optional?: boolean;
  /** @internal Checks a value; returns `false` when validation must stop. */
  _check(value: unknown, path: SchemaPathSegment[], ctx: CheckContext): boolean;
}

/**
 * Schema produced by {@link optional}: its key may be absent from the object.
 *
 * @public
 */
export interface OptionalSchema<T> extends Schema<T | undefined> {
  /** @internal */
  readonly _optional: true;
}

/**
 * TypeScript type produced by a schema.
 *
 * @example
 * ```ts
 * const props = schema({ refId: string(), size: enumOf(['s', 'm', 'l']) });
 * type Props = Infer<typeof props>; // { refId: string; size: 's' | 'm' | 'l' }
 * ```
 *
 * @public
 */
export type Infer<S> =
  S extends Schema<infer T> ? (S extends { readonly _optional: true } ? T | undefined : T) : never;

function report(
  ctx: CheckContext,
  path: SchemaPathSegment[],
  code: SchemaIssueCode,
  message: string,
): boolean {
  if (ctx.issues.length >= MAX_SCHEMA_ISSUES) {
    ctx.issues.push({
      path: [],
      code: 'too_many_issues',
      message: `more than ${MAX_SCHEMA_ISSUES} issues`,
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

// ---------- Primitives ----------

/**
 * Options for {@link string}.
 *
 * @public
 */
export interface StringOptions {
  minLength?: number;
  maxLength?: number;
}

/**
 * A string, with optional length limits (in UTF-16 code units).
 *
 * @public
 */
export function string(options: StringOptions = {}): Schema<string> {
  const { minLength, maxLength } = options;
  return make('string', (v, path, ctx) => {
    if (typeof v !== 'string')
      return report(ctx, path, 'type', `expected string, got ${describe(v)}`);
    if (minLength !== undefined && v.length < minLength)
      return report(ctx, path, 'too_small', `expected at least ${minLength} characters`);
    if (maxLength !== undefined && v.length > maxLength)
      return report(ctx, path, 'too_big', `expected at most ${maxLength} characters`);
    return true;
  });
}

/**
 * Options for {@link url}.
 *
 * @public
 */
export interface UrlOptions {
  /** Allowed schemes; defaults to `https:` and `http:` (see {@link isSafeUrl}). */
  schemes?: readonly string[];
  /** Maximum length; defaults to {@link MAX_URL_LENGTH}. */
  maxLength?: number;
}

/**
 * A safe absolute URL (BOARD-2002, ADR-007): a string accepted by {@link isSafeUrl} with the given
 * schemes, already in normalized form (no surrounding control characters, tabs, or newlines), so the
 * stored value is exactly what will be rendered. Rejects with code `unsafe_url`.
 *
 * @example
 * ```ts
 * const props = schema({ href: url({ schemes: ['https:', 'mailto:'] }) });
 * ```
 *
 * @public
 */
export function url(options: UrlOptions = {}): Schema<string> {
  const schemes = options.schemes ?? DEFAULT_URL_SCHEMES;
  const maxLength = options.maxLength ?? MAX_URL_LENGTH;
  return make('url', (v, path, ctx) => {
    if (typeof v !== 'string')
      return report(ctx, path, 'type', `expected string, got ${describe(v)}`);
    if (v.length > maxLength)
      return report(ctx, path, 'too_big', `expected at most ${maxLength} characters`);
    if (sanitizeUrl(v, schemes, { maxLength }) !== v)
      return report(ctx, path, 'unsafe_url', `expected a safe ${schemes.join(' / ')} URL`);
    return true;
  });
}

/**
 * Options for {@link number}.
 *
 * @public
 */
export interface NumberOptions {
  min?: number;
  max?: number;
  int?: boolean;
}

/**
 * A finite number. `NaN` and `Infinity` are always rejected because they are not JSON-safe.
 *
 * @public
 */
export function number(options: NumberOptions = {}): Schema<number> {
  const { min, max, int } = options;
  return make('number', (v, path, ctx) => {
    if (typeof v !== 'number' || !Number.isFinite(v))
      return report(ctx, path, 'type', `expected finite number, got ${describe(v)}`);
    if (int && !Number.isInteger(v)) return report(ctx, path, 'not_integer', 'expected integer');
    if (min !== undefined && v < min) return report(ctx, path, 'too_small', `expected >= ${min}`);
    if (max !== undefined && v > max) return report(ctx, path, 'too_big', `expected <= ${max}`);
    return true;
  });
}

/**
 * Boolean.
 *
 * @public
 */
export function boolean(): Schema<boolean> {
  return make('boolean', (v, path, ctx) =>
    typeof v === 'boolean'
      ? true
      : report(ctx, path, 'type', `expected boolean, got ${describe(v)}`),
  );
}

/**
 * Exactly one primitive value.
 *
 * @public
 */
export function literal<const T extends string | number | boolean | null>(expected: T): Schema<T> {
  return make('literal', (v, path, ctx) =>
    v === expected ? true : report(ctx, path, 'literal', `expected ${JSON.stringify(expected)}`),
  );
}

/**
 * One of a list of strings.
 *
 * @public
 */
export function enumOf<const T extends readonly [string, ...string[]]>(
  values: T,
): Schema<T[number]> {
  const allowed = new Set<unknown>(values);
  const expected = `expected one of ${values.join(', ')}`;
  return make('enum', (v, path, ctx) =>
    allowed.has(v) ? true : report(ctx, path, 'enum', expected),
  );
}

// ---------- Composition ----------

/**
 * An object key that may be absent. A value of `undefined` is treated the same as an absent key.
 *
 * @public
 */
export function optional<T>(inner: Schema<T>): OptionalSchema<T> {
  return {
    kind: 'optional',
    _optional: true,
    _check: (v, path, ctx) => v === undefined || inner._check(v, path, ctx),
  };
}

/**
 * A value that may be `null`.
 *
 * @public
 */
export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return make('nullable', (v, path, ctx) => v === null || inner._check(v, path, ctx));
}

/**
 * Options for {@link array}.
 *
 * @public
 */
export interface ArrayOptions {
  maxLength?: number;
}

/**
 * An array of items of the same type, with optional length limits.
 *
 * @public
 */
export function array<T>(item: Schema<T>, options: ArrayOptions = {}): Schema<T[]> {
  const { maxLength } = options;
  return make('array', (v, path, ctx) => {
    if (!Array.isArray(v)) return report(ctx, path, 'type', `expected array, got ${describe(v)}`);
    if (maxLength !== undefined && v.length > maxLength)
      return report(ctx, path, 'too_big', `expected at most ${maxLength} items`);
    for (let i = 0; i < v.length; i++) {
      path.push(i);
      const proceed = item._check(v[i], path, ctx);
      path.pop();
      if (!proceed) return false;
    }
    return true;
  });
}

/**
 * Object shape: a map from key name to its schema.
 *
 * @public
 */
export type SchemaShape = Record<string, Schema<unknown>>;

type OptionalKeys<S extends SchemaShape> = {
  [K in keyof S]: S[K] extends { readonly _optional: true } ? K : never;
}[keyof S];

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Object type produced by a {@link SchemaShape}. Keys from {@link optional} become `?:`.
 *
 * @public
 */
export type InferShape<S extends SchemaShape> = Simplify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>;
  }
>;

/**
 * Object schema that keeps its shape.
 *
 * @public
 */
export interface ObjectSchema<S extends SchemaShape> extends Schema<InferShape<S>> {
  readonly shape: Readonly<S>;
}

/**
 * Strict object: every key is required except those wrapped in {@link optional}, and unknown
 * keys are rejected with code `unknown_key`.
 *
 * @public
 */
export function object<S extends SchemaShape>(shape: S): ObjectSchema<S> {
  const keys = Object.keys(shape);
  return {
    kind: 'object',
    shape,
    _check(v, path, ctx) {
      if (typeof v !== 'object' || v === null || Array.isArray(v))
        return report(ctx, path, 'type', `expected object, got ${describe(v)}`);
      const rec = v as Record<string, unknown>;
      for (const key of keys) {
        const field = shape[key]!;
        path.push(key);
        const present = Object.prototype.hasOwnProperty.call(rec, key);
        const proceed =
          !present && !field._optional
            ? report(ctx, path, 'required', 'required')
            : field._check(rec[key], path, ctx);
        path.pop();
        if (!proceed) return false;
      }
      for (const key of Object.keys(rec)) {
        if (!Object.prototype.hasOwnProperty.call(shape, key)) {
          path.push(key);
          const proceed = report(ctx, path, 'unknown_key', 'unknown key');
          path.pop();
          if (!proceed) return false;
        }
      }
      return true;
    },
  };
}

/**
 * Name from the PRD for the top-level `props` schema in `defineElement`. Same as {@link object}.
 *
 * @example
 * ```ts
 * const props = schema({ refId: string({ minLength: 1 }), size: enumOf(['s', 'm', 'l']) });
 * ```
 *
 * @public
 */
export const schema = object;

// ---------- Validation ----------

/**
 * Validates a value against a schema without throwing and without changing the value.
 *
 * @example
 * ```ts
 * const result = validate(props, input);
 * if (result.ok) use(result.value);
 * else console.warn(result.issues); // [{ path: ['size'], code: 'enum', message: '...' }]
 * ```
 *
 * @public
 */
export function validate<T>(s: Schema<T>, value: unknown): SchemaResult<T> {
  const ctx: CheckContext = { issues: [] };
  s._check(value, [], ctx);
  return ctx.issues.length === 0
    ? { ok: true, value: value as T }
    : { ok: false, issues: ctx.issues };
}
