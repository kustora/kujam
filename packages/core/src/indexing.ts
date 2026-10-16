/**
 * Fractional indexing untuk urutan lapisan dan urutan page (BOARD-202).
 *
 * Membungkus `fractional-indexing` (dibundel oleh tsup lewat `noExternal`). Index adalah string
 * base62 yang diurutkan dengan perbandingan string biasa (bukan `localeCompare`), sehingga
 * memindahkan satu elemen hanya mengubah index elemen itu.
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
 * Membandingkan dua index urutan untuk `Array.prototype.sort`. Memakai perbandingan kode
 * karakter, bukan `localeCompare`, karena urutan index bergantung pada kode karakter.
 *
 * @public
 */
export function compareIndex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Membuat index yang terurut di antara `a` dan `b`. `null` berarti batas awal atau akhir;
 * `indexBetween(null, null)` menghasilkan `'a0'`. Urutan argumen boleh terbalik.
 *
 * @throws `RangeError` bila `a` sama dengan `b` atau salah satunya bukan index yang valid.
 * @public
 */
export function indexBetween(a: string | null, b: string | null): string {
  checkPair(a, b);
  return wrap(() => generateKeyBetween(a, b));
}

/**
 * Membuat index tepat di atas `index` (setelahnya dalam urutan). `null` berarti daftar kosong.
 *
 * @throws `RangeError` bila `index` bukan index yang valid.
 * @public
 */
export function indexAbove(index: string | null): string {
  return wrap(() => generateKeyBetween(index, null));
}

/**
 * Membuat index tepat di bawah `index` (sebelumnya dalam urutan). `null` berarti daftar kosong.
 *
 * @throws `RangeError` bila `index` bukan index yang valid.
 * @public
 */
export function indexBelow(index: string | null): string {
  return wrap(() => generateKeyBetween(null, index));
}

/**
 * Membuat `n` index terurut naik di antara `a` dan `b`, misalnya untuk menyisipkan beberapa
 * elemen sekaligus (tempel, duplikat).
 *
 * @throws `RangeError` bila `n` bukan bilangan bulat tidak negatif, `a` sama dengan `b`, atau
 * salah satunya bukan index yang valid.
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
