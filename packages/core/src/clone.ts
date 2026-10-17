/**
 * Deep cloning and freezing for board document data.
 *
 * Does not use a JSON round-trip, so `NaN`, `Infinity`, `undefined`, and
 * `Uint8Array` are not silently changed when a document is loaded, saved, or exported.
 */

/**
 * Deep-copies a value. Supports plain objects, arrays,
 * `Uint8Array`, and primitives, i.e. every data shape allowed in a board document.
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
 * Writes an own property, including the `__proto__` key (from `JSON.parse`), which when
 * written with plain assignment would replace the object's prototype instead.
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
 * Structural equality for board document data (plain objects, arrays, `Uint8Array`, primitives).
 * `NaN` equals `NaN`; a key with value `undefined` differs from a missing key.
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
 * Deep-freezes an object so the snapshot cannot be modified from outside.
 *
 * @internal
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  // Typed arrays with elements cannot be frozen; leave them as-is.
  if (ArrayBuffer.isView(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
