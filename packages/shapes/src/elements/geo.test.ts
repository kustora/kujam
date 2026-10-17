import {
  containsPoint,
  createBoard,
  resizeElements,
  type ElementCanvasContext,
  type ElementRecord,
} from '@kujam/core';
import { describe, expect, it, vi } from 'vitest';
import {
  COLOR_VALUES,
  GEO_KINDS,
  geoElement,
  geoGeometry,
  type GeoKind,
} from '../index.js';
import { normalizeRichText } from '../richtext.js';

function createGeo(
  kind: GeoKind,
  w = 100,
  h = 100,
  props: Record<string, unknown> = {},
): ElementRecord {
  return {
    id: 'geo-1',
    kind: 'element',
    type: 'geo',
    pageId: 'page-1',
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    rotation: 0,
    w,
    h,
    locked: false,
    opacity: 1,
    props: {
      ...geoElement.defaults,
      geo: kind,
      ...props,
    },
    meta: {},
  };
}

function mockCanvas(): { g: ElementCanvasContext; calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const g = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
      return (...args: unknown[]) => calls.push(`${key}(${args.join(',')})`);
    },
    set(target, key: string, value) {
      target[key] = value;
      calls.push(`${key}=${Array.isArray(value) ? `[${value}]` : value}`);
      return true;
    },
  }) as unknown as ElementCanvasContext;
  return { g, calls };
}

