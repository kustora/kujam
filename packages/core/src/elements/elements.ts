/**
 * Element contract (`defineElement`) and element type registry (BOARD-601).
 *
 * Built-in elements (`@kujam/shapes`) and custom elements use the same API. Installed into
 * `createBoard({ plugins })` via `definePlugin` (BOARD-602); `create`/`update` validation belongs to
 * BOARD-205, and props migration on load belongs to BOARD-702.
 */

import type { BrushDefinition } from './brushes.js';
import type { Geometry, Point } from '../geometry/geometry.js';
import type { InferShape, ObjectSchema, SchemaResult, SchemaShape } from '../document/schema.js';
import { object, validate } from '../document/schema.js';
import type { ThemeDefinition } from '../theme/theme.js';
import type { ToolStyles } from '../tools/tool-styles.js';
import type { AssetAdapter, AssetRecord, ElementRecord } from '../types.js';

// ---------- Render context and callbacks ----------

/**
 * 2D drawing context received by `render.canvas`.
 *
 * Structural subset of `CanvasRenderingContext2D` so core stays free of DOM types: a real context from
 * `<canvas>` or `OffscreenCanvas` can be passed directly without an adapter. Renderers may pass
 * an object with extra helpers (BOARD-1204); members listed here will not be removed.
 *
 * @public
 */
