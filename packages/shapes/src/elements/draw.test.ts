import {
  containsPoint,
  createBoard,
  validate,
  type Board,
  type ElementCanvasContext,
  type ElementRecord,
} from '@kujam/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { COLOR_VALUES } from '../colors.js';
import { defaultElements } from '../index.js';
import { drawElement, MAX_DRAW_POINTS } from './draw.js';
import { drawTool } from '../tools/draw.js';

function fakeContext(): { g: ElementCanvasContext; calls: string[]; ops: Record<string, unknown> } {
  const calls: string[] = [];
  const ops: Record<string, unknown> = {};
  const g = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop in ops) return ops[prop];
        return (...args: unknown[]) => calls.push(`${prop}(${args.join(',')})`);
      },
      set(_target, prop: string, value: unknown) {
        ops[prop] = value;
        calls.push(`${prop}=${value}`);
        return true;
      },
    },
  ) as ElementCanvasContext;
  return { g, calls, ops };
}

describe('BOARD-1002: Elemen coretan bebas dengan perfect-freehand', () => {
  let board: Board;

  beforeEach(() => {
    board = createBoard({
      plugins: [
        defaultElements,
        {
          id: 'test-tools',
          tools: [drawTool],
        },
      ],
    });
  });

  describe('Props and Schema', () => {
    it('accepts points [x, y, pressure], color, thickness, and brush', () => {
      const validProps = {
        points: [
          [0, 0, 0.5],
          [10, 20, 0.8],
          [30, 40],
        ],
        color: 'red',
        thickness: 6,
        brush: 'highlighter',
      };
      const res = validate(drawElement.props, validProps);
      expect(res.ok).toBe(true);
    });

    it('rejects points with more than 3 coordinates', () => {
      const invalid = {
        points: [[0, 0, 0.5, 99]],
        color: 'black',
        thickness: 4,
        brush: 'pen',
      };
      expect(validate(drawElement.props, invalid).ok).toBe(false);
    });

    it('rejects points array exceeding MAX_DRAW_POINTS', () => {
      const tooMany = new Array(MAX_DRAW_POINTS + 1).fill([0, 0, 0.5]);
      const invalid = {
        points: tooMany,
        color: 'black',
        thickness: 4,
        brush: 'pen',
      };
      expect(validate(drawElement.props, invalid).ok).toBe(false);
    });
  });

  describe('Rendering with perfect-freehand and blend modes', () => {
    it('renders stroke polygon outline filled with element color and pen blend mode', () => {
      const el: ElementRecord = {
        id: 'stroke-1',
        kind: 'element',
        type: 'draw',
        pageId: board.pages.current,
        parentId: null,
        index: 'a0',
        x: 0,
        y: 0,
        w: 50,
        h: 50,
        rotation: 0,
        locked: false,
        opacity: 1,
        props: {
          points: [
            [0, 0, 0.5],
            [25, 25, 0.7],
            [50, 50, 0.9],
          ],
          color: 'blue',
          thickness: 4,
          brush: 'pen',
        },
        typeVersion: 1,
        meta: {},
      };

      const { g, calls, ops } = fakeContext();
      drawElement.render.canvas(g, el, undefined, { zoom: 1, compact: false }, board.elementContext);

      expect(ops.fillStyle).toBe(COLOR_VALUES.blue);
      expect(ops.globalCompositeOperation).toBe('source-over');
      expect(calls).toContain('beginPath()');
      expect(calls).toContain('fill()');
    });

    it('highlighter mode uses composite blend multiply', () => {
      const el: ElementRecord = {
        id: 'stroke-hl',
        kind: 'element',
        type: 'draw',
        pageId: board.pages.current,
        parentId: null,
        index: 'a0',
        x: 0,
        y: 0,
        w: 100,
        h: 20,
        rotation: 0,
        locked: false,
        opacity: 1,
        props: {
          points: [
            [0, 10, 0.5],
            [100, 10, 0.5],
          ],
          color: 'yellow',
          thickness: 16,
          brush: 'highlighter',
        },
        typeVersion: 1,
        meta: {},
      };

      const { g, ops } = fakeContext();
      drawElement.render.canvas(g, el, undefined, { zoom: 1, compact: false }, board.elementContext);

      expect(ops.fillStyle).toBe(COLOR_VALUES.yellow);
      expect(ops.globalCompositeOperation).toBe('multiply');
    });
  });

  describe('Accurate Curve Hit-Testing', () => {
    it('follows the actual stroke curve, not the bounding box', () => {
      // Create a diagonal stroke from (0,0) to (100, 100) placed at board coordinates (100, 100)
      const el: ElementRecord = {
        id: 'diag-stroke',
        kind: 'element',
        type: 'draw',
        pageId: board.pages.current,
        parentId: null,
        index: 'a0',
        x: 100,
        y: 100,
        w: 100,
        h: 100,
        rotation: 0,
        locked: false,
        opacity: 1,
        props: {
          points: [
            [0, 0, 0.5],
            [100, 100, 0.5],
          ],
          color: 'black',
          thickness: 4,
          brush: 'pen',
        },
        typeVersion: 1,
        meta: {},
      };

      board.create(el);
      const geom = drawElement.geometry(el);

      // Point (150, 150) is in local (50, 50), exactly on the diagonal line
      expect(containsPoint(geom, { x: 150, y: 150 }, { element: el, tolerance: 0 })).toBe(true);
      expect(board.hitTest({ x: 150, y: 150 })?.id).toBe('diag-stroke');

      // Point (100, 200) is inside the bounding box (bottom-left corner), but ~70 px from the diagonal line
      expect(containsPoint(geom, { x: 100, y: 200 }, { element: el, tolerance: 4 })).toBe(false);
      expect(board.hitTest({ x: 100, y: 200 })).toBeUndefined();

      // Point (200, 100) is inside the bounding box (top-right corner), but ~70 px from the diagonal line
      expect(containsPoint(geom, { x: 200, y: 100 }, { element: el, tolerance: 4 })).toBe(false);
      expect(board.hitTest({ x: 200, y: 100 })).toBeUndefined();

      // Point (150, 153) is within half-thickness (2) + tolerance (4) = 6 px
      expect(board.hitTest({ x: 150, y: 153 }, { tolerance: 4 })?.id).toBe('diag-stroke');

      // Point (150, 170) is 20 px away (distance ~ 14.14 px > 6 px)
      expect(board.hitTest({ x: 150, y: 170 }, { tolerance: 4 })).toBeUndefined();
    });
  });

  describe('Active stroke streaming in overlay vs final element', () => {
    it('streams active stroke without polluting document store, and finalizes on pointerUp', () => {
      board.setTool('draw');

      // Pointer down
      board.dispatch({
        type: 'pointer-down',
        pointerId: 1,
        pointerType: 'pen',
        point: { x: 10, y: 10 },
        screen: { x: 10, y: 10 },
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        button: 0,
        buttons: 1,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      });

      expect(board.toolState).toBe('drawing');
      // No elements committed to document yet
      expect(board.query()).toHaveLength(0);

      // Streamed active stroke exists on toolData
      const toolData1 = board.toolData as { activeStroke: { points: number[][] } };
      expect(toolData1.activeStroke).toBeDefined();
      expect(toolData1.activeStroke.points).toEqual([[10, 10, 0.5]]);

      // Pointer move
      board.dispatch({
        type: 'pointer-move',
        pointerId: 1,
        pointerType: 'pen',
        point: { x: 20, y: 30 },
        screen: { x: 20, y: 30 },
        pressure: 0.7,
        tiltX: 0,
        tiltY: 0,
        button: 0,
        buttons: 1,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      });

      // Still 0 elements in document store (overlay streaming!)
      expect(board.query()).toHaveLength(0);
      expect(toolData1.activeStroke.points).toEqual([
        [10, 10, 0.5],
        [20, 30, 0.7],
      ]);

      // Pointer up
      board.dispatch({
        type: 'pointer-up',
        pointerId: 1,
        pointerType: 'pen',
        point: { x: 30, y: 50 },
        screen: { x: 30, y: 50 },
        pressure: 0.9,
        tiltX: 0,
        tiltY: 0,
        button: 0,
        buttons: 0,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      });

      expect(board.toolState).toBe('idle');
      // Active stroke cleared
      const toolData2 = board.toolData as { activeStroke: unknown };
      expect(toolData2.activeStroke).toBeNull();

      // Now exactly 1 element in document store!
      const elements = board.query();
      expect(elements).toHaveLength(1);
      const created = elements[0]!;
      expect(created.type).toBe('draw');
      expect(created.x).toBe(10);
      expect(created.y).toBe(10);
      expect(created.w).toBe(20); // 30 - 10
      expect(created.h).toBe(40); // 50 - 10
      expect(created.props.points[0]).toEqual([0, 0, 0.5]);
      expect(created.props.points[created.props.points.length - 1]).toEqual([20, 40, 0.9]);
      expect(board.selection).toEqual([created.id]);
    });

    it('simplifies collinear points with RDP on completion', () => {
      board.setTool('draw');

      // Start at (100, 100)
      board.dispatch({
        type: 'pointer-down',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 100, y: 100 },
        screen: { x: 100, y: 100 },
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        button: 0,
        buttons: 1,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      });

      // 8 collinear points along horizontal line y = 100
      for (let x = 110; x <= 180; x += 10) {
        board.dispatch({
          type: 'pointer-move',
          pointerId: 1,
          pointerType: 'mouse',
          point: { x, y: 100 },
          screen: { x, y: 100 },
          pressure: 0.5,
          tiltX: 0,
          tiltY: 0,
          button: 0,
          buttons: 1,
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
        });
      }

      // Finish at (200, 100)
      board.dispatch({
        type: 'pointer-up',
        pointerId: 1,
        pointerType: 'mouse',
        point: { x: 200, y: 100 },
        screen: { x: 200, y: 100 },
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        button: 0,
        buttons: 0,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      });

      const elements = board.query();
      expect(elements).toHaveLength(1);
      // RDP simplified all intermediate collinear points down to start and end
      expect(elements[0]!.props.points).toHaveLength(2);
      expect(elements[0]!.props.points).toEqual([
        [0, 0, 0.5],
        [100, 0, 0.5],
      ]);
    });

    it('splits a stroke exceeding 5,000 points into multiple elements (BOARD-1002)', () => {
      board.setTool('draw');

      // We directly simulate drawing with 5,002 non-collinear zigzag points
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i <= 5001; i++) {
        // High variation perpendicular to line so RDP does not discard
        points.push({ x: i, y: i % 2 === 0 ? 0 : 50 });
      }

      board.dispatch({
        type: 'pointer-down',
        pointerId: 1,
        pointerType: 'pen',
        point: points[0]!,
        screen: points[0]!,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        button: 0,
        buttons: 1,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      });

      const data = board.toolData as { points: number[][] };
      // Inject points to simulate an extended drag
      for (let i = 1; i < points.length - 1; i++) {
        data.points.push([points[i]!.x, points[i]!.y, 0.5]);
      }

      board.dispatch({
        type: 'pointer-up',
        pointerId: 1,
        pointerType: 'pen',
        point: points[points.length - 1]!,
        screen: points[points.length - 1]!,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        button: 0,
        buttons: 0,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      });

      const elements = board.query();
      // Must be split into 2 elements because points exceed MAX_DRAW_POINTS (5000)
      expect(elements.length).toBe(2);
      for (const el of elements) {
        expect(el.props.points.length).toBeLessThanOrEqual(5000);
      }
      // Both elements selected
      expect(board.selection).toEqual(elements.map((e) => e.id));

      // Single undo reverts all split chunks in one step
      board.undo();
      expect(board.query()).toHaveLength(0);
    });
  });
});
