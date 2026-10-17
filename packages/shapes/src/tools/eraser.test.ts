import { describe, expect, it } from 'vitest';
import {
  createBoard,
  type Board,
  type InputModifiers,
  type Point,
  type ToolPointerEvent,
} from '@kujam/core';
import {
  createEraserTool,
  defaultElements,
  defaultTools,
  type EraserToolData,
} from '../index.js';

const MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

function setup(): Board {
  const board = createBoard({
    plugins: [defaultElements, defaultTools],
    snap: { grid: null },
  });
  board.camera.setViewport({ width: 1000, height: 1000 });
  return board;
}

function pointer(
  board: Board,
  type: ToolPointerEvent['type'],
  point: Point,
  extra: Partial<ToolPointerEvent> = {},
): ToolPointerEvent {
  return {
    type,
    pointerId: 1,
    pointerType: 'mouse',
    point,
    screen: board.camera.boardToScreen(point),
    pressure: type === 'pointer-up' ? 0 : 0.5,
    tiltX: 0,
    tiltY: 0,
    button: type === 'pointer-move' ? -1 : 0,
    buttons: type === 'pointer-up' ? 0 : 1,
    modifiers: MODS,
    ...extra,
  };
}

function click(board: Board, p: Point, extra: Partial<ToolPointerEvent> = {}): void {
  board.dispatch(pointer(board, 'pointer-down', p, extra));
  board.dispatch(pointer(board, 'pointer-up', p, extra));
}

function drag(board: Board, points: Point[], extra: Partial<ToolPointerEvent> = {}): void {
  board.dispatch(pointer(board, 'pointer-down', points[0]!, extra));
  for (const p of points.slice(1)) {
    board.dispatch(pointer(board, 'pointer-move', p, extra));
  }
  board.dispatch(pointer(board, 'pointer-up', points.at(-1)!, extra));
}