export interface ElementCanvasContext {
  globalAlpha: number;
  globalCompositeOperation: string;
  /** CSS color string, or a renderer-owned gradient/pattern. */
  fillStyle: string | object;
  /** CSS color string, or a renderer-owned gradient/pattern. */
  strokeStyle: string | object;
  lineWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'bevel' | 'miter' | 'round';
  font: string;
  textAlign: 'center' | 'end' | 'left' | 'right' | 'start';
  textBaseline: 'alphabetic' | 'bottom' | 'hanging' | 'ideographic' | 'middle' | 'top';
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(fillRule?: 'evenodd' | 'nonzero'): void;
  stroke(): void;
  clip(fillRule?: 'evenodd' | 'nonzero'): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { readonly width: number };
  setLineDash(segments: number[]): void;
  /**
   * Draws an image or bitmap onto the canvas (BOARD-1103).
   *
   * @beta
   */
  drawImage?(image: object, dx: number, dy: number): void;
  drawImage?(image: object, dx: number, dy: number, dw: number, dh: number): void;
  drawImage?(
    image: object,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/**
 * DOM host for `render.html`. Core does not use DOM types, so this interface is empty and
 * is extended through declaration merging by a package that has the DOM (for example `@kujam/renderer`:
 * `interface ElementHtmlHost extends HTMLElement {}`). At runtime the value is a DOM element.
 *
 * @beta
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extension point for declaration merging
export interface ElementHtmlHost {}

/**
 * Level-of-detail state when `render.canvas` is called.
 *
 * @public
 */
export interface ElementLodState {
  /** Current camera zoom (1 = 100%). */
  readonly zoom: number;
  /** `true` when the element is drawn in its compact version (below `lod.compactBelowZoom`). */
  readonly compact: boolean;
  /**
   * `true` while the inline text editor of this element is open. The editor shows the text over
   * the canvas, so the element should skip drawing its text (but still draw its shape) to avoid a
   * doubled, slightly offset copy.
   */
  readonly editingText?: boolean;
}

/**
 * Context the board passes to element callbacks (`onDoubleClick`, `a11y`, `actions`,
 * `render.html`). New members may be added without being considered a breaking change.
 *
 * @public
 */
export interface ElementContext {
  /** Board UI locale (for example `'id'` or `'en'`), for a11y labels and default text. */
  readonly locale: string;
  /** Active whiteboard theme definition (BOARD-1006). */
  readonly theme: Readonly<ThemeDefinition>;
  /**
   * Emits an `action` event the application can listen to (BOARD-605).
   *
   * @beta
   */
  emit(name: string, payload?: unknown): void;
  /**
   * The brush to draw a stroke with (BOARD-603): the registered brush, or the default pen for
   * unknown IDs. Same as `board.brushes.resolve`.
   *
   * @beta
   */
  resolveBrush(id: string): Readonly<BrushDefinition>;
  /**
   * Asset adapter for resolving media assets (BOARD-1103).
   *
   * @beta
   */
  readonly assets?: Readonly<AssetAdapter> | null;
  /**
   * Looks up an asset record from the document (BOARD-1103).
   *
   * @beta
   */
  getAsset?(id: string): Readonly<AssetRecord> | undefined;
}

/**
 * Failure status of an external data resolver (BOARD-604).
 *
 * @beta
 */
export type ResolveErrorStatus = 'forbidden' | 'not-found' | 'error';

/**
 * Value returned by a resolver when data cannot be provided (BOARD-604).
 *
 * @beta
 */
export interface ResolveError {
  readonly status: ResolveErrorStatus;
  readonly message?: string;
}

/**
 * Result of `resolve`: synchronous data from a cache, a {@link ResolveError}, or a promise of either.
 *
 * @beta
 */
export type ResolveResult<D> = D | ResolveError | PromiseLike<D | ResolveError>;

/**
 * Context for `resolve`. The resolver map is supplied by the application via `createBoard({ resolvers })`
 * (BOARD-604); its type will be narrowed by BOARD-607.
 *
 * @beta
 */
export interface ElementResolveContext {
  readonly resolvers: Readonly<Record<string, (id: string) => unknown>>;
  /**
   * Asset adapter for resolving media assets (BOARD-1103).
   *
   * @beta
   */
  readonly assets?: Readonly<AssetAdapter> | null;
  /**
   * Looks up an asset record from the document (BOARD-1103).
   *
   * @beta
   */
  getAsset?(id: string): Readonly<AssetRecord> | undefined;
}

// ---------- Contract parts ----------

/**
 * Built-in resize modes understood by element transforms (BOARD-406).
 *
 * @public
 */
export type ElementResizeMode = 'free' | 'fixed-ratio' | 'none';

/**
 * Element size in board units.
 *
 * @public
 */
export interface ElementSize {
  readonly w: number;
  readonly h: number;
}

/**
 * Custom resize: receives the size proposed by the handle and returns the size to use,
 * for example to enforce a minimum size or only change the width.
 *
 * @public
 */
// "Bivariance" trick (method signature) so specific definitions still fit into
// AnyElementDefinition, for example in a plugin's `elements` list.
export type ElementResizeHandler<P> = {
  bivarianceHack(el: ElementRecord<P>, proposed: ElementSize): ElementSize;
}['bivarianceHack'];

/**
 * Element resize behavior: one of {@link ElementResizeMode} or a custom function.
 *
 * @public
 */
export type ElementResize<P> = ElementResizeMode | ElementResizeHandler<P>;

/**
 * Map of named size presets to width and height dimensions in board units (BOARD-1213).
 *
 * @public
 */
export type SizePresets = Readonly<Record<string, ElementSize>>;

/**
 * Creates an {@link ElementResizeHandler} that maps continuous handle drag dimensions
 * to the nearest predefined size preset (such as `'s'`, `'m'`, `'l'`) (BOARD-1213).
 *
 * Snapping is determined by Euclidean distance in (w, h) space. If `presets` is empty,
 * `proposed` size is returned unchanged.
 *
 * @example
 * ```ts
 * const cardResize = createPresetResizeHandler({
 *   s: { w: 160, h: 100 },
 *   m: { w: 240, h: 150 },
 *   l: { w: 320, h: 200 },
 * });
 *
 * defineElement({
 *   type: 'card',
 *   version: 1,
 *   props: object({}),
 *   resize: cardResize,
 * });
 * ```
 *
 * @public
 */
export function createPresetResizeHandler<P = Record<string, unknown>>(
  presets: SizePresets,
): ElementResizeHandler<P> {
  const entries = Object.entries(presets);
  if (entries.length === 0) {
    return (_el, proposed) => proposed;
  }

  return (_el, proposed) => {
    const first = entries[0];
    if (!first) return proposed;
    let best = first[1];
    let minDistanceSq = Number.POSITIVE_INFINITY;

    for (const [, size] of entries) {
      const dw = proposed.w - size.w;
      const dh = proposed.h - size.h;
      const distSq = dw * dw + dh * dh;
      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        best = size;
      }
    }

    return best;
  };
}

/**
 * HTML view returned by `render.html`.
 *
 * @beta
 */
export interface ElementHtmlView<P, D> {
  /** Called when the record or resolver data changes. */
  update(el: ElementRecord<P>, data: D | undefined): void;
  /** Called when the element leaves the viewport, is deleted, or the renderer unmounts. */
  destroy(): void;
}

/**
 * How an element is drawn. An element may use either or both.
 *
 * @public
 */
export interface ElementRenderers<P, D> {
  /**
   * Draws the element on Canvas 2D in the element's local coordinates: the renderer has already applied
   * the `x, y` translation, rotation, and opacity before calling. `data` is always `undefined` when
   * the element has no `resolve`. Renderers pass the board's element context as `ctx`; it may be
   * missing for callers outside a board (thumbnails, tests), so elements must handle `undefined`.
   */
  canvas?(
    g: ElementCanvasContext,
    el: ElementRecord<P>,
    data: D | undefined,
    lod: ElementLodState,
    ctx?: ElementContext,
  ): void;
  /**
   * Renders the element as DOM in the HTML layer (BOARD-1201).
   *
   * @beta
   */
  html?(
    host: ElementHtmlHost,
    el: ElementRecord<P>,
    data: D | undefined,
    ctx: ElementContext,
  ): ElementHtmlView<P, D>;
}

/**
 * Level-of-detail settings (BOARD-1204).
 *
 * @beta
 */
export interface ElementLod {
  /** Below this zoom the element is drawn compactly via `render.canvas` and its DOM is detached. */
  readonly compactBelowZoom: number;
}

/**
 * Element accessibility role and label (a11y tree, BOARD-1901).
 *
 * @public
 */
export interface ElementA11y {
  /** ARIA role, for example `'note'`, `'img'`, or `'article'`. */
  readonly role: string;
  /** Spoken label, for example `'Yellow sticky: Meeting idea'`. */
  readonly label: string;
  readonly description?: string;
}

/**
 * Per-element exporters.
 *
 * @public
 */
export interface ElementExporters<P, D> {
  /** Plain text of the element, for text export and search. */
  text?(el: ElementRecord<P>, data: D | undefined): string;
  /**
   * SVG fragment of the element in local coordinates (BOARD-1212).
   *
   * @beta
   */
  svg?(el: ElementRecord<P>, data: D | undefined): string;
}

/**
 * A single action for the contextual toolbar and right-click menu (BOARD-605).
 *
 * @beta
 */
export interface ElementAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly group?: string;
  isEnabled?(): boolean;
  /**
   * Whether the action's choice is the current one, for actions that pick a value such as a color
   * (BOARD-1108). UIs show it as checked.
   *
   * @beta
   */
  isActive?(): boolean;
  run(): void;
}

