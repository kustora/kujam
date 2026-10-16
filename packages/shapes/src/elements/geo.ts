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
import { drawPlainText, traceGeometry, traceRoundedRect } from '../canvas.js';
import { COLOR_KEYS, COLOR_VALUES } from '../colors.js';
import { a11yLabel, localize, type Bilingual } from '../i18n.js';
import { EMPTY_RICH_TEXT, richTextSchema, richTextToPlainText } from '../richtext.js';

/**
 * Bentuk shape geometri bawaan (daftar final disepakati saat grooming BOARD-1004).
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
 * Bentuk shape geometri.
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

/**
 * Geometri lokal untuk satu bentuk dan ukuran.
 *
 * @beta
 */
export function geoGeometry(kind: GeoKind, w: number, h: number): Geometry {
  switch (kind) {
    case 'rectangle':
    case 'rounded-rectangle':
      return rect(w, h);
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
 * Elemen shape geometri (BOARD-1004): bentuk, isi, garis, dan teks di tengah.
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
    label: richTextSchema,
  }),
  defaults: {
    geo: 'rectangle',
    fill: 'none',
    fillColor: 'white',
    strokeColor: 'black',
    strokeWidth: 2,
    dash: 'solid',
    label: EMPTY_RICH_TEXT,
  },
  geometry: (el) => geoGeometry(el.props.geo, el.w, el.h),
  // Shift mengunci rasio di transformasi BOARD-406.
  resize: 'free',
  render: {
    // TODO(BOARD-1004): label rich text di tengah dengan wrap; hit-test mengikuti bentuk (BOARD-403).
    canvas: (g, el) => {
      const { props } = el;
      if (props.geo === 'rounded-rectangle')
        traceRoundedRect(g, el.w, el.h, Math.min(el.w, el.h) * 0.15);
      else traceGeometry(g, geoGeometry(props.geo, el.w, el.h));
      if (props.fill !== 'none') {
        g.save();
        g.fillStyle = COLOR_VALUES[props.fillColor];
        if (props.fill === 'semi') g.globalAlpha *= 0.5;
        g.fill();
        g.restore();
      }
      if (props.strokeWidth > 0) {
        g.strokeStyle = COLOR_VALUES[props.strokeColor];
        g.lineWidth = props.strokeWidth;
        g.setLineDash(DASHES[props.dash].map((d) => d * props.strokeWidth));
        g.stroke();
        g.setLineDash([]);
      }
      const label = richTextToPlainText(props.label);
      const fontSize = 20;
      const lines = label ? label.split('\n').length : 0;
      drawPlainText(g, label, {
        x: 0,
        y: (el.h - lines * fontSize * 1.3) / 2,
        maxWidth: el.w,
        fontSize,
        color: COLOR_VALUES.black,
        align: 'center',
      });
    },
  },
  a11y: (el, _data, ctx) => ({
    role: 'img',
    label: a11yLabel(
      localize(GEO_NAMES[el.props.geo], ctx.locale),
      richTextToPlainText(el.props.label),
    ),
  }),
  export: { text: (el) => richTextToPlainText(el.props.label) },
});
