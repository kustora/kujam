/**
 * Freehand brushes (`defineBrush`) and the per-board brush registry (BOARD-603).
 *
 * A brush is data only: perfect-freehand stroke options plus a Canvas blend mode. Strokes store
 * the brush ID in their props; the renderer and the pen tool (BOARD-1002) look it up with
 * {@link BrushRegistry.resolve}, which falls back to the default pen for unknown IDs so strokes
 * from a plugin that is not installed still render.
 */

/**
 * Stroke shaping options, mapped one to one onto perfect-freehand (BOARD-1002).
 *
 * @beta
 */
export interface BrushStrokeOptions {
  /** Default stroke diameter in board units for new strokes; greater than 0. */
  readonly size?: number;
  /** How much pressure thins the stroke, from -1 to 1 (0 = constant width). */
  readonly thinning?: number;
  /** How much the stroke edges are softened, from 0 to 1. */
  readonly smoothing?: number;
  /** How much the input points are streamlined, from 0 to 1. */
  readonly streamline?: number;
  /**
   * Taper length in board units at both ends (a number), or per end. `0` means no taper.
   */
  readonly taper?: number | { readonly start?: number; readonly end?: number };
  /** Simulate pressure from drawing speed when the input has no real pressure. */
  readonly simulatePressure?: boolean;
}

/**
 * Canvas blend modes a brush may use (a subset of `globalCompositeOperation`). Compositing
 * operations that erase or clip, such as `destination-out`, are deliberately not brushes.
 *
 * @beta
 */
