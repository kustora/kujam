import { array, defineElement, enumOf, number, polyline, schema, string } from '@kujam/core';
import { COLOR_KEYS, COLOR_VALUES } from '../colors.js';
import { localize } from '../i18n.js';

/**
 * Batas titik per coretan; goresan yang lebih panjang dipecah (BOARD-1002).
 *
 * @beta
 */
export const MAX_DRAW_POINTS = 5000;

/**
 * Elemen coretan bebas (BOARD-1002). Titik `[x, y, tekanan]` dalam koordinat lokal elemen.
 *
 * @beta
 */
export const drawElement = defineElement({
  type: 'draw',
  version: 1,
  props: schema({
    // Skema ADR-007 belum punya tuple; `[x, y]` atau `[x, y, tekanan]` dibatasi panjang 3.
    points: array(array(number(), { maxLength: 3 }), { maxLength: MAX_DRAW_POINTS }),
    color: enumOf(COLOR_KEYS),
    thickness: number({ min: 0.5, max: 64 }),
    /** ID kuas (BOARD-603); kuas tidak dikenal digambar dengan pena bawaan. */
    brush: string({ minLength: 1, maxLength: 64 }),
  }),
  defaults: { points: [], color: 'black', thickness: 4, brush: 'pen' },
  geometry: (el) =>
    polyline(
      el.props.points.map(([x = 0, y = 0]) => ({ x, y })),
      el.props.thickness,
    ),
  // TODO(BOARD-1002, BOARD-406): resize perlu menskalakan titik atau menyimpan skala.
  resize: 'free',
  render: {
    // TODO(BOARD-1002, BOARD-603): goresan perfect-freehand dengan tekanan dan kuas.
    canvas: (g, el) => {
      const points = el.props.points;
      if (points.length === 0) return;
      g.beginPath();
      points.forEach(([x = 0, y = 0], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      if (points.length === 1) g.lineTo(points[0]![0] ?? 0, points[0]![1] ?? 0);
      g.strokeStyle = COLOR_VALUES[el.props.color];
      g.lineWidth = el.props.thickness;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      if (el.props.brush === 'highlighter') g.globalCompositeOperation = 'multiply';
      g.stroke();
    },
  },
  a11y: (_el, _data, ctx) => ({
    role: 'img',
    label: localize({ id: 'Coretan', en: 'Drawing' }, ctx.locale),
  }),
  export: { text: () => '' },
});
