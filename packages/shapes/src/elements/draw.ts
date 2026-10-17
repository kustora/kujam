import { array, defineElement, enumOf, number, path, schema, string } from '@kujam/core';
import { COLOR_KEYS, COLOR_VALUES } from '../colors.js';
import { localize } from '../i18n.js';

/**
 * Points per stroke limit; longer strokes are split (BOARD-1002).
 *
 * @beta
 */
export const MAX_DRAW_POINTS = 5000;

/**
 * Freehand stroke element (BOARD-1002). Points `[x, y, pressure]` in element-local coordinates.
 *
 * @beta
 */
export const drawElement = defineElement({
  type: 'draw',
  version: 1,
  props: schema({
    // ADR-007 schemas have no tuples yet; `[x, y]` or `[x, y, pressure]` is limited to length 3.
    points: array(array(number(), { maxLength: 3 }), { maxLength: MAX_DRAW_POINTS }),
    color: enumOf(COLOR_KEYS),
    thickness: number({ min: 0.5, max: 64 }),
    /** Brush ID (BOARD-603); unknown brushes are drawn with the default pen. */
    brush: string({ minLength: 1, maxLength: 64 }),
  }),
  defaults: { points: [], color: 'black', thickness: 4, brush: 'pen' },
  geometry: (el) => path(el.props.points, el.props.thickness),
  // TODO(BOARD-1002, BOARD-406): resize needs to scale the points or store a scale.
  resize: 'free',
  render: {
    // TODO(BOARD-1002, BOARD-603): perfect-freehand strokes with pressure and brushes.
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
