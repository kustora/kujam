import { array, defineElement, enumOf, number, path, schema, string } from '@kujam/core';
import { getStroke } from 'perfect-freehand';
import { builtInBrush } from '../brushes.js';
import { COLOR_KEYS, COLOR_VALUES } from '../colors.js';
import { localize } from '../i18n.js';
import { getStrokeOptions, renderStrokeOutline } from './stroke-utils.js';

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
    /**
     * Brush ID (BOARD-603), stored as-is even when the brush is not registered; unknown brushes
     * are drawn with the default pen.
     */
    brush: string({ minLength: 1, maxLength: 64 }),
  }),
  defaults: { points: [], color: 'black', thickness: 4, brush: 'pen' },
  geometry: (el) => path(el.props.points, el.props.thickness),
  // TODO(BOARD-1002, BOARD-406): resize needs to scale the points or store a scale.
  resize: 'free',
  render: {
    canvas: (g, el, _data, _lod, ctx) => {
      const points = el.props.points.filter((p) => p.length >= 2);
      if (points.length === 0) return;
      const brush = ctx ? ctx.resolveBrush(el.props.brush) : builtInBrush(el.props.brush);
      g.fillStyle = ctx?.theme?.colors[el.props.color] ?? COLOR_VALUES[el.props.color] ?? el.props.color;
      g.globalCompositeOperation = brush.blend;
      const strokeOptions = getStrokeOptions(el.props.thickness, brush, true);
      const outline = getStroke(points as number[][], strokeOptions);
      renderStrokeOutline(g, outline);
    },
  },
  a11y: (_el, _data, ctx) => ({
    role: 'img',
    label: localize({ id: 'Coretan', en: 'Drawing' }, ctx.locale),
  }),
  export: { text: () => '' },
});
