import { defineElement, enumOf, nullable, rect, schema, string } from '@kujam/core';
import { drawRichText, layoutStickyText } from '../canvas.js';
import {
  STICKY_COLOR_NAMES,
  STICKY_COLOR_VALUES,
  STICKY_COLORS,
  STICKY_TEXT_COLOR,
} from '../colors.js';
import { a11yLabel, localize } from '../i18n.js';
import { stickyActions } from '../styles.js';
import { EMPTY_RICH_TEXT, isRichTextEmpty, richTextSchema, richTextToPlainText } from '../richtext.js';

const PADDING = 16;

/**
 * Sticky note element (BOARD-1001): rich text, color from the sticky palette, and author.
 * Uses 0 border radius (sharp rectangle) per DESIGN.md.
 *
 * @beta
 */
export const stickyElement = defineElement({
  type: 'sticky',
  version: 1,
  props: schema({
    text: richTextSchema,
    color: enumOf(STICKY_COLORS),
    /** Author ID from the consumer application, or `null`. */
    authorId: nullable(string({ maxLength: 256 })),
  }),
  defaults: { text: EMPTY_RICH_TEXT, color: 'yellow', authorId: null },
  geometry: (el) => rect(el.w, el.h),
  resize: 'fixed-ratio',
  onDoubleClick: (el, ctx) => {
    ctx.emit('edit', { id: el.id });
  },
  render: {
    canvas: (g, el, _data, lod, ctx) => {
      // Sticky notes have sharp corners (radius 0) per DESIGN.md
      g.beginPath();
      g.rect(0, 0, el.w, el.h);
      g.fillStyle = ctx?.theme?.sticky[el.props.color] ?? STICKY_COLOR_VALUES[el.props.color];
      g.fill();

      if (!lod.editingText && !isRichTextEmpty(el.props.text)) {
        const layout = layoutStickyText(el.props.text, {
          boxW: el.w,
          boxH: el.h,
          padding: PADDING,
          fontFamily: ctx?.theme?.typography.fontFamily,
        });

        drawRichText(g, layout, {
          x: PADDING,
          y: PADDING,
          color: ctx?.theme?.stickyText ?? STICKY_TEXT_COLOR,
          fontFamily: ctx?.theme?.typography.fontFamily,
        });
      }
    },
  },
  a11y: (el, _data, ctx) => {
    const color = localize(STICKY_COLOR_NAMES[el.props.color], ctx.locale);
    const kind = localize({ id: `Sticky ${color}`, en: `${color} sticky` }, ctx.locale);
    return { role: 'note', label: a11yLabel(kind, richTextToPlainText(el.props.text)) };
  },
  actions: (el, _data, ctx) => stickyActions(el, ctx),
  export: { text: (el) => richTextToPlainText(el.props.text) },
});