/**
 * Context passed to an element's `actions` (BOARD-605, BOARD-1108): the element context plus what
 * an action needs to change its element. Changes made while an action runs form one undo step.
 *
 * @beta
 */
export interface ElementActionContext<P = Record<string, unknown>> extends ElementContext {
  /**
   * Merges `patch` into the element's props, like `board.update(el.id, { props: patch })`.
   *
   * @returns `false` when the update was rejected (for example the element is locked or the props
   *   fail the type schema).
   */
  updateProps(patch: Partial<P>): boolean;
  /** Brushes registered on the board, in registration order (BOARD-603). */
  readonly brushes: readonly Readonly<BrushDefinition>[];
  /** Remembered style per tool, so a style action also applies to the next element (BOARD-1108). */
  readonly toolStyles: ToolStyles;
}

/**
 * Context passed to a drop target's `onDrop` (BOARD-1208): the element context plus what the
 * target needs to absorb the dropped element. Every change made while `onDrop` runs, together
 * with the move that carried the element there, forms one transaction and one undo step.
 *
 * @beta
 */
export interface ElementDropContext<P = Record<string, unknown>> extends ElementContext {
  /**
   * Merges `patch` into the target's props, like `board.update(target.id, { props: patch })`,
   * for example to append the dropped element's ID to a list.
   *
   * @returns `false` when the update was rejected (for example the props fail the type schema).
   */
  updateProps(patch: Partial<P>): boolean;
  /**
   * Deletes the dropped element (and its descendants), for targets that absorb what is dropped.
   * When not called, the dropped element is kept where it was released.
   *
   * @returns `false` when the deletion was rejected (for example by a permission hook).
   */
  removeDropped(): boolean;
}

