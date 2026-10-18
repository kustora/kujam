/**
 * Style actions of the built-in elements and the remembered style per tool (BOARD-1108).
 *
 * Every style choice is one element action with the ID `style.<style>.<value>` in the group
 * `style.<style>`, for example `style.color.red`. Style IDs are shared between element types where
 * they mean the same thing (`color` is a stroke's color, a text's color, and a shape's outline
 * color), so `board.getActions()` on a mixed selection keeps them and applies them to every
 * element in one undo step. Running a style action also remembers the value for the tool that
 * creates that element type, so the next element gets it (`board.toolStyles`).
 */

import {
  COLOR_KEYS,
  STICKY_COLORS,
  validate,
  type Board,
  type ElementAction,
  type ElementActionContext,
  type ElementRecord,
  type ToolStyleValue,
} from '@kujam/core';
import { STICKY_COLOR_NAMES } from './colors.js';
import { localize, type Bilingual } from './i18n.js';

/** Bilingual names of the stroke, text, and shape colors (BOARD-1006). */
const COLOR_NAMES: Readonly<Record<(typeof COLOR_KEYS)[number], Bilingual>> = Object.freeze({
  black: { id: 'Hitam', en: 'Black' },
  grey: { id: 'Abu-abu', en: 'Grey' },
  white: { id: 'Putih', en: 'White' },
  red: { id: 'Merah', en: 'Red' },
  orange: { id: 'Oranye', en: 'Orange' },
  yellow: { id: 'Kuning', en: 'Yellow' },
  green: { id: 'Hijau', en: 'Green' },
  blue: { id: 'Biru', en: 'Blue' },
  violet: { id: 'Violet', en: 'Violet' },
  purple: { id: 'Ungu', en: 'Purple' },
});

/** Sticky color names, capitalized for menus. */
const STICKY_NAMES = Object.fromEntries(
  STICKY_COLORS.map((color) => {
    const name = STICKY_COLOR_NAMES[color];
    return [color, { id: name.id.charAt(0).toUpperCase() + name.id.slice(1), en: name.en }];
  }),
) as Record<(typeof STICKY_COLORS)[number], Bilingual>;

/** Names of the built-in brushes by their label key (BOARD-603); other brushes show their label. */
const BRUSH_NAMES: Readonly<Record<string, Bilingual>> = {
  'brush.pen': { id: 'Pena', en: 'Pen' },
  'brush.highlighter': { id: 'Stabilo', en: 'Highlighter' },
};

const SIZE_NAMES: Readonly<Record<'s' | 'm' | 'l' | 'xl', Bilingual>> = {
  s: { id: 'Kecil', en: 'Small' },
  m: { id: 'Sedang', en: 'Medium' },
  l: { id: 'Besar', en: 'Large' },
  xl: { id: 'Sangat besar', en: 'Extra large' },
};

const THICKNESS_NAMES: Readonly<Record<'s' | 'm' | 'l' | 'xl', Bilingual>> = {
  s: { id: 'Tipis', en: 'Thin' },
  m: { id: 'Sedang', en: 'Medium' },
  l: { id: 'Tebal', en: 'Thick' },
  xl: { id: 'Sangat tebal', en: 'Extra thick' },
};

/**
 * Stroke thickness presets in board units (BOARD-1108).
 *
 * @beta
 */
export const DRAW_THICKNESSES = Object.freeze({ s: 2, m: 4, l: 8, xl: 16 } as const);

/**
 * Shape outline width presets in board units (BOARD-1108).
 *
 * @beta
 */
export const GEO_STROKE_WIDTHS = Object.freeze({ s: 1, m: 2, l: 4, xl: 8 } as const);

const GROUP_NAMES = {
  color: { id: 'Warna', en: 'Color' },
  fillColor: { id: 'Warna isian', en: 'Fill color' },
  fill: { id: 'Isian', en: 'Fill' },
  thickness: { id: 'Ketebalan', en: 'Thickness' },
  dash: { id: 'Gaya garis', en: 'Line style' },
  size: { id: 'Ukuran font', en: 'Font size' },
  align: { id: 'Perataan', en: 'Alignment' },
  brush: { id: 'Kuas', en: 'Brush' },
} as const satisfies Record<string, Bilingual>;

/** One style an element offers: a prop and its choices. */
interface StyleSpec {
  /** Style ID shared across element types, for example `color`. */
  readonly style: keyof typeof GROUP_NAMES;
  /** Prop the style writes. */
  readonly prop: string;
  readonly options: readonly {
    readonly id: string;
    readonly value: ToolStyleValue;
    readonly label: Bilingual | string;
  }[];
}

function named<K extends string>(
  values: readonly K[],
  names: Readonly<Record<K, Bilingual>>,
): StyleSpec['options'] {
  return values.map((value) => ({ id: value, value, label: names[value] }));
}