export const BRUSH_BLEND_MODES = Object.freeze([
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const);

/**
 * Blend mode of a brush. `'source-over'` is normal painting; `'multiply'` suits a highlighter.
 *
 * @beta
 */
export type BrushBlendMode = (typeof BRUSH_BLEND_MODES)[number];

/**
 * Input for {@link defineBrush} and plugin `brushes`.
 *
 * @beta
 */
export interface BrushInput {
  /** Unique brush ID, for example `'pen'` or `'highlighter'`: lowercase letters, digits, dots, or hyphens. */
  readonly id: string;
  /** i18n key or display label. Defaults to the ID. */
  readonly label?: string;
  /** perfect-freehand options. Defaults to `{}` (the stroke renderer's defaults). */
  readonly strokeOptions?: BrushStrokeOptions;
  /** Blend mode. Defaults to `'source-over'`. */
  readonly blend?: BrushBlendMode;
}

/**
 * A validated brush with every field filled in. Created with {@link defineBrush}; deeply frozen.
 *
 * @beta
 */
export interface BrushDefinition {
  readonly id: string;
  readonly label: string;
  readonly strokeOptions: Readonly<BrushStrokeOptions>;
  readonly blend: BrushBlendMode;
}

/**
 * ID of the default pen: unknown brush IDs fall back to the brush registered under this ID.
 *
 * @beta
 */
export const DEFAULT_BRUSH_ID = 'pen';

/**
 * Last-resort brush when no `pen` is registered either, so {@link BrushRegistry.resolve} always
 * returns a brush.
 */
const FALLBACK_BRUSH: BrushDefinition = Object.freeze({
  id: DEFAULT_BRUSH_ID,
  label: DEFAULT_BRUSH_ID,
  strokeOptions: Object.freeze({}),
  blend: 'source-over',
});

/**
 * Codes for {@link BrushError}.
 *
 * - `invalid-brush`: the brush definition is invalid.
 * - `duplicate-brush`: the brush ID is already registered on this board.
 *
 * @beta
 */
export type BrushErrorCode = 'invalid-brush' | 'duplicate-brush';

/**
 * Brush definition or registry error.
 *
 * @beta
 */
export class BrushError extends Error {
  readonly code: BrushErrorCode;
  /** The offending brush ID, or `undefined` when `id` itself is invalid. */
  readonly brushId: string | undefined;
  /** Definition problems; empty for `duplicate-brush`. */
  readonly errors: readonly string[];

  constructor(
    code: BrushErrorCode,
    message: string,
    brushId: string | undefined,
    errors: readonly string[] = [],
  ) {
    super(message);
    this.name = 'BrushError';
    this.code = code;
    this.brushId = brushId;
    this.errors = errors;
  }
}

const BRUSH_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Results of {@link defineBrush}, so registering one keeps the same (frozen) object. */
const defined = new WeakSet<object>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Numeric stroke options with their allowed range, inclusive unless `exclusiveMin`. */
const NUMERIC_OPTIONS: readonly (readonly [keyof BrushStrokeOptions, number, number, boolean?])[] =
  [
    ['size', 0, Infinity, true],
    ['thinning', -1, 1],
    ['smoothing', 0, 1],
    ['streamline', 0, 1],
  ];

function checkStrokeOptions(options: Record<string, unknown>, errors: string[]): void {
  for (const [key, min, max, exclusiveMin] of NUMERIC_OPTIONS) {
    const value = options[key];
    if (value === undefined) continue;
    const ok = isFiniteNumber(value) && (exclusiveMin ? value > min : value >= min) && value <= max;
    if (!ok) {
      const range = max === Infinity ? 'lebih dari 0' : `antara ${min} dan ${max}`;
      errors.push(`strokeOptions.${key} wajib berupa angka ${range}.`);
    }
  }
  const { taper } = options;
  if (taper !== undefined) {
    const isLength = (v: unknown): boolean => v === undefined || (isFiniteNumber(v) && v >= 0);
    const ok = isPlainObject(taper)
      ? isLength(taper.start) && isLength(taper.end)
      : isFiniteNumber(taper) && taper >= 0;
    if (!ok) {
      errors.push('strokeOptions.taper wajib berupa angka >= 0 atau objek { start?, end? }.');
    }
  }
  if (options.simulatePressure !== undefined && typeof options.simulatePressure !== 'boolean') {
    errors.push('strokeOptions.simulatePressure wajib berupa boolean.');
  }
}

/**
 * Problems in a brush definition, without the `brushes[i].` prefix. Empty means valid.
 *
 * @internal
 */
export function collectBrushErrors(definition: unknown): string[] {
  if (!isPlainObject(definition)) return ['wajib berupa objek.'];
  const errors: string[] = [];
  if (typeof definition.id !== 'string' || !BRUSH_ID.test(definition.id)) {
    errors.push('id wajib huruf kecil, angka, titik, atau tanda hubung (misalnya "pen").');
  }
  if (
    definition.label !== undefined &&
    (typeof definition.label !== 'string' || definition.label.length === 0)
  ) {
    errors.push('label wajib berupa string tidak kosong.');
  }
  if (definition.strokeOptions !== undefined) {
    if (isPlainObject(definition.strokeOptions)) {
      checkStrokeOptions(definition.strokeOptions, errors);
    } else {
      errors.push('strokeOptions wajib berupa objek.');
    }
  }
  if (
    definition.blend !== undefined &&
    !(BRUSH_BLEND_MODES as readonly unknown[]).includes(definition.blend)
  ) {
    errors.push(`blend wajib salah satu dari: ${BRUSH_BLEND_MODES.join(', ')}.`);
  }
  return errors;
}

/** Copies only the known stroke options, so unknown keys never reach the stroke renderer. */
function normalizeStrokeOptions(options: BrushStrokeOptions | undefined): BrushStrokeOptions {
  const out: Record<string, unknown> = {};
  if (options === undefined) return Object.freeze(out);
  for (const [key] of NUMERIC_OPTIONS) {
    if (options[key] !== undefined) out[key] = options[key];
  }
  if (options.taper !== undefined) {
    out.taper =
      typeof options.taper === 'number'
        ? options.taper
        : Object.freeze({ start: options.taper.start, end: options.taper.end });
  }
  if (options.simulatePressure !== undefined) out.simulatePressure = options.simulatePressure;
  return Object.freeze(out);
}

/**
 * Defines a freehand brush: perfect-freehand stroke options and a blend mode (BOARD-603).
 *
 * The definition is validated immediately (see {@link BrushError}); missing fields get their
 * defaults and the result is deeply frozen. Register brushes through a plugin's `brushes`.
 *
 * @example
 * ```ts
 * const marker = defineBrush({
 *   id: 'example.marker',
 *   label: 'brush.marker',
 *   strokeOptions: { size: 8, thinning: 0, smoothing: 0.5, streamline: 0.5, taper: 0 },
 *   blend: 'multiply',
 * });
 * const plugin = definePlugin({ id: 'example.brushes', brushes: [marker] });
 * ```
 *
 * @throws {@link BrushError} with code `invalid-brush`.
 * @beta
 */
export function defineBrush(definition: BrushInput): BrushDefinition {
  const errors = collectBrushErrors(definition);
  if (errors.length > 0) {
    const id = isPlainObject(definition) ? definition.id : undefined;
    const brushId = typeof id === 'string' && id ? id : undefined;
    throw new BrushError(
      'invalid-brush',
      `Definisi kuas${brushId ? ` "${brushId}"` : ''} tidak valid: ${errors.join(' ')}`,
      brushId,
      errors,
    );
  }
  const brush: BrushDefinition = Object.freeze({
    id: definition.id,
    label: definition.label ?? definition.id,
    strokeOptions: normalizeStrokeOptions(definition.strokeOptions),
    blend: definition.blend ?? 'source-over',
  });
  defined.add(brush);
  return brush;
}

/**
 * Brush registry owned by one board (`board.brushes`).
 *
 * @beta
 */
export interface BrushRegistry {
  /**
   * Registers a brush (a {@link defineBrush} result or a plain input, validated the same way) and
   * returns a function that unregisters it. Throws {@link BrushError} with code `duplicate-brush`
   * or `invalid-brush`. Plugins register their `brushes` automatically.
   */
  register(brush: BrushInput): () => void;
  /** The brush with this ID, or `undefined` when not registered. */
  get(id: string): Readonly<BrushDefinition> | undefined;
  /** All brushes in registration order. */
  list(): readonly Readonly<BrushDefinition>[];
  /**
   * The brush to draw a stroke with: the registered brush, else the brush registered as
   * {@link DEFAULT_BRUSH_ID}, else a built-in plain pen. Never throws, so strokes whose brush
   * plugin is not installed still render (and keep their stored brush ID).
   */
  resolve(id: string): Readonly<BrushDefinition>;
}

/** @internal */
export interface BrushRuntime {
  readonly api: BrushRegistry;
  clear(): void;
}

/** @internal */
export function createBrushRegistry(): BrushRuntime {
  const byId = new Map<string, BrushDefinition>();

  const api: BrushRegistry = {
    register(input) {
      const brush = defined.has(input) ? (input as BrushDefinition) : defineBrush(input);
      if (byId.has(brush.id)) {
        throw new BrushError('duplicate-brush', `Kuas "${brush.id}" sudah terdaftar.`, brush.id);
      }
      byId.set(brush.id, brush);
      return () => {
        // Only unregister this definition, not another one re-registered with the same ID.
        if (byId.get(brush.id) === brush) byId.delete(brush.id);
      };
    },
    get: (id) => byId.get(id),
    list: () => Object.freeze([...byId.values()]),
    resolve: (id) => byId.get(id) ?? byId.get(DEFAULT_BRUSH_ID) ?? FALLBACK_BRUSH,
  };

  return { api, clear: () => byId.clear() };
}