/**
 * Makes an element type accept other elements dropped onto it with the select tool (BOARD-1208),
 * for example a collection element that gathers item cards. While accepted elements are dragged
 * over the target it is highlighted; on release `onDrop` runs once per accepted element.
 *
 * @example
 * ```ts
 * defineElement({
 *   type: 'collection',
 *   version: 1,
 *   props: schema({ itemIds: array(string()) }),
 *   dropTarget: {
 *     accepts: (dropped) => dropped.type === 'item-card',
 *     onDrop(target, dropped, _point, ctx) {
 *       ctx.updateProps({ itemIds: [...target.props.itemIds, String(dropped.props.itemId)] });
 *       ctx.removeDropped();
 *     },
 *   },
 * });
 * ```
 *
 * @beta
 */
export interface ElementDropTarget<P = Record<string, unknown>> {
  /**
   * Whether `dropped` may be dropped onto `target`. Called often while dragging, so it must be
   * cheap and free of side effects. A throwing `accepts` counts as `false`.
   */
  accepts(dropped: Readonly<ElementRecord>, target: Readonly<ElementRecord<P>>): boolean;
  /**
   * Called on release for each accepted element. `target` is the latest version of the target
   * (it already includes changes made for elements dropped before this one); `point` is the
   * release position in board coordinates. A throwing `onDrop` rolls back the changes of the
   * whole drop (the move itself is kept) and is reported as a `plugin-error` event.
   */
  onDrop(
    target: Readonly<ElementRecord<P>>,
    dropped: Readonly<ElementRecord>,
    point: Point,
    ctx: ElementDropContext<P>,
  ): void;
}

/**
 * Placeholder content when data is unavailable (BOARD-1202).
 *
 * @beta
 */
export interface ElementPlaceholder {
  readonly label: string;
}

/**
 * A single props migration step from version `n` to `n + 1`. Must be pure: does not mutate its input.
 *
 * @public
 */
export type ElementPropsMigration = (props: Record<string, unknown>) => Record<string, unknown>;

/**
 * Per-version props migrations for a type. Key `n` migrates props from version `n` to `n + 1`; keys must be
 * integers from `0` to `version - 1`. Versions without a step are treated as leaving props unchanged.
 * Run when loading a document (BOARD-702) for every element whose `typeVersion` (missing means `1`)
 * is below `version`; steps receive frozen props and the element's `typeVersion` is then set to
 * `version`.
 *
 * @public
 */
export type ElementMigrations = Readonly<Record<number, ElementPropsMigration>>;

/**
 * External reference declared by an element (BOARD-1802).
 *
 * @public
 */
export interface ElementReference {
  /** Resolver name handling this reference. */
  readonly resolver: string;
  /** Referenced entity ID. */
  readonly id: string;
}

