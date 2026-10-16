/**
 * Mini-lib skema validasi props dengan inferensi tipe (BOARD-203, keputusan ADR-007).
 *
 * Validator, bukan parser: nilai tidak pernah diubah, tidak ada transform, coercion, atau default.
 * Validasi tidak melempar exception, objek bersifat ketat, dan issue tidak membawa nilai input.
 */

/**
 * Segmen path menuju nilai yang tidak valid: kunci objek atau indeks array.
 *
 * @public
 */
export type SchemaPathSegment = string | number;

/**
 * Kode issue validasi. Kode adalah kontrak publik; `message` hanya untuk developer.
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
  | 'too_many_issues';

/**
 * Satu masalah validasi. Tidak memuat nilai input agar isi papan tidak bocor ke log.
 *
 * @public
 */
export interface SchemaIssue {
  readonly path: readonly SchemaPathSegment[];
  readonly code: SchemaIssueCode;
  /** Pesan berbahasa Inggris untuk developer. UI yang butuh teks lokal memetakan `code`. */
  readonly message: string;
}

/**
 * Hasil {@link validate}. Bila sukses, `value` adalah objek yang sama dengan input (tanpa salinan).
 *
 * @public
 */
export type SchemaResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

/**
 * Batas jumlah issue per validasi, agar input jahat tidak membuat kerja tak terbatas.
 *
 * @public
 */
export const MAX_SCHEMA_ISSUES = 20;

/** @internal */
interface CheckContext {
  issues: SchemaIssue[];
}

/**
 * Skema untuk nilai bertipe `T`. Dibuat lewat primitif seperti {@link string} atau {@link object}.
 *
 * @public
 */
export interface Schema<T> {
  readonly kind: string;
  /** @internal Hanya pembawa tipe untuk {@link Infer}; selalu `undefined` saat runtime. */
  readonly _type?: T;
  /** @internal Penanda kunci opsional di {@link object}. */
  readonly _optional?: boolean;
  /** @internal Memeriksa nilai; mengembalikan `false` bila validasi harus berhenti. */
  _check(value: unknown, path: SchemaPathSegment[], ctx: CheckContext): boolean;
}

/**
 * Skema hasil {@link optional}: kuncinya boleh tidak ada di objek.
 *
 * @public
 */
export interface OptionalSchema<T> extends Schema<T | undefined> {
  /** @internal */
  readonly _optional: true;
}

/**
 * Tipe TypeScript yang dihasilkan sebuah skema.
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

// ---------- Primitif ----------

/**
 * Opsi {@link string}.
 *
 * @public
 */
export interface StringOptions {
  minLength?: number;
  maxLength?: number;
}

/**
 * String, dengan batas panjang opsional (dalam unit UTF-16).
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
 * Opsi {@link number}.
 *
 * @public
 */
export interface NumberOptions {
  min?: number;
  max?: number;
  int?: boolean;
}

/**
 * Bilangan berhingga. `NaN` dan `Infinity` selalu ditolak karena tidak aman untuk JSON.
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
 * Tepat satu nilai primitif.
 *
 * @public
 */
export function literal<const T extends string | number | boolean | null>(expected: T): Schema<T> {
  return make('literal', (v, path, ctx) =>
    v === expected ? true : report(ctx, path, 'literal', `expected ${JSON.stringify(expected)}`),
  );
}

/**
 * Salah satu dari daftar string.
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

// ---------- Komposisi ----------

/**
 * Kunci objek yang boleh tidak ada. Nilai `undefined` diperlakukan sama dengan kunci yang tidak ada.
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
 * Nilai yang boleh `null`.
 *
 * @public
 */
export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return make('nullable', (v, path, ctx) => v === null || inner._check(v, path, ctx));
}

/**
 * Opsi {@link array}.
 *
 * @public
 */
export interface ArrayOptions {
  maxLength?: number;
}

/**
 * Array dengan item bertipe sama, dengan batas panjang opsional.
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
 * Bentuk objek: peta nama kunci ke skemanya.
 *
 * @public
 */
export type SchemaShape = Record<string, Schema<unknown>>;

type OptionalKeys<S extends SchemaShape> = {
  [K in keyof S]: S[K] extends { readonly _optional: true } ? K : never;
}[keyof S];

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Tipe objek yang dihasilkan sebuah {@link SchemaShape}. Kunci dari {@link optional} menjadi `?:`.
 *
 * @public
 */
export type InferShape<S extends SchemaShape> = Simplify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>;
  }
>;

/**
 * Skema objek yang menyimpan bentuknya.
 *
 * @public
 */
export interface ObjectSchema<S extends SchemaShape> extends Schema<InferShape<S>> {
  readonly shape: Readonly<S>;
}

/**
 * Objek ketat: semua kunci wajib kecuali yang dibungkus {@link optional}, dan kunci yang tidak
 * dikenal ditolak dengan kode `unknown_key`.
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
 * Nama dari PRD untuk skema `props` tingkat atas di `defineElement`. Sama dengan {@link object}.
 *
 * @example
 * ```ts
 * const props = schema({ refId: string({ minLength: 1 }), size: enumOf(['s', 'm', 'l']) });
 * ```
 *
 * @public
 */
export const schema = object;

// ---------- Validasi ----------

/**
 * Memvalidasi nilai terhadap skema tanpa melempar exception dan tanpa mengubah nilai.
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
