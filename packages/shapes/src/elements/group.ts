/**
 * Group element container (BOARD-1104).
 *
 * @packageDocumentation
 */

import { defineElement, object, rect } from '@kujam/core';

/**
 * Props schema for the group element.
 *
 * @public
 */
export const groupPropsSchema = object({});

/**
 * Props of the group element.
 *
 * @public
 */
export type GroupProps = Record<string, never>;

/**
 * Group container element definition (BOARD-1104).
 *
 * Groups have empty props and compute their bounds from children.
 * A group renders no canvas graphics of its own; its children render themselves.
 *
 * @public
 */
export const groupElement = defineElement({
  type: 'group',
  version: 1,
  props: groupPropsSchema,
  defaults: {},
  resize: 'free',
  minSize: { w: 1, h: 1 },
  geometry: (el) => rect(el.w, el.h),
  render: {
    canvas: () => {},
  },
  a11y: (_el, _data, ctx) => ({
    role: 'group',
    label: ctx.locale === 'en' ? 'Group' : 'Grup',
  }),
  export: {
    text: () => '',
  },
});
