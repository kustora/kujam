import {
  defineElement,
  ellipse,
  enumOf,
  number,
  polygon,
  rect,
  schema,
  type Geometry,
  type Point,
} from '@kujam/core';
import { drawRichText, layoutRichText, traceGeometry, traceRoundedRect } from '../canvas.js';
import { COLOR_KEYS, COLOR_VALUES } from '../colors.js';
import { a11yLabel, localize, type Bilingual } from '../i18n.js';
import { geoActions } from '../styles.js';
import { EMPTY_RICH_TEXT, isRichTextEmpty, richTextSchema, richTextToPlainText } from '../richtext.js';

/**
 * Built-in geometric shape kinds (final list agreed during BOARD-1004 grooming).
 *
 * @beta
 */
export const GEO_KINDS = [
  'rectangle',
  'rounded-rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'parallelogram',
  'star',
  'arrow',
] as const;

/**
 * Geometric shape kind.
 *
 * @beta
 */
export type GeoKind = (typeof GEO_KINDS)[number];

const GEO_NAMES: Readonly<Record<GeoKind, Bilingual>> = {
  rectangle: { id: 'Kotak', en: 'Rectangle' },
  'rounded-rectangle': { id: 'Kotak sudut bulat', en: 'Rounded rectangle' },
  ellipse: { id: 'Elips', en: 'Ellipse' },
  diamond: { id: 'Belah ketupat', en: 'Diamond' },
  triangle: { id: 'Segitiga', en: 'Triangle' },
  parallelogram: { id: 'Jajaran genjang', en: 'Parallelogram' },
  star: { id: 'Bintang', en: 'Star' },
  arrow: { id: 'Panah', en: 'Arrow' },
};

function starPoints(w: number, h: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const scale = i % 2 === 0 ? 1 : 0.4;
    points.push({
      x: w / 2 + (w / 2) * scale * Math.cos(angle),
      y: h / 2 + (h / 2) * scale * Math.sin(angle),
    });
  }
  return points;
}

function roundedRectPoints(w: number, h: number, radius: number): Point[] {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
  if (r === 0) {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
  const points: Point[] = [];
  const corners = [
    { cx: w - r, cy: r, start: -Math.PI / 2, end: 0 },
    { cx: w - r, cy: h - r, start: 0, end: Math.PI / 2 },
    { cx: r, cy: h - r, start: Math.PI / 2, end: Math.PI },
    { cx: r, cy: r, start: Math.PI, end: (3 * Math.PI) / 2 },
  ];
  const stepsPerCorner = 4;
  for (const corner of corners) {
    for (let i = 0; i <= stepsPerCorner; i++) {
      const theta = corner.start + ((corner.end - corner.start) * i) / stepsPerCorner;
      points.push({
        x: Math.round((corner.cx + r * Math.cos(theta)) * 1000) / 1000,
        y: Math.round((corner.cy + r * Math.sin(theta)) * 1000) / 1000,
      });
    }
  }
  return points;
}

/**
 * Local geometry for one shape kind and size.
 *
 * @beta
 */
export function geoGeometry(kind: GeoKind, w: number, h: number): Geometry {
  switch (kind) {
    case 'rectangle':
      return rect(w, h);
    case 'rounded-rectangle':
      return polygon(roundedRectPoints(w, h, Math.min(w, h) * 0.15));
    case 'ellipse':
      return ellipse(w, h);
    case 'diamond':
      return polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ]);
    case 'triangle':
      return polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]);
    case 'parallelogram': {
      const skew = w * 0.2;
      return polygon([
        { x: skew, y: 0 },
        { x: w, y: 0 },
        { x: w - skew, y: h },
        { x: 0, y: h },
      ]);
    }
    case 'star':
      return polygon(starPoints(w, h));
    case 'arrow': {
      const head = Math.min(w * 0.4, h);
      return polygon([
        { x: 0, y: h * 0.25 },
        { x: w - head, y: h * 0.25 },
        { x: w - head, y: 0 },
        { x: w, y: h / 2 },
        { x: w - head, y: h },
        { x: w - head, y: h * 0.75 },
        { x: 0, y: h * 0.75 },
      ]);
    }
  }
}

