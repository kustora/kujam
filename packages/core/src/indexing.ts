/**
 * Fractional indexing for layer order and page order (BOARD-202).
 *
 * Wraps `fractional-indexing` (bundled by tsup via `noExternal`). Indexes are base62
 * strings sorted with plain string comparison (not `localeCompare`), so
 * moving one element only changes that element's index.
 */

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RangeError(`Index urutan tidak valid (${reason.trim()}).`, { cause: error });
  }
}

function checkPair(a: string | null, b: string | null): void {
  if (a !== null && b !== null && a === b) {
    throw new RangeError(`Index urutan tidak valid: a dan b sama ("${a}").`);
  }
}

/**
 * Compares two order indexes for `Array.prototype.sort`. Uses character code
 * comparison, not `localeCompare`, because index order depends on character codes.
 *
 * @public
 */
export function compareIndex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Creates an index ordered between `a` and `b`. `null` means the start or end bound;
 * `indexBetween(null, null)` returns `'a0'`. Arguments may be in either order.
 *
 * @throws `RangeError` when `a` equals `b` or either one is not a valid index.
 * @public
 */
export function indexBetween(a: string | null, b: string | null): string {
  checkPair(a, b);
  return wrap(() => generateKeyBetween(a, b));
}

/**
 * Creates an index directly above `index` (after it in order). `null` means an empty list.
 *
 * @throws `RangeError` when `index` is not a valid index.
 * @public
 */
export function indexAbove(index: string | null): string {
  return wrap(() => generateKeyBetween(index, null));
}

/**
 * Creates an index directly below `index` (before it in order). `null` means an empty list.
 *
 * @throws `RangeError` when `index` is not a valid index.
 * @public
 */
export function indexBelow(index: string | null): string {
  return wrap(() => generateKeyBetween(null, index));
}

/**
 * Creates `n` ascending indexes between `a` and `b`, for example to insert several
 * elements at once (paste, duplicate).
 *
 * @throws `RangeError` when `n` is not a non-negative integer, `a` equals `b`, or
 * either one is not a valid index.
 * @public
 */
export function indicesBetween(a: string | null, b: string | null, n: number): string[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError('Jumlah index wajib berupa bilangan bulat tidak negatif.');
  }
  checkPair(a, b);
  if (a !== null && b !== null && a > b) {
    return wrap(() => generateNKeysBetween(b, a, n));
  }
  return wrap(() => generateNKeysBetween(a, b, n));
}
