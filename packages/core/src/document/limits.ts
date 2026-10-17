/**
 * Board size limits (BOARD-005, BOARD-210), shared by `createBoard` and `validateDocument` so the
 * client and the server enforce the same numbers.
 */

/**
 * Limits on board size and entity counts (BOARD-005, BOARD-210, BOARD-211).
 *
 * Where each limit is enforced:
 * - `maxDocumentBytes`: when a document comes in (`createBoard({ document })`, `loadDocument`,
 *   `validateDocument`). Not re-measured on every local transaction.
 * - `maxElements`: on incoming documents and on `board.create`.
 * - `maxDrawPoints`: per element with a `props.points` array (freehand strokes), on incoming
 *   documents and on `board.create`/`board.update`.
 *
 * @public
 */
export interface BoardLimits {
  /** Maximum serialized document size in bytes (UTF-8 JSON). Defaults to 10 MB (`10_485_760`). */
  readonly maxDocumentBytes: number;
  /** Maximum number of elements per board. Defaults to `5_000`. */
  readonly maxElements: number;
  /** Maximum number of points per freehand stroke (`props.points`). Defaults to `5_000`. */
  readonly maxDrawPoints: number;
}

/**
 * Default board limits: 10 MB document, 5,000 elements, 5,000 points per stroke.
 *
 * @public
 */
export const DEFAULT_BOARD_LIMITS: Readonly<BoardLimits> = Object.freeze({
  maxDocumentBytes: 10 * 1024 * 1024,
  maxElements: 5_000,
  maxDrawPoints: 5_000,
});

/**
 * Validates a partial limits object and fills omitted values from {@link DEFAULT_BOARD_LIMITS}.
 *
 * @throws `TypeError` when `limits` is not an object, or `RangeError` when a value is not a
 *   positive integer.
 * @internal
 */
export function resolveLimits(limits: unknown): Readonly<BoardLimits> {
  if (limits === undefined) return DEFAULT_BOARD_LIMITS;
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new TypeError('Opsi limits wajib berupa objek.');
  }
  const input = limits as Partial<Record<keyof BoardLimits, unknown>>;
  const checkInt = (key: keyof BoardLimits): number => {
    const val = input[key];
    if (val === undefined) return DEFAULT_BOARD_LIMITS[key];
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
      throw new RangeError(`limits.${key} wajib berupa bilangan bulat positif (>= 1).`);
    }
    return val;
  };
  return Object.freeze({
    maxDocumentBytes: checkInt('maxDocumentBytes'),
    maxElements: checkInt('maxElements'),
    maxDrawPoints: checkInt('maxDrawPoints'),
  });
}

/** Number of UTF-8 bytes needed to encode `text` (lone surrogates count as U+FFFD, 3 bytes). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Serialized size of a document in bytes: the UTF-8 length of its JSON, with `Uint8Array` values
 * counted by their raw byte length. Returns `Infinity` when the value cannot be serialized
 * (for example a cycle), so such input always exceeds the limit.
 *
 * @internal
 */
export function measureDocumentBytes(doc: unknown): number {
  let binary = 0;
  try {
    const json = JSON.stringify(doc, (_key, value: unknown) => {
      if (value instanceof Uint8Array) {
        binary += value.byteLength;
        return 0;
      }
      return value;
    });
    return json === undefined ? 0 : utf8Length(json) + binary;
  } catch {
    return Infinity;
  }
}

/** Number of points in an element's `props.points`, or `0` when it has none. @internal */
export function countPoints(props: unknown): number {
  if (props === null || typeof props !== 'object') return 0;
  const points = (props as { points?: unknown }).points;
  return Array.isArray(points) ? points.length : 0;
}