const DASHES: Readonly<Record<'solid' | 'dashed' | 'dotted', readonly number[]>> = {
  solid: [],
  dashed: [4, 4],
  dotted: [1, 3],
};

/**
 * Geometric shape element (BOARD-1004): shape kind, fill, stroke, and centered text.
 *
 * @beta
 */
export const geoElement = defineElement({
  type: 'geo',
  version: 1,
  props: schema({
    geo: enumOf(GEO_KINDS),
    fill: enumOf(['none', 'semi', 'solid']),
    fillColor: enumOf(COLOR_KEYS),
    strokeColor: enumOf(COLOR_KEYS),
    strokeWidth: number({ min: 0, max: 32 }),
    dash: enumOf(['solid', 'dashed', 'dotted']),
    textColor: enumOf(COLOR_KEYS),
    label: richTextSchema,
  }),
  defaults: {
    geo: 'rectangle',
    fill: 'none',
    fillColor: 'white',
    strokeColor: 'black',
    strokeWidth: 2,
    dash: 'solid',
    textColor: 'black',
    label: EMPTY_RICH_TEXT,
  },
  geometry: (el) => geoGeometry(el.props.geo, el.w, el.h),
  // Quick-connect handles on each side while selected alone.
  connectable: true,
  // Shift locks the aspect ratio in the BOARD-406 transform.
  resize: 'free',
  onDoubleClick: (el, ctx) => {
    ctx.emit('edit', { id: el.id });
  },
  render: {
    canvas: (g, el, _data, lod, ctx) => {
      const { props } = el;
      if (props.geo === 'rounded-rectangle')
        traceRoundedRect(g, el.w, el.h, Math.min(el.w, el.h) * 0.15);
      else traceGeometry(g, geoGeometry(props.geo, el.w, el.h));
      if (props.fill !== 'none') {
        g.save();
        g.fillStyle = ctx?.theme?.colors[props.fillColor] ?? COLOR_VALUES[props.fillColor];
        if (props.fill === 'semi') g.globalAlpha *= 0.5;
        g.fill();
        g.restore();
      }
      if (props.strokeWidth > 0) {
        g.strokeStyle = ctx?.theme?.colors[props.strokeColor] ?? COLOR_VALUES[props.strokeColor];
        g.lineWidth = props.strokeWidth;
        g.setLineDash(DASHES[props.dash].map((d) => d * props.strokeWidth));
        g.stroke();
        g.setLineDash([]);
      }
      if (!lod.editingText && !isRichTextEmpty(props.label)) {
        const padX = Math.min(16, Math.max(4, el.w * 0.1));
        const padY = Math.min(16, Math.max(4, el.h * 0.1));
        const wrapWidth = Math.max(0, el.w - padX * 2);
        const layout = layoutRichText(props.label, {
          maxWidth: wrapWidth,
          align: 'center',
          fontSize: 16,
          fontFamily: ctx?.theme?.typography.fontFamily,
        });
        const textY = Math.max(padY, (el.h - layout.height) / 2);
        drawRichText(g, layout, {
          x: padX,
          y: textY,
          color:
            ctx?.theme?.colors[props.textColor] ??
            COLOR_VALUES[props.textColor] ??
            ctx?.theme?.colors.black ??
            COLOR_VALUES.black,
          fontFamily: ctx?.theme?.typography.fontFamily,
        });
      }
    },
  },
  a11y: (el, _data, ctx) => ({
    role: 'img',
    label: a11yLabel(
      localize(GEO_NAMES[el.props.geo], ctx.locale),
      richTextToPlainText(el.props.label),
    ),
  }),
  actions: (el, _data, ctx) => geoActions(el, ctx),
  export: { text: (el) => richTextToPlainText(el.props.label) },
});
