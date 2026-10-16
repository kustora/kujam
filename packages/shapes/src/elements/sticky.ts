import { defineElement, enumOf, nullable, rect, schema, string } from '@kujam/core';
import { drawPlainText, traceRoundedRect } from '../canvas.js';
import { COLOR_VALUES, STICKY_COLOR_NAMES, STICKY_COLOR_VALUES, STICKY_COLORS } from '../colors.js';
import { a11yLabel, localize } from '../i18n.js';
import { EMPTY_RICH_TEXT, richTextSchema, richTextToPlainText } from '../richtext.js';

const PADDING = 16;

/**
 * Elemen sticky note (BOARD-1001): rich text, warna dari palet sticky, dan penulis.
 *
 * @beta
 */
export const stickyElement = defineElement({
  type: 'sticky',
  version: 1,
  props: schema({
    text: richTextSchema,
    color: enumOf(STICKY_COLORS),
    /** ID penulis dari aplikasi pemakai, atau `null`. */
    authorId: nullable(string({ maxLength: 256 })),
  }),
  defaults: { text: EMPTY_RICH_TEXT, color: 'yellow', authorId: null },
  geometry: (el) => rect(el.w, el.h),
  resize: 'fixed-ratio',
  render: {
    // TODO(BOARD-1001): font mengecil otomatis, elipsis, editor HTML saat diedit.
    canvas: (g, el) => {
      traceRoundedRect(g, el.w, el.h, 4);
      g.fillStyle = STICKY_COLOR_VALUES[el.props.color];
      g.fill();
      drawPlainText(g, richTextToPlainText(el.props.text), {
        x: PADDING,
        y: PADDING,
        maxWidth: Math.max(0, el.w - PADDING * 2),
        fontSize: 20,
        color: COLOR_VALUES.black,
        align: 'start',
      });
    },
  },
  a11y: (el, _data, ctx) => {
    const color = localize(STICKY_COLOR_NAMES[el.props.color], ctx.locale);
    const kind = localize({ id: `Sticky ${color}`, en: `${color} sticky` }, ctx.locale);
    return { role: 'note', label: a11yLabel(kind, richTextToPlainText(el.props.text)) };
  },
  export: { text: (el) => richTextToPlainText(el.props.text) },
});