/**
 * Element type definition. Created with {@link defineElement}.
 *
 * `T` is the type name, `S` the props schema shape, and `D` the data type from `resolve`
 * (`undefined` when the element does not use external data).
 *
 * @public
 */
export interface ElementDefinition<
  T extends string = string,
  S extends SchemaShape = SchemaShape,
  D = unknown,
> {
  /** Type name stored in `ElementRecord.type`. Unique per registry, no spaces. */
  readonly type: T;
  /** Props schema version, an integer starting at 1. Bump whenever props change incompatibly. */
  readonly version: number;
  /** Props schema (ADR-007). Strict object: unknown keys are rejected. */
  readonly props: ObjectSchema<S>;
  /** Default props values for new elements. Each value must pass its key's schema. */
  readonly defaults?: Partial<InferShape<S>>;
  /** Local geometry for hit-testing, snapping, and selection. When absent, a `w × h` box is used. */
  geometry?(el: ElementRecord<InferShape<S>>): Geometry;
  /** Resize behavior; defaults to `'free'`. */
  readonly resize?: ElementResize<InferShape<S>>;
  /**
   * Smallest size interactive resizing may produce, in board units (BOARD-406). Defaults to
   * `{ w: 1, h: 1 }`.
   *
   * @beta
   */
  readonly minSize?: ElementSize;
  /** How the element is drawn. */
  readonly render?: ElementRenderers<InferShape<S>, D>;
  /** Called when the element is double-clicked, for example to enter edit mode. */
  onDoubleClick?(el: ElementRecord<InferShape<S>>, ctx: ElementContext): void;
  /**
   * Whether connectors can start from this element through the quick-connect handles shown on
   * each side while it is selected alone. Defaults to `false`.
   *
   * @beta
   */
  readonly connectable?: boolean;
  /** Props migrations from older versions; see {@link ElementMigrations}. */
  readonly migrate?: ElementMigrations;
  /** Accessibility role and label. */
  a11y?(el: ElementRecord<InferShape<S>>, data: D | undefined, ctx: ElementContext): ElementA11y;
  /** Element exporters. */
  readonly export?: ElementExporters<InferShape<S>, D>;
  /**
   * Fetches external data; the package does not store this data in the document (BOARD-604).
   *
   * @beta
   */
  resolve?(el: ElementRecord<InferShape<S>>, ctx: ElementResolveContext): ResolveResult<D>;
  /**
   * Level-of-detail settings (BOARD-1204).
   *
   * @beta
   */
  readonly lod?: ElementLod;
  /**
   * Element contextual actions (BOARD-605), for example the style actions of built-in elements
   * (BOARD-1108). Collected and merged for a selection with `board.getActions`.
   *
   * @beta
   */
  actions?(
    el: ElementRecord<InferShape<S>>,
    data: D | undefined,
    ctx: ElementActionContext<InferShape<S>>,
  ): readonly ElementAction[];
  /**
   * Placeholder shown in place of the element while its data is loading (`'loading'`, replacing
   * the built-in skeleton) or unavailable (BOARD-1202). Placeholders never show resolved data.
   *
   * @beta
   */
  placeholder?(reason: ResolveErrorStatus | 'loading'): ElementPlaceholder;
  /**
   * Lets other elements be dropped onto this one (BOARD-1208); see {@link ElementDropTarget}.
   *
   * @beta
   */
  readonly dropTarget?: ElementDropTarget<InferShape<S>>;
  /**
   * External entity references declared by this element (BOARD-1802),
   * used by the server to build card placement indices.
   *
   * @public
   */
  references?(el: ElementRecord<InferShape<S>>): readonly ElementReference[];
}

/**
 * Any element definition, for holding many types at once (registries, plugin lists).
 *
 * @public
 */
export type AnyElementDefinition = ElementDefinition<string, SchemaShape, unknown>;

