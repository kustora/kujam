/**
 * Frame element container and presentation slide boundary (BOARD-1105).
 *
 * @packageDocumentation
 */

import {
  boolean,
  defineElement,
  enumOf,
  rect,
  schema,
  string,
  type ElementAction,
} from '@kujam/core';
import { traceRoundedRect } from '../canvas.js';
import { STICKY_COLORS, STICKY_COLOR_VALUES, type StickyColor } from '../colors.js';

/**
 * Valid fill modes for a frame element (BOARD-1105).
 *
 * @public
 */
export const FRAME_FILLS = ['surface', 'none', ...STICKY_COLORS] as const;

/**
 * Fill type of a frame element.
 *
 * @public
 */
export type FrameFill = (typeof FRAME_FILLS)[number];

/**
 * Properties of a frame element record.
 *
 * @public
 */
export interface FrameProps {
  /** Name of the frame, displayed above the frame header. */
  name: string;
  /** Background fill style. */
  fill: FrameFill;
  /** Whether child elements are clipped to the frame bounds. Defaults to `true`. */
  clip: boolean;
}

/**
 * Default dimensions of a new frame in board units (800 × 600).
 *
 * @public
 */
export const DEFAULT_FRAME_SIZE = Object.freeze({ w: 800, h: 600 });

/**
 * Schema for frame element properties.
 *
 * @public
 */
export const framePropsSchema = schema({
  name: string({ maxLength: 256 }),
  fill: enumOf(FRAME_FILLS),
  clip: boolean(),
});

function resolveFillColor(
  fill: FrameFill,
  theme?: { mode?: 'light' | 'dark'; sticky?: Record<string, string> },
): string | null {
  if (fill === 'none') return null;
  if (fill === 'surface') {
    return theme?.mode === 'dark' ? '#1A1C21' : '#FFFFFF';
  }
  return theme?.sticky?.[fill] ?? STICKY_COLOR_VALUES[fill as StickyColor] ?? '#FFFFFF';
}

/**
 * Frame container element definition (BOARD-1105).
 *
 * Frames group and clip content, act as slide presentation landmarks, and display
 * an editable header title readable across all zoom levels.
 *
 * @public
 */
export const frameElement = defineElement({
  type: 'frame',
  version: 1,
  props: framePropsSchema,
  defaults: {
    name: 'Frame',
    fill: 'surface',
    clip: true,
  },
  geometry: (el) => rect(el.w, el.h),
  resize: 'free',
  minSize: { w: 100, h: 100 },
  onDoubleClick: (el, ctx) => {
    ctx.emit('edit', { id: el.id });
  },
  render: {
    canvas: (g, el, _data, lod, ctx) => {
      const zoom = Math.max(0.01, lod.zoom);
      const bg = resolveFillColor(el.props.fill, ctx?.theme);

      // Frame background and subtle border
      if (typeof (g as unknown as { roundRect?: unknown }).roundRect === 'function') {
        g.beginPath();
        (
          g as unknown as {
            roundRect: (x: number, y: number, w: number, h: number, r: number) => void;
          }
        ).roundRect(0, 0, el.w, el.h, 6);
      } else if (typeof g.moveTo === 'function') {
        traceRoundedRect(g, el.w, el.h, 6);
      } else {
        g.beginPath();
        g.rect(0, 0, el.w, el.h);
      }

      if (bg !== null) {
        g.fillStyle = bg;
        g.fill();
      }

      // Border: 1 screen-pixel thick
      g.lineWidth = 1 / zoom;
      g.strokeStyle = ctx?.theme?.mode === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';
      g.stroke();

      // Frame title label above the frame (readable across all zoom levels)
      const title = el.props.name || 'Frame';
      // Inversely scale font size so it remains clear and readable even at low zoom
      const effectiveZoom = Math.max(0.15, Math.min(2, zoom));
      const fontSize = Math.min(32, Math.max(11, 13 / effectiveZoom));

      g.save();
      g.font = `600 ${fontSize}px ${ctx?.theme?.typography?.fontFamily ?? 'Inter, sans-serif'}`;
      g.textBaseline = 'bottom';
      g.fillStyle = ctx?.theme?.mode === 'dark' ? '#94A3B8' : '#64748B';
      g.fillText(title, 2, -6 / zoom);
      g.restore();
    },
  },
  a11y: (el, _data, ctx) => ({
    role: 'region',
    label: el.props.name || (ctx.locale === 'en' ? 'Frame' : 'Frame'),
  }),
  actions: (el, _data, ctx) => {
    const actions: (ElementAction & { checked?: boolean })[] = [];
    const isEn = ctx.locale === 'en';

    // Toggle clip action
    actions.push({
      id: 'frame.clip',
      group: 'frame.clip',
      label: isEn ? 'Clip content' : 'Potong konten',
      icon: 'clip',
      isActive: () => el.props.clip,
      checked: el.props.clip,
      run: (boardArg?: unknown) => {
        if (typeof ctx.updateProps === 'function') {
          ctx.updateProps({ clip: !el.props.clip });
        } else if (
          boardArg &&
          typeof (boardArg as { update: (id: string, patch: unknown) => void }).update ===
            'function'
        ) {
          (boardArg as { update: (id: string, patch: unknown) => void }).update(el.id, {
            props: { ...el.props, clip: !el.props.clip },
          });
        }
      },
    });

    return actions;
  },
  export: {
    text: (el) => el.props.name,
  },
});