function presets(values: Readonly<Record<'s' | 'm' | 'l' | 'xl', number>>): StyleSpec['options'] {
  return (['s', 'm', 'l', 'xl'] as const).map((id) => ({
    id,
    value: values[id],
    label: THICKNESS_NAMES[id],
  }));
}

/** Builds the style actions of one element. `scope` is the tool whose style is remembered. */
function styleActions<P>(
  el: ElementRecord<P>,
  ctx: ElementActionContext<P>,
  scope: string,
  specs: readonly StyleSpec[],
): ElementAction[] {
  const props = el.props as Record<string, unknown>;
  return specs.flatMap((spec) => {
    const group = localize(GROUP_NAMES[spec.style], ctx.locale);
    return spec.options.map((option): ElementAction => ({
      id: `style.${spec.style}.${option.id}`,
      label: `${group}: ${typeof option.label === 'string' ? option.label : localize(option.label, ctx.locale)}`,
      group: `style.${spec.style}`,
      isActive: () => props[spec.prop] === option.value,
      run: () => {
        const patch = { [spec.prop]: option.value } as Partial<P>;
        if (ctx.updateProps(patch)) ctx.toolStyles.set(scope, { [spec.prop]: option.value });
      },
    }));
  });
}

const COLOR_OPTIONS = named(COLOR_KEYS, COLOR_NAMES);

/** @internal */
export function stickyActions<P>(
  el: ElementRecord<P>,
  ctx: ElementActionContext<P>,
): ElementAction[] {
  return styleActions(el, ctx, 'sticky', [
    { style: 'color', prop: 'color', options: named(STICKY_COLORS, STICKY_NAMES) },
  ]);
}

/** @internal */
export function textActions<P>(
  el: ElementRecord<P>,
  ctx: ElementActionContext<P>,
): ElementAction[] {
  return styleActions(el, ctx, 'text', [
    { style: 'color', prop: 'color', options: COLOR_OPTIONS },
    { style: 'size', prop: 'size', options: named(['s', 'm', 'l', 'xl'], SIZE_NAMES) },
    {
      style: 'align',
      prop: 'align',
      options: named(['start', 'center', 'end'], {
        start: { id: 'Awal', en: 'Start' },
        center: { id: 'Tengah', en: 'Center' },
        end: { id: 'Akhir', en: 'End' },
      }),
    },
  ]);
}

/** @internal */
export function drawActions<P>(
  el: ElementRecord<P>,
  ctx: ElementActionContext<P>,
): ElementAction[] {
  return styleActions(el, ctx, 'draw', [
    { style: 'color', prop: 'color', options: COLOR_OPTIONS },
    { style: 'thickness', prop: 'thickness', options: presets(DRAW_THICKNESSES) },
    {
      style: 'brush',
      prop: 'brush',
      options: ctx.brushes.map((brush) => ({
        id: brush.id,
        value: brush.id,
        label: Object.hasOwn(BRUSH_NAMES, brush.label) ? BRUSH_NAMES[brush.label]! : brush.label,
      })),
    },
  ]);
}

/** @internal */
export function geoActions<P>(el: ElementRecord<P>, ctx: ElementActionContext<P>): ElementAction[] {
  return styleActions(el, ctx, 'geo', [
    { style: 'color', prop: 'strokeColor', options: COLOR_OPTIONS },
    {
      style: 'fill',
      prop: 'fill',
      options: named(['none', 'semi', 'solid'], {
        none: { id: 'Tanpa isian', en: 'None' },
        semi: { id: 'Transparan', en: 'Semi' },
        solid: { id: 'Penuh', en: 'Solid' },
      }),
    },
    { style: 'fillColor', prop: 'fillColor', options: COLOR_OPTIONS },
    { style: 'thickness', prop: 'strokeWidth', options: presets(GEO_STROKE_WIDTHS) },
    {
      style: 'dash',
      prop: 'dash',
      options: named(['solid', 'dashed', 'dotted'], {
        solid: { id: 'Penuh', en: 'Solid' },
        dashed: { id: 'Putus-putus', en: 'Dashed' },
        dotted: { id: 'Titik-titik', en: 'Dotted' },
      }),
    },
  ]);
}

/**
 * Remembered style of `toolId` as props of `type` (BOARD-1108): only keys that are props of the
 * type and whose value passes the prop's schema, so a stale or foreign style never breaks
 * creation.
 *
 * @internal
 */
export function rememberedProps(
  board: Board,
  toolId: string,
  type: string,
): Record<string, unknown> {
  const shape = board.elements.get(type)?.props.shape as Record<string, never> | undefined;
  const props: Record<string, unknown> = {};
  if (!shape) return props;
  for (const [key, value] of Object.entries(board.toolStyles.get(toolId))) {
    if (Object.hasOwn(shape, key) && validate(shape[key]!, value).ok) props[key] = value;
  }
  return props;
}