/**
 * Props type of an element definition.
 *
 * @example
 * ```ts
 * type StickyProps = ElementPropsOf<typeof stickyElement>;
 * ```
 *
 * @public
 */
export type ElementPropsOf<E> =
  E extends ElementDefinition<string, infer S, infer _D> ? InferShape<S> : never;

/**
 * Data type for callbacks, derived from `resolve`'s return type: `Promise` is unwrapped and
 * {@link ResolveError} is removed. `undefined` when the element has no `resolve`.
 *
 * @beta
 */
export type ResolvedData<R> = Exclude<Awaited<R>, ResolveError>;

// ---------- Error ----------

/**
 * Codes for {@link ElementDefinitionError}.
 *
 * @public
 */
export type ElementDefinitionErrorCode = 'invalid-definition' | 'duplicate-type';

/**
 * Error thrown when an element definition is invalid or its type is already registered.
 *
 * @public
 */
export class ElementDefinitionError extends Error {
  readonly code: ElementDefinitionErrorCode;
  /** The offending element type, or `undefined` when `type` itself is invalid. */
  readonly type: string | undefined;
  /** Definition problems; empty for `duplicate-type`. */
  readonly errors: readonly string[];

  constructor(
    code: ElementDefinitionErrorCode,
    message: string,
    type: string | undefined,
    errors: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ElementDefinitionError';
    this.code = code;
    this.type = type;
    this.errors = errors;
  }
}

// ---------- Definition validation ----------

const RESIZE_MODES: readonly string[] = ['free', 'fixed-ratio', 'none'];
const MIGRATION_KEY = /^(0|[1-9]\d*)$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkFunctions(
  owner: Record<string, unknown>,
  prefix: string,
  keys: readonly string[],
  errors: string[],
): void {
  for (const key of keys) {
    if (owner[key] !== undefined && typeof owner[key] !== 'function') {
      errors.push(`${prefix}${key} wajib berupa fungsi.`);
    }
  }
}

function isObjectSchema(value: unknown): value is ObjectSchema<SchemaShape> {
  return (
    isPlainObject(value) &&
    value.kind === 'object' &&
    isPlainObject(value.shape) &&
    typeof value._check === 'function'
  );
}

/**
 * Checks `defaults` against the props schema without requiring keys that have no default.
 *
 * ADR-007 object schemas check each key independently (there are no cross-key rules),
 * so validating a sub-schema containing only the keys in `defaults` is equivalent to
 * validating `{ ...anyRequiredValues, ...defaults }`: if every required key is later filled with
 * a valid value, the merged result is guaranteed valid. Keys not in the schema are still rejected
 * (`unknown_key`) because the sub-schema is also a strict object.
 */
function checkDefaults(props: ObjectSchema<SchemaShape>, defaults: unknown, errors: string[]) {
  if (!isPlainObject(defaults)) {
    errors.push('defaults wajib berupa objek.');
    return;
  }
  const subShape: SchemaShape = {};
  for (const key of Object.keys(defaults)) {
    if (Object.prototype.hasOwnProperty.call(props.shape, key)) subShape[key] = props.shape[key]!;
  }
  const result = validate(object(subShape), defaults);
  if (!result.ok) {
    for (const issue of result.issues) {
      const path = issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('');
      errors.push(`defaults${path} tidak lolos skema props (${issue.code}: ${issue.message}).`);
    }
  }
}

function checkMigrations(migrate: unknown, version: unknown, errors: string[]): void {
  if (!isPlainObject(migrate)) {
    errors.push('migrate wajib berupa objek { [versiAsal]: fungsi }.');
    return;
  }
  const max = Number.isInteger(version) ? (version as number) - 1 : undefined;
  for (const [key, step] of Object.entries(migrate)) {
    if (!MIGRATION_KEY.test(key) || (max !== undefined && Number(key) > max)) {
      errors.push(
        `migrate["${key}"]: kunci wajib bilangan bulat 0 sampai version - 1` +
          (max !== undefined && max >= 0 ? ` (${max}).` : '.'),
      );
    }
    if (typeof step !== 'function') errors.push(`migrate["${key}"] wajib berupa fungsi.`);
  }
}