describe('BOARD-1004: Geometric Shape Elements', () => {
  describe('8 Shape Geometries and Accurate Hit-Testing', () => {
    it.each(GEO_KINDS)('%s returns valid geometry', (kind) => {
      const g = geoGeometry(kind, 120, 80);
      expect(g).toBeDefined();
      if (g.kind === 'polygon') {
        expect(g.points.length).toBeGreaterThanOrEqual(3);
        for (const p of g.points) {
          expect(p.x).toBeGreaterThanOrEqual(-1e-6);
          expect(p.x).toBeLessThanOrEqual(120 + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(-1e-6);
          expect(p.y).toBeLessThanOrEqual(80 + 1e-6);
        }
      }
    });

    it('triangle: accurately tests inside and outside points', () => {
      const el = createGeo('triangle', 100, 100);
      const geom = geoElement.geometry!(el);
      // Center and lower area are inside
      expect(containsPoint(geom, { x: 50, y: 50 }, el)).toBe(true);
      expect(containsPoint(geom, { x: 50, y: 90 }, el)).toBe(true);
      // Top-left and top-right corners of bounding box are outside the triangle
      expect(containsPoint(geom, { x: 5, y: 5 }, el)).toBe(false);
      expect(containsPoint(geom, { x: 95, y: 5 }, el)).toBe(false);
    });

    it('diamond: accurately tests inside and outside points', () => {
      const el = createGeo('diamond', 100, 100);
      const geom = geoElement.geometry!(el);
      // Center is inside
      expect(containsPoint(geom, { x: 50, y: 50 }, el)).toBe(true);
      // 4 corners of bounding box are outside diamond
      expect(containsPoint(geom, { x: 5, y: 5 }, el)).toBe(false);
      expect(containsPoint(geom, { x: 95, y: 5 }, el)).toBe(false);
      expect(containsPoint(geom, { x: 95, y: 95 }, el)).toBe(false);
      expect(containsPoint(geom, { x: 5, y: 95 }, el)).toBe(false);
    });

    it('ellipse: accurately tests inside and outside points', () => {
      const el = createGeo('ellipse', 100, 100);
      const geom = geoElement.geometry!(el);
      expect(containsPoint(geom, { x: 50, y: 50 }, el)).toBe(true);
      expect(containsPoint(geom, { x: 5, y: 5 }, el)).toBe(false);
      expect(containsPoint(geom, { x: 95, y: 95 }, el)).toBe(false);
    });

    it('rounded-rectangle: clipped corners are outside the shape', () => {
      const el = createGeo('rounded-rectangle', 100, 100);
      const geom = geoElement.geometry!(el);
      // Center and inner area are inside
      expect(containsPoint(geom, { x: 50, y: 50 }, el)).toBe(true);
      expect(containsPoint(geom, { x: 20, y: 20 }, el)).toBe(true);
      // Extreme corner (2, 2) is clipped by 15px radius and is outside
      expect(containsPoint(geom, { x: 2, y: 2 }, el)).toBe(false);
      expect(containsPoint(geom, { x: 98, y: 2 }, el)).toBe(false);
    });

    it('parallelogram: respects skew in hit-testing', () => {
      const el = createGeo('parallelogram', 100, 100);
      const geom = geoElement.geometry!(el);
      expect(containsPoint(geom, { x: 50, y: 50 }, el)).toBe(true);
      // Top-left corner (0, 0) is outside because of skew (skew = 20)
      expect(containsPoint(geom, { x: 5, y: 5 }, el)).toBe(false);
      // Bottom-right corner (100, 100) is outside because right edge ends at w - skew = 80
      expect(containsPoint(geom, { x: 95, y: 95 }, el)).toBe(false);
    });

    it('arrow: shaft and arrowhead are inside, surrounding bounding box is outside', () => {
      const el = createGeo('arrow', 100, 100);
      const geom = geoElement.geometry!(el);
      // Inside the shaft
      expect(containsPoint(geom, { x: 30, y: 50 }, el)).toBe(true);
      // Inside the head
      expect(containsPoint(geom, { x: 80, y: 50 }, el)).toBe(true);
      // Above shaft
      expect(containsPoint(geom, { x: 10, y: 10 }, el)).toBe(false);
      // Below shaft
      expect(containsPoint(geom, { x: 10, y: 90 }, el)).toBe(false);
      // Above arrowhead top
      expect(containsPoint(geom, { x: 90, y: 10 }, el)).toBe(false);
    });

    it('star: center and tips are inside, outer valleys are outside', () => {
      const el = createGeo('star', 100, 100);
      const geom = geoElement.geometry!(el);
      expect(containsPoint(geom, { x: 50, y: 50 }, el)).toBe(true);
      // Top tip (50, 0)
      expect(containsPoint(geom, { x: 50, y: 5 }, el)).toBe(true);
      // Empty valley regions
      expect(containsPoint(geom, { x: 10, y: 10 }, el)).toBe(false);
      expect(containsPoint(geom, { x: 90, y: 10 }, el)).toBe(false);
    });
  });

  describe('Props and Canvas Rendering', () => {
    it('renders fill modes: none, semi, solid', () => {
      const { g: gNone, calls: callsNone } = mockCanvas();
      const elNone = createGeo('rectangle', 100, 100, { fill: 'none' });
      geoElement.render!.canvas!(gNone, elNone, undefined, { zoom: 1, compact: false });
      expect(callsNone).not.toContain('fill()');

      const { g: gSemi, calls: callsSemi } = mockCanvas();
      const elSemi = createGeo('rectangle', 100, 100, { fill: 'semi', fillColor: 'yellow' });
      geoElement.render!.canvas!(gSemi, elSemi, undefined, { zoom: 1, compact: false });
      expect(callsSemi).toContain('fillStyle=#FBE7A1');
      expect(callsSemi).toContain('globalAlpha=0.5');
      expect(callsSemi).toContain('fill()');

      const { g: gSolid, calls: callsSolid } = mockCanvas();
      const elSolid = createGeo('rectangle', 100, 100, { fill: 'solid', fillColor: 'green' });
      geoElement.render!.canvas!(gSolid, elSolid, undefined, { zoom: 1, compact: false });
      expect(callsSolid).toContain(`fillStyle=${COLOR_VALUES.green}`);
      expect(callsSolid).not.toContain('globalAlpha=0.5');
      expect(callsSolid).toContain('fill()');
    });

    it('renders stroke dashed styles and line width', () => {
      const { g, calls } = mockCanvas();
      const el = createGeo('rectangle', 100, 100, {
        strokeWidth: 4,
        strokeColor: 'red',
        dash: 'dashed',
      });
      geoElement.render!.canvas!(g, el, undefined, { zoom: 1, compact: false });
      expect(calls).toContain('lineWidth=4');
      expect(calls).toContain(`strokeStyle=${COLOR_VALUES.red}`);
      expect(calls).toContain('setLineDash(16,16)');
      expect(calls).toContain('stroke()');
    });

    it('renders centered rich text label with wrapping', () => {
      const { g, calls } = mockCanvas();
      const el = createGeo('diamond', 200, 100, {
        label: normalizeRichText([
          { insert: 'Judul Utama\n', attributes: { bold: true } },
          { insert: 'Deskripsi pendek' },
        ]),
        textColor: 'blue',
      });
      geoElement.render!.canvas!(g, el, undefined, { zoom: 1, compact: false });

      const textCalls = calls.filter((c) => c.startsWith('fillText'));
      expect(textCalls.length).toBe(2);
      expect(calls).toContain(`fillStyle=${COLOR_VALUES.blue}`);
    });

    it('skips text rendering when label is empty', () => {
      const { g, calls } = mockCanvas();
      const el = createGeo('rectangle', 100, 100, {
        label: [{ insert: '   \n' }],
      });
      geoElement.render!.canvas!(g, el, undefined, { zoom: 1, compact: false });
      const textCalls = calls.filter((c) => c.startsWith('fillText'));
      expect(textCalls.length).toBe(0);
    });
  });

  describe('Double Click Action', () => {
    it('emits edit action on double click', () => {
      const emit = vi.fn();
      const el = createGeo('rectangle', 100, 100);
      geoElement.onDoubleClick!(el, {
        emit,
        locale: 'id',
        theme: undefined as never,
        resolveBrush: undefined as never,
      });
      expect(emit).toHaveBeenCalledWith('edit', { id: 'geo-1' });
    });
  });

  describe('Shift-Locked Aspect Ratio Resize', () => {
    it('locks 1:1 or initial aspect ratio when Shift is held during resize', () => {
      const board = createBoard();
      const el = createGeo('rectangle', 100, 50);

      // Without keepRatio: dragging se corner by (50, 20) produces w=150, h=70
      const [freeRes] = resizeElements([el], 'se', { x: 0, y: 0 }, { x: 50, y: 20 }, {
        keepRatio: false,
        registry: board.elements,
      });
      expect(freeRes.w).toBe(150);
      expect(freeRes.h).toBe(70);

      // With keepRatio (Shift pressed): locks ratio 100:50 = 2:1
      const [lockedRes] = resizeElements([el], 'se', { x: 0, y: 0 }, { x: 50, y: 20 }, {
        keepRatio: true,
        registry: board.elements,
      });
      expect(lockedRes.w / lockedRes.h).toBeCloseTo(2, 5);
    });
  });
});
