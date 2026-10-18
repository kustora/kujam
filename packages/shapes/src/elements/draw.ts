import {
  array,
  defineElement,
  enumOf,
  number,
  path,
  schema,
  string,
  type ElementContext,
} from '@kujam/core';
import { getStroke } from 'perfect-freehand';
import { builtInBrush } from '../brushes.js';
import { COLOR_KEYS, COLOR_VALUES } from '../colors.js';
import { localize } from '../i18n.js';
import { drawActions } from '../styles.js';
import { StrokePathCache } from './stroke-cache.js';
import { getStrokeOptions } from './stroke-utils.js';

/**
 * Points per stroke limit; longer strokes are split (BOARD-1002).
 *
 * @beta
 */
export const MAX_DRAW_POINTS = 5000;

/** One `Path2D` cache per board, so element IDs from different boards never collide (BOARD-807). */
const pathCaches = new WeakMap<ElementContext, StrokePathCache>();
const sharedPathCache = new StrokePathCache();

function pathCacheFor(ctx: ElementContext | undefined): StrokePathCache {
  if (!ctx) return sharedPathCache;
  let cache = pathCaches.get(ctx);
  if (!cache) {
    cache = new StrokePathCache();
    pathCaches.set(ctx, cache);
  }
  return cache;
}

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
    canvas: (g, el, _data, lod, ctx) => {
      if (!el.props.points.some((p) => p.length >= 2)) return;
      const brush = ctx ? ctx.resolveBrush(el.props.brush) : builtInBrush(el.props.brush);
      g.fillStyle = ctx?.theme?.colors[el.props.color] ?? COLOR_VALUES[el.props.color] ?? el.props.color;
      g.globalCompositeOperation = brush.blend;
      // The outline depends only on the points, thickness, and brush; color and blend are set per draw.
      const deps = [el.props.points, el.props.thickness, brush];
      pathCacheFor(ctx).fill(g, el.id, deps, lod?.zoom ?? 1, () => {
        const points = el.props.points.filter((p) => p.length >= 2);
        return getStroke(points as number[][], getStrokeOptions(el.props.thickness, brush, true));
      });
    },
  },
  a11y: (_el, _data, ctx) => ({
    role: 'img',
    label: localize({ id: 'Coretan', en: 'Drawing' }, ctx.locale),
  }),
  actions: (el, _data, ctx) => drawActions(el, ctx),
  export: { text: () => '' },
});
