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
    out[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return out as T;
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
