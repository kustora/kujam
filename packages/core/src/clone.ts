/**
 * Kloning dan pembekuan dalam untuk data dokumen papan.
 *
 * Tidak memakai JSON round-trip agar `NaN`, `Infinity`, `undefined`, dan
 * `Uint8Array` tidak berubah diam-diam saat dokumen dimuat, disimpan, atau diekspor.
 */

/**
 * Menyalin nilai secara dalam (deep clone). Mendukung objek biasa, array,
 * `Uint8Array`, dan nilai primitif, yaitu semua bentuk data yang boleh ada di dokumen papan.
 *
 * @public
 */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    setOwn(out, key, deepClone((value as Record<string, unknown>)[key]));
  }
  return out as T;
}

/**
 * Menulis properti milik sendiri, termasuk kunci `__proto__` (dari `JSON.parse`) yang kalau
 * ditulis dengan penugasan biasa justru mengganti prototipe objek.
 *
 * @internal
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

/**
 * Kesetaraan struktural untuk data dokumen papan (objek biasa, array, `Uint8Array`, primitif).
 * `NaN` dianggap sama dengan `NaN`; kunci bernilai `undefined` berbeda dengan kunci yang tidak ada.
 *
 * @internal
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array && b instanceof Uint8Array) || a.length !== b.length) {
      return false;
    }
    return a.every((byte, i) => byte === b[i]);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  return keysA.every(
    (key) => Object.prototype.hasOwnProperty.call(objB, key) && deepEqual(objA[key], objB[key]),
  );
}

/**
 * Membekukan objek secara dalam sehingga snapshot tidak bisa diubah dari luar.
 *
 * @internal
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  // Typed array berisi elemen tidak bisa dibekukan; biarkan apa adanya.
  if (ArrayBuffer.isView(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
