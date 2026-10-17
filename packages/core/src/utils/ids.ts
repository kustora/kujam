/**
 * Record ID generator (BOARD-202).
 *
 * Uses nanoid's `customRandom` and `urlAlphabet` (bundled by tsup via `noExternal`)
 * with the global `crypto.getRandomValues` as the random source. nanoid's default random source for Node
 * uses `node:crypto` and `Buffer`, which are unavailable in Web Workers and browsers, so
 * the random source is injected here. Global `crypto.getRandomValues` is available in Node 20,
 * Web Workers, and browsers.
 */

import { customRandom, urlAlphabet } from 'nanoid';

/**
 * Record ID generator function. Can be replaced via `createBoard({ createId })`, for example with a
 * sequential generator for deterministic tests.
 *
 * @public
 */
export type IdGenerator = () => string;

/**
 * Default ID length (21 URL-alphabet characters, collision probability comparable to UUID v4).
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
 * Creates a random URL-safe ID (nanoid), generated on the client so new elements can
 * be used immediately while offline without clashing between users.
 *
 * @param size - ID length, a positive integer. Defaults to {@link DEFAULT_ID_LENGTH}.
 * @public
 */
export function createId(size: number = DEFAULT_ID_LENGTH): string {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('Panjang ID wajib berupa bilangan bulat positif.');
  }
  return generate(size);
}