/** Collects every problem in an element definition. An empty list means valid. */
function collectElementDefinitionErrors(definition: unknown): string[] {
  if (!isPlainObject(definition)) return ['Definisi elemen wajib berupa objek.'];
  const def = definition;
  const errors: string[] = [];

  if (typeof def.type !== 'string' || def.type.length === 0 || /\s/.test(def.type)) {
    errors.push('type wajib berupa string tidak kosong tanpa spasi.');
  }
  if (!Number.isInteger(def.version) || (def.version as number) < 1) {
    errors.push('version wajib berupa bilangan bulat mulai 1.');
  }
  if (!isObjectSchema(def.props)) {
    errors.push('props wajib berupa skema objek dari schema() atau object().');
  } else if (def.defaults !== undefined) {
    checkDefaults(def.props, def.defaults, errors);
  }

  checkFunctions(
    def,
    '',
    ['geometry', 'onDoubleClick', 'a11y', 'resolve', 'actions', 'placeholder', 'references'],
    errors,
  );

  if (
    def.resize !== undefined &&
    typeof def.resize !== 'function' &&
    !RESIZE_MODES.includes(def.resize as string)
  ) {
    errors.push(`resize wajib salah satu dari ${RESIZE_MODES.join(', ')}, atau fungsi.`);
  }
  if (def.minSize !== undefined) {
    const min = isPlainObject(def.minSize) ? def.minSize : undefined;
    const ok = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (!min || !ok(min.w) || !ok(min.h)) {
      errors.push('minSize wajib berupa objek { w, h } dengan angka berhingga dan tidak negatif.');
    }
  }
  if (def.render !== undefined) {
    if (isPlainObject(def.render))
      checkFunctions(def.render, 'render.', ['canvas', 'html'], errors);
    else errors.push('render wajib berupa objek { canvas?, html? }.');
  }
  if (def.export !== undefined) {
    if (isPlainObject(def.export)) checkFunctions(def.export, 'export.', ['text', 'svg'], errors);
    else errors.push('export wajib berupa objek { text?, svg? }.');
  }
  if (def.migrate !== undefined) checkMigrations(def.migrate, def.version, errors);
  if (def.dropTarget !== undefined) {
    if (isPlainObject(def.dropTarget)) {
      for (const key of ['accepts', 'onDrop'] as const) {
        if (typeof def.dropTarget[key] !== 'function') {
          errors.push(`dropTarget.${key} wajib berupa fungsi.`);
        }
      }
    } else {
      errors.push('dropTarget wajib berupa objek { accepts, onDrop }.');
    }
  }
  if (def.lod !== undefined) {
    const zoom = isPlainObject(def.lod) ? def.lod.compactBelowZoom : undefined;
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom <= 0) {
      errors.push('lod.compactBelowZoom wajib berupa angka lebih dari 0.');
    }
  }
  return errors;
}

function assertValidDefinition(definition: unknown): void {
  const errors = collectElementDefinitionErrors(definition);
  if (errors.length === 0) return;
  const type =
    isPlainObject(definition) && typeof definition.type === 'string' && definition.type
      ? definition.type
      : undefined;
  throw new ElementDefinitionError(
    'invalid-definition',
    `Definisi elemen${type ? ` "${type}"` : ''} tidak valid: ${errors.join(' ')}`,
    type,
    errors,
  );
}

// ---------- defineElement ----------

