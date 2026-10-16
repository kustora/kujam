/**
 * Pembuat ID record (BOARD-202).
 *
 * Memakai `customRandom` dan `urlAlphabet` dari nanoid (dibundel oleh tsup lewat `noExternal`)
 * dengan sumber acak `crypto.getRandomValues` global. Sumber acak bawaan nanoid untuk Node
 * memakai `node:crypto` dan `Buffer`, yang tidak tersedia di Web Worker dan browser, jadi
 * sumber acaknya disuntikkan di sini. `crypto.getRandomValues` global tersedia di Node 20,
 * Web Worker, dan browser.
 */

import { customRandom, urlAlphabet } from 'nanoid';

/**
 * Fungsi pembuat ID record. Bisa diganti lewat `createBoard({ createId })`, misalnya pembuat
 * berurutan untuk tes deterministik.
 *
 * @public
 */
export type IdGenerator = () => string;

/**
 * Panjang ID bawaan (21 karakter alfabet URL, setara peluang tabrakan UUID v4).
 *
 * @public
 */
export const DEFAULT_ID_LENGTH = 21;

interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

function getRandomBytes(size: number): Uint8Array {
  const cryptoApi = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues tidak tersedia di runtime ini; berikan opsi createId.');
  }
  return cryptoApi.getRandomValues(new Uint8Array(size));
}

const generate = customRandom(urlAlphabet, DEFAULT_ID_LENGTH, getRandomBytes);

/**
 * Membuat ID acak yang aman untuk URL (nanoid), dibuat di klien sehingga elemen baru bisa
 * langsung dipakai saat offline tanpa bentrok antar pengguna.
 *
 * @param size - Panjang ID, bilangan bulat positif. Bawaan {@link DEFAULT_ID_LENGTH}.
 * @public
 */
export function createId(size: number = DEFAULT_ID_LENGTH): string {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('Panjang ID wajib berupa bilangan bulat positif.');
  }
  return generate(size);
}
