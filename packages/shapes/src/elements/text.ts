import { defineElement, enumOf, rect, schema } from '@kujam/core';
import { drawPlainText } from '../canvas.js';
import { COLOR_KEYS, COLOR_VALUES } from '../colors.js';
import { a11yLabel, localize } from '../i18n.js';
import { EMPTY_RICH_TEXT, richTextSchema, richTextToPlainText } from '../richtext.js';

/** @internal */
export const TEXT_FONT_SIZES = { s: 16, m: 24, l: 32, xl: 48 } as const;

/**
 * Elemen teks (BOARD-1003): rich text, ukuran, perataan, dan mode lebar.
 *
 * @beta
 */
export const textElement = defineElement({
  type: 'text',
  version: 1,
  props: schema({
    text: richTextSchema,
    size: enumOf(['s', 'm', 'l', 'xl']),
    /** Perataan logis agar benar untuk bahasa kanan-ke-kiri. */
    align: enumOf(['start', 'center', 'end']),
    /** `auto`: lebar mengikuti isi; `fixed`: teks dibungkus pada lebar elemen. */
    widthMode: enumOf(['auto', 'fixed']),
    color: enumOf(COLOR_KEYS),
  }),
  defaults: {
    text: EMPTY_RICH_TEXT,
    size: 'm',
    align: 'start',
    widthMode: 'auto',
    color: 'black',
  },
  geometry: (el) => rect(el.w, el.h),
  // Tinggi mengikuti isi (dihitung tata letak teks BOARD-1003a), jadi resize hanya mengubah lebar.
  resize: (el, proposed) => ({ w: proposed.w, h: el.h }),
  render: {
    // TODO(BOARD-1003a): renderer rich text (wrap, daftar, tebal/miring, tautan).
    canvas: (g, el) => {
      drawPlainText(g, richTextToPlainText(el.props.text), {
        x: 0,
        y: 0,
        maxWidth: el.w,
        fontSize: TEXT_FONT_SIZES[el.props.size],
        color: COLOR_VALUES[el.props.color],
        align: el.props.align,
      });
    },
  },
  a11y: (el, _data, ctx) => ({
    role: 'group',
    label: a11yLabel(
      localize({ id: 'Teks', en: 'Text' }, ctx.locale),
      richTextToPlainText(el.props.text),
    ),
  }),
  export: { text: (el) => richTextToPlainText(el.props.text) },
});