/**
 * Defines an element type. Used by both built-in and custom elements.
 *
 * The `props` type is inferred from the schema, so `el.props` is precisely typed in every callback and
 * `defaults` is checked as `Partial<props>`. The definition is validated immediately (see
 * {@link ElementDefinitionError}) and the object is shallow-frozen.
 *
 * @example
 * ```ts
 * const card = defineElement({
 *   type: 'contact-card',
 *   version: 1,
 *   props: schema({ refId: string(), size: enumOf(['s', 'm', 'l']) }),
 *   defaults: { size: 'm' },
 *   geometry: (el) => rect(el.w, el.h),
 *   resize: 'fixed-ratio',
 *   a11y: (el) => ({ role: 'article', label: `Contact ${el.props.refId}` }),
 *   export: { text: (el) => el.props.refId },
 * });
 * ```
 *
 * @throws {@link ElementDefinitionError} with code `invalid-definition`.
 * @public
 */
export function defineElement<const T extends string, S extends SchemaShape, R = undefined>(
  definition: ElementDefinition<T, S, ResolvedData<R>> & {
    resolve?(el: ElementRecord<InferShape<S>>, ctx: ElementResolveContext): R;
  },
): ElementDefinition<T, S, ResolvedData<R>> {
  assertValidDefinition(definition);
  return Object.freeze(definition);
}

// ---------- Registry ----------

/**
 * Element type registry owned by one board or one plugin set. There is no global state.
 *
 * Unregistered types may still exist in the document (shown as a placeholder, and their
 * data is not lost); the registry just reports `get(type)` → `undefined`.
 *
 * @public
 */
export interface ElementRegistry {
  /**
   * Registers a definition. Throws {@link ElementDefinitionError} with code
   * `duplicate-type` when the type is already registered, or `invalid-definition` when invalid.
   */
  register(definition: AnyElementDefinition): void;
  /** Definition for the type, or `undefined` when not registered. */
  get(type: string): AnyElementDefinition | undefined;
  has(type: string): boolean;
  /** All definitions in registration order. */
  list(): readonly AnyElementDefinition[];
  /**
   * Validates props against the type schema without changing values. Returns `undefined` when
   * the type is not registered, so the caller decides: loading a document keeps the
   * data, while creating a new element should reject it.
   */
  validateElementProps(
    type: string,
    props: unknown,
  ): SchemaResult<Record<string, unknown>> | undefined;
}

/**
 * Creates an element type registry, optionally with initial definitions (registered in order).
 *
 * @example
 * ```ts
 * const registry = createElementRegistry(defaultElements);
 * registry.register(card);
 * const result = registry.validateElementProps('contact-card', { refId: 'k1', size: 'm' });
 * ```
 *
 * @public
 */
export function createElementRegistry(
  definitions:
    Iterable<AnyElementDefinition> | { readonly elements?: Iterable<AnyElementDefinition> } = [],
): ElementRegistry {
  const byType = new Map<string, AnyElementDefinition>();

  const registry: ElementRegistry = {
    register(definition) {
      assertValidDefinition(definition);
      if (byType.has(definition.type)) {
        throw new ElementDefinitionError(
          'duplicate-type',
          `Tipe elemen "${definition.type}" sudah terdaftar. Setiap tipe hanya boleh didaftarkan ` +
            'sekali; pakai nama tipe lain atau pastikan plugin yang sama tidak dipasang dua kali.',
          definition.type,
        );
      }
      byType.set(definition.type, definition);
    },
    get: (type) => byType.get(type),
    has: (type) => byType.has(type),
    list: () => Object.freeze([...byType.values()]),
    validateElementProps(type, props) {
      const definition = byType.get(type);
      return definition ? validate(definition.props, props) : undefined;
    },
  };

  const items: Iterable<AnyElementDefinition> =
    definitions !== null && typeof definitions === 'object' && Symbol.iterator in definitions
      ? (definitions as Iterable<AnyElementDefinition>)
      : ((definitions as { readonly elements?: Iterable<AnyElementDefinition> } | null)?.elements ??
        []);
  for (const definition of items) registry.register(definition);
  return registry;
}