describe('BOARD-1005: Penghapus per Goresan dan per Area', () => {
  describe('Mode per goresan (stroke mode - bawaan)', () => {
    it('menyapu menghapus seluruh coretan yang tersentuh', () => {
      const board = setup();
      board.create({
        id: 'stroke1',
        type: 'draw',
        x: 100,
        y: 100,
        w: 200,
        h: 10,
        props: {
          points: [
            [0, 5, 0.5],
            [200, 5, 0.5],
          ],
          color: 'black',
          thickness: 4,
          brush: 'pen',
        },
      });

      expect(board.getElement('stroke1')).toBeDefined();

      board.setTool('eraser');
      expect((board.toolData as EraserToolData).mode).toBe('stroke');

      // Drag across the stroke
      drag(board, [
        { x: 150, y: 50 },
        { x: 150, y: 150 },
      ]);

      expect(board.getElement('stroke1')).toBeUndefined();
      expect(board.query()).toHaveLength(0);
    });

    it('menghapus banyak coretan dalam satu sapuan', () => {
      const board = setup();
      for (let i = 0; i < 3; i++) {
        board.create({
          id: `stroke_${i}`,
          type: 'draw',
          x: 100,
          y: 100 + i * 50,
          w: 100,
          h: 10,
          props: {
            points: [
              [0, 5, 0.5],
              [100, 5, 0.5],
            ],
            color: 'blue',
            thickness: 4,
            brush: 'pen',
          },
        });
      }
      expect(board.query()).toHaveLength(3);

      board.setTool('eraser');
      drag(board, [
        { x: 150, y: 80 },
        { x: 150, y: 220 },
      ]);

      expect(board.query()).toHaveLength(0);
    });

    it('tidak menghapus coretan bila sapuan berada di luar toleransi', () => {
      const board = setup();
      board.create({
        id: 'stroke1',
        type: 'draw',
        x: 100,
        y: 100,
        w: 100,
        h: 10,
        props: {
          points: [
            [0, 5, 0.5],
            [100, 5, 0.5],
          ],
          color: 'black',
          thickness: 4,
          brush: 'pen',
        },
      });

      board.setTool('eraser');
      // Drag parallel to the stroke but far away (y = 50 vs y = 105)
      drag(board, [
        { x: 100, y: 50 },
        { x: 200, y: 50 },
      ]);

      expect(board.getElement('stroke1')).toBeDefined();
    });
  });

  describe('Mode per area (area mode)', () => {
    it('memotong bagian coretan yang tersentuh dan menghasilkan coretan baru', () => {
      const board = setup();
      board.create({
        id: 'stroke1',
        type: 'draw',
        x: 100,
        y: 100,
        w: 200,
        h: 10,
        props: {
          points: [
            [0, 5, 0.5],
            [200, 5, 0.5],
          ],
          color: 'purple',
          thickness: 6,
          brush: 'pen',
        },
      });

      board.setTool('eraser');
      (board.toolData as EraserToolData).mode = 'area';
      (board.toolData as EraserToolData).tolerance = 10;

      // Click / cut at the middle of the stroke (x = 200, y = 105)
      click(board, { x: 200, y: 105 });

      const all = board.query();
      // Should now have 2 strokes
      expect(all).toHaveLength(2);

      // Verify props preserved on both fragments
      for (const el of all) {
        expect(el.type).toBe('draw');
        expect(el.props.color).toBe('purple');
        expect(el.props.thickness).toBe(6);
        expect(el.props.brush).toBe('pen');
      }

      // First piece ends before x = 195, second piece starts after x = 205
      const piece1 = all[0]!;
      const piece2 = all[1]!;
      expect(piece1.x).toBeCloseTo(100, 0);
      expect(piece1.x + piece1.w).toBeLessThanOrEqual(195);

      expect(piece2.x).toBeGreaterThanOrEqual(205);
      expect(piece2.x + piece2.w).toBeCloseTo(300, 0);
    });

    it('memotong ujung coretan tanpa menambah elemen baru', () => {
      const board = setup();
      board.create({
        id: 'stroke1',
        type: 'draw',
        x: 100,
        y: 100,
        w: 100,
        h: 10,
        props: {
          points: [
            [0, 5, 0.5],
            [100, 5, 0.5],
          ],
          color: 'green',
          thickness: 4,
          brush: 'pen',
        },
      });

      board.setTool('eraser');
      (board.toolData as EraserToolData).mode = 'area';
      (board.toolData as EraserToolData).tolerance = 15;

      // Click at the start of the stroke (x = 100, y = 105)
      click(board, { x: 100, y: 105 });

      const all = board.query();
      expect(all).toHaveLength(1);
      const trimmed = all[0]!;
      expect(trimmed.id).toBe('stroke1');
      // Start is trimmed past x = 110
      expect(trimmed.x).toBeGreaterThanOrEqual(110);
      expect(trimmed.x + trimmed.w).toBeCloseTo(200, 0);
    });

    it('menghapus seluruh coretan bila sapuan area melingkupi seluruh garis', () => {
      const board = setup();
      board.create({
        id: 'stroke1',
        type: 'draw',
        x: 100,
        y: 100,
        w: 20,
        h: 10,
        props: {
          points: [
            [0, 5, 0.5],
            [20, 5, 0.5],
          ],
          color: 'black',
          thickness: 4,
          brush: 'pen',
        },
      });

      board.setTool('eraser');
      (board.toolData as EraserToolData).mode = 'area';
      (board.toolData as EraserToolData).tolerance = 30;

      click(board, { x: 110, y: 105 });

      expect(board.query()).toHaveLength(0);
    });
  });

  describe('Filter target (coretan bawaan; opsi untuk elemen lain)', () => {
    it('secara bawaan penghapus hanya memengaruhi coretan dan mengabaikan sticky/geo/teks', () => {
      const board = setup();
      board.create({ id: 'sticky1', type: 'sticky', x: 50, y: 50, w: 100, h: 100 });
      board.create({ id: 'geo1', type: 'geo', x: 200, y: 50, w: 100, h: 100 });
      board.create({ id: 'text1', type: 'text', x: 350, y: 50, w: 100, h: 40 });
      board.create({
        id: 'stroke1',
        type: 'draw',
        x: 500,
        y: 50,
        w: 100,
        h: 10,
        props: {
          points: [
            [0, 5, 0.5],
            [100, 5, 0.5],
          ],
          color: 'black',
          thickness: 4,
          brush: 'pen',
        },
      });

      expect(board.query()).toHaveLength(4);

      board.setTool('eraser');
      expect((board.toolData as EraserToolData).targets).toBe('stroke');

      // Click sticky, geo, text
      click(board, { x: 80, y: 80 });
      click(board, { x: 250, y: 80 });
      click(board, { x: 380, y: 60 });

      // Sticky, geo, text remain untouched!
      expect(board.getElement('sticky1')).toBeDefined();
      expect(board.getElement('geo1')).toBeDefined();
      expect(board.getElement('text1')).toBeDefined();

      // Click stroke
      click(board, { x: 550, y: 55 });
      // Stroke is deleted!
      expect(board.getElement('stroke1')).toBeUndefined();
      expect(board.query()).toHaveLength(3);
    });

    it('opsi targets: all memengaruhi elemen non-coretan', () => {
      const board = setup();
      board.create({ id: 'geo1', type: 'geo', x: 100, y: 100, w: 100, h: 100 });
      expect(board.query()).toHaveLength(1);

      board.setTool('eraser');
      (board.toolData as EraserToolData).targets = 'all';

      click(board, { x: 150, y: 150 });
      expect(board.getElement('geo1')).toBeUndefined();
      expect(board.query()).toHaveLength(0);
    });
  });

  describe('Satu sapuan = satu langkah undo', () => {
    it('menghapus banyak coretan dalam satu sapuan dipulihkan dalam 1 langkah undo', () => {
      const board = setup();
      for (let i = 0; i < 3; i++) {
        board.create({
          id: `s_${i}`,
          type: 'draw',
          x: 100,
          y: 100 + i * 40,
          w: 80,
          h: 10,
          props: {
            points: [
              [0, 5, 0.5],
              [80, 5, 0.5],
            ],
            color: 'black',
            thickness: 4,
            brush: 'pen',
          },
        });
      }
      board.history.clear();

      board.setTool('eraser');
      // Drag sweeping across all 3
      drag(board, [
        { x: 140, y: 80 },
        { x: 140, y: 150 },
        { x: 140, y: 220 },
      ]);

      expect(board.query()).toHaveLength(0);

      // Single undo restores all 3 strokes!
      board.undo();
      expect(board.query()).toHaveLength(3);
      expect(board.getElement('s_0')).toBeDefined();
      expect(board.getElement('s_1')).toBeDefined();
      expect(board.getElement('s_2')).toBeDefined();

      // Redo removes them all again
      board.redo();
      expect(board.query()).toHaveLength(0);
    });

    it('memotong goresan di mode area dalam satu sapuan dipulihkan dalam 1 langkah undo', () => {
      const board = setup();
      board.create({
        id: 's_cut',
        type: 'draw',
        x: 100,
        y: 100,
        w: 200,
        h: 10,
        props: {
          points: [
            [0, 5, 0.5],
            [200, 5, 0.5],
          ],
          color: 'blue',
          thickness: 4,
          brush: 'pen',
        },
      });
      board.history.clear();

      board.setTool('eraser');
      (board.toolData as EraserToolData).mode = 'area';
      (board.toolData as EraserToolData).tolerance = 10;

      // Slice the stroke
      drag(board, [
        { x: 200, y: 80 },
        { x: 200, y: 120 },
      ]);

      expect(board.query()).toHaveLength(2);

      // Single undo restores the single original stroke
      board.undo();
      expect(board.query()).toHaveLength(1);
      const restored = board.getElement('s_cut')!;
      expect(restored).toBeDefined();
      expect(restored.w).toBe(200);

      // Redo re-slices it
      board.redo();
      expect(board.query()).toHaveLength(2);
    });
  });

  describe('Tombol penghapus di ujung stylus (BOARD-1005)', () => {
    it('mengaktifkan penghapus saat pena ditekan dengan button 5 atau buttons & 32', () => {
      const board = setup();
      board.create({
        id: 'stroke_pen',
        type: 'draw',
        x: 100,
        y: 100,
        w: 100,
        h: 10,
        props: {
          points: [
            [0, 5, 0.5],
            [100, 5, 0.5],
          ],
          color: 'black',
          thickness: 4,
          brush: 'pen',
        },
      });

      // User was on draw tool
      board.setTool('draw');
      expect(board.tool).toBe('draw');

      // User presses down with stylus eraser (button 5, buttons 32)
      board.dispatch(
        pointer(board, 'pointer-down', { x: 150, y: 105 }, {
          pointerType: 'pen',
          button: 5,
          buttons: 32,
        }),
      );

      // Tool automatically switched to eraser
      expect(board.tool).toBe('eraser');

      // User releases stylus eraser
      board.dispatch(
        pointer(board, 'pointer-up', { x: 150, y: 105 }, {
          pointerType: 'pen',
          button: 5,
          buttons: 0,
        }),
      );

      // The stroke is erased!
      expect(board.getElement('stroke_pen')).toBeUndefined();
      // And active tool returned to draw!
      expect(board.tool).toBe('draw');

      // Single undo restores the stroke
      board.undo();
      expect(board.getElement('stroke_pen')).toBeDefined();
    });
  });

  describe('Elemen terkunci', () => {
    it('tidak menghapus elemen terkunci', () => {
      const board = setup();
      board.create({
        id: 'locked_stroke',
        type: 'draw',
        x: 100,
        y: 100,
        w: 100,
        h: 10,
        locked: true,
        props: {
          points: [
            [0, 5, 0.5],
            [100, 5, 0.5],
          ],
          color: 'black',
          thickness: 4,
          brush: 'pen',
        },
      });

      board.setTool('eraser');
      click(board, { x: 150, y: 105 });

      expect(board.getElement('locked_stroke')).toBeDefined();
    });
  });
});
