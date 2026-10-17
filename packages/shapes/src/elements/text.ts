import { defineElement, enumOf, rect, schema } from '@kujam/core';
import { drawRichText, layoutRichText } from '../canvas.js';
import { COLOR_KEYS, COLOR_VALUES } from '../colors.js';
import { a11yLabel, localize } from '../i18n.js';
import { EMPTY_RICH_TEXT, isRichTextEmpty, richTextSchema, richTextToPlainText } from '../richtext.js';

/** @internal */
export const TEXT_FONT_SIZES = { s: 16, m: 24, l: 32, xl: 48 } as const;

/**
 * Text element (BOARD-1003): rich text, size, alignment, and width mode.
 *
 * @beta
 */
export const textElement = defineElement({
  type: 'text',
  version: 1,
  props: schema({
    text: richTextSchema,
    size: enumOf(['s', 'm', 'l', 'xl']),
    /** Logical alignment so it is correct for right-to-left languages. */
    align: enumOf(['start', 'center', 'end']),
    /** `auto`: width follows content; `fixed`: text wraps at the element width. */
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
  // Height follows content (computed by the BOARD-1003a text layout), so resize only changes width.
  resize: (el, proposed) => ({ w: proposed.w, h: el.h }),
  onDoubleClick: (el, ctx) => {
    ctx.emit('edit', { id: el.id });
  },
  render: {
    canvas: (g, el, _data, _lod, ctx) => {
      if (isRichTextEmpty(el.props.text)) return;
      const maxWidth = el.props.widthMode === 'fixed' ? el.w : undefined;
      const layout = layoutRichText(el.props.text, {
        maxWidth,
        boxWidth: el.w,
        fontSize: TEXT_FONT_SIZES[el.props.size],
        fontFamily: ctx?.theme?.typography.fontFamily,
        align: el.props.align,
      });

      drawRichText(g, layout, {
        x: 0,
        y: 0,
        color: ctx?.theme?.colors[el.props.color] ?? COLOR_VALUES[el.props.color],
        fontFamily: ctx?.theme?.typography.fontFamily,
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
