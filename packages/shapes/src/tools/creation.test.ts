import { describe, expect, it } from 'vitest';
import {
  createBoard,
  type Board,
  type InputModifiers,
  type Point,
  type ToolPointerEvent,
} from '@kujam/core';
import {
  defaultElements,
  defaultTools,
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
  mods: Partial<InputModifiers> = {},
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
    modifiers: { ...MODS, ...mods },
    ...extra,
  };
}

function click(board: Board, p: Point, mods: Partial<InputModifiers> = {}): void {
  board.dispatch(pointer(board, 'pointer-down', p, mods));
  board.dispatch(pointer(board, 'pointer-up', p, mods));
}

function drag(
  board: Board,
  points: Point[],
  mods: Partial<InputModifiers> = {},
  release = true,
): void {
  board.dispatch(pointer(board, 'pointer-down', points[0]!, mods));
  for (const p of points.slice(1)) board.dispatch(pointer(board, 'pointer-move', p, mods));
  if (release) board.dispatch(pointer(board, 'pointer-up', points[points.length - 1]!, mods));
}

function pressKey(board: Board, key: string, code: string): void {
  board.dispatch({
    type: 'key-down',
    key,
    code,
    repeat: false,
    modifiers: MODS,
  });
}

describe('BOARD-913: Element creation tools', () => {
  describe('Tool shortcuts', () => {
    it('activates tools via single-key shortcuts: s, p, t, r, o, e', () => {
      const board = setup();
      board.setTool('select');

      pressKey(board, 's', 'KeyS');
      expect(board.tool).toBe('sticky');

      pressKey(board, 'p', 'KeyP');
      expect(board.tool).toBe('draw');

      pressKey(board, 't', 'KeyT');
      expect(board.tool).toBe('text');

      pressKey(board, 'r', 'KeyR');
      expect(board.tool).toBe('rectangle');

      pressKey(board, 'o', 'KeyO');
      expect(board.tool).toBe('ellipse');

      pressKey(board, 'e', 'KeyE');
      expect(board.tool).toBe('eraser');

      pressKey(board, 'v', 'KeyV');
      expect(board.tool).toBe('select');
    });
  });

  describe('Sticky tool (S)', () => {
    it('click creates default 192×144 sticky, selects it, emits edit action, and stays active', () => {
      const board = setup();
      board.setTool('sticky');

      const actions: unknown[] = [];
      board.on('action', (e) => actions.push(e));

      click(board, { x: 50, y: 100 });

      const elements = board.query();
      expect(elements).toHaveLength(1);
      const sticky = elements[0]!;
      expect(sticky.type).toBe('sticky');
      expect(sticky.x).toBe(50);
      expect(sticky.y).toBe(100);
      expect(sticky.w).toBe(192);
      expect(sticky.h).toBe(144);
      expect(board.selection).toEqual([sticky.id]);

      // Emits edit action immediately after creation
      expect(actions).toEqual([{ name: 'edit', payload: { id: sticky.id } }]);

      // Tool stays active until Esc
      expect(board.tool).toBe('sticky');

      // Esc returns to default tool ('select')
      pressKey(board, 'Escape', 'Escape');
      expect(board.tool).toBe('select');
    });

    it('drag creates custom-sized sticky with aspect ratio locked on Shift', () => {
      const board = setup();
      board.setTool('sticky');

      // Drag without shift
      drag(board, [{ x: 10, y: 20 }, { x: 150, y: 120 }]);

      let elements = board.query();
      expect(elements).toHaveLength(1);
      expect(elements[0]!.w).toBe(140);
      expect(elements[0]!.h).toBe(100);

      // Drag with shift: locks aspect 1:1
      drag(board, [{ x: 200, y: 200 }, { x: 350, y: 260 }], { shift: true });
      elements = board.query();
      expect(elements).toHaveLength(2);
      expect(elements[1]!.w).toBe(150);
      expect(elements[1]!.h).toBe(150);
    });
  });

  describe('Text tool (T)', () => {
    it('click creates 200×40 text element, selects it, emits edit action', () => {
      const board = setup();
      board.setTool('text');

      const actions: unknown[] = [];
      board.on('action', (e) => actions.push(e));

      click(board, { x: 100, y: 200 });

      const elements = board.query();
      expect(elements).toHaveLength(1);
      const text = elements[0]!;
      expect(text.type).toBe('text');
      expect(text.x).toBe(100);
      expect(text.y).toBe(200);
      expect(text.w).toBe(200);
      expect(text.h).toBe(40);
      expect(board.selection).toEqual([text.id]);

      expect(actions).toEqual([{ name: 'edit', payload: { id: text.id } }]);
      expect(board.tool).toBe('text');

      pressKey(board, 'Escape', 'Escape');
      expect(board.tool).toBe('select');
    });

    it('drag creates custom-sized text element', () => {
      const board = setup();
      board.setTool('text');

      drag(board, [{ x: 0, y: 0 }, { x: 400, y: 80 }]);

      const elements = board.query();
      expect(elements).toHaveLength(1);
      expect(elements[0]!.w).toBe(400);
      expect(elements[0]!.h).toBe(80);
    });
  });

  describe('Shape tools (R for rectangle, O for ellipse)', () => {
    it('rectangle tool creates geo element with geo="rectangle"', () => {
      const board = setup();
      board.setTool('rectangle');

      click(board, { x: 10, y: 10 });
      let elements = board.query();
      expect(elements).toHaveLength(1);
      expect(elements[0]!.type).toBe('geo');
      expect(elements[0]!.props.geo).toBe('rectangle');
      expect(elements[0]!.w).toBe(100);
      expect(elements[0]!.h).toBe(100);

      // Drag with free aspect
      drag(board, [{ x: 200, y: 200 }, { x: 400, y: 300 }]);
      elements = board.query();
      expect(elements).toHaveLength(2);
      expect(elements[1]!.w).toBe(200);
      expect(elements[1]!.h).toBe(100);
    });

    it('ellipse tool creates geo element with geo="ellipse"', () => {
      const board = setup();
      board.setTool('ellipse');

      click(board, { x: 50, y: 50 });
      let elements = board.query();
      expect(elements).toHaveLength(1);
      expect(elements[0]!.type).toBe('geo');
      expect(elements[0]!.props.geo).toBe('ellipse');
      expect(elements[0]!.w).toBe(100);
      expect(elements[0]!.h).toBe(100);

      // Shift drag locks 1:1
      drag(board, [{ x: 200, y: 200 }, { x: 320, y: 280 }], { shift: true });
      elements = board.query();
      expect(elements).toHaveLength(2);
      expect(elements[1]!.w).toBe(120);
      expect(elements[1]!.h).toBe(120);
    });
  });

  describe('Draw tool (P)', () => {
    it('click creates a single-point dot stroke', () => {
      const board = setup();
      board.setTool('draw');

      click(board, { x: 100, y: 150 });

      const elements = board.query();
      expect(elements).toHaveLength(1);
      const draw = elements[0]!;
      expect(draw.type).toBe('draw');
      expect(draw.x).toBe(100);
      expect(draw.y).toBe(150);
      expect(draw.props.points).toEqual([[0, 0, 0.5]]);
      expect(board.selection).toEqual([draw.id]);
    });

    it('drag streams stroke points in element-local coordinates with updated bounds', () => {
      const board = setup();
      board.setTool('draw');

      drag(board, [
        { x: 100, y: 100 },
        { x: 150, y: 120 },
        { x: 200, y: 160 },
      ]);

      const elements = board.query();
      expect(elements).toHaveLength(1);
      const draw = elements[0]!;
      expect(draw.type).toBe('draw');
      expect(draw.x).toBe(100);
      expect(draw.y).toBe(100);
      expect(draw.w).toBe(100); // 200 - 100
      expect(draw.h).toBe(60); // 160 - 100

      // Points must be in element-local coordinates (relative to draw.x, draw.y)
      expect(draw.props.points).toEqual([
        [0, 0, 0.5],
        [50, 20, 0.5],
        [100, 60, 0.5],
      ]);

      // Tool stays active in idle until Esc
      expect(board.tool).toBe('draw');
      pressKey(board, 'Escape', 'Escape');
      expect(board.tool).toBe('select');
    });

    it('cancels in-progress drawing on pointer-cancel or Esc', () => {
      const board = setup();
      board.setTool('draw');

      // Start drawing
      board.dispatch(pointer(board, 'pointer-down', { x: 50, y: 50 }));
      board.dispatch(pointer(board, 'pointer-move', { x: 80, y: 80 }));
      expect(board.toolState).toBe('drawing');
      expect((board.toolData as { activeStroke: { points: number[][] } }).activeStroke.points).toHaveLength(2);
      expect(board.query()).toHaveLength(0);

      // Cancel
      pressKey(board, 'Escape', 'Escape');
      // In-progress element cancelled and not committed to document
      expect(board.query()).toHaveLength(0);
      expect((board.toolData as { activeStroke: unknown }).activeStroke).toBeNull();
      // Tool returns to idle
      expect(board.tool).toBe('draw');
      expect(board.toolState).toBe('idle');

      // Second escape returns to select
      pressKey(board, 'Escape', 'Escape');
      expect(board.tool).toBe('select');
    });
  });

  describe('Eraser tool (E)', () => {
    it('deletes hit element on click', () => {
      const board = setup();
      board.create({
        id: 'stroke1',
        type: 'draw',
        x: 50,
        y: 50,
        w: 100,
        h: 100,
        props: { points: [[0, 0, 0.5], [100, 100, 0.5]], color: 'black', thickness: 4, brush: 'pen' },
      });
      board.create({
        id: 'stroke2',
        type: 'draw',
        x: 300,
        y: 300,
        w: 100,
        h: 100,
        props: { points: [[0, 0, 0.5], [100, 100, 0.5]], color: 'black', thickness: 4, brush: 'pen' },
      });
      expect(board.query()).toHaveLength(2);

      board.setTool('eraser');
      click(board, { x: 80, y: 80 });

      expect(board.getElement('stroke1')).toBeUndefined();
      expect(board.getElement('stroke2')).toBeDefined();
      expect(board.tool).toBe('eraser');
    });

    it('deletes multiple elements during drag and coalesces into 1 undo step', () => {
      const board = setup();
      board.create({
        id: 'el1',
        type: 'draw',
        x: 100,
        y: 100,
        w: 50,
        h: 50,
        props: { points: [[0, 0, 0.5], [50, 50, 0.5]], color: 'black', thickness: 4, brush: 'pen' },
      });
      board.create({
        id: 'el2',
        type: 'draw',
        x: 200,
        y: 100,
        w: 50,
        h: 50,
        props: { points: [[0, 0, 0.5], [50, 50, 0.5]], color: 'black', thickness: 4, brush: 'pen' },
      });
      board.create({
        id: 'el3',
        type: 'draw',
        x: 300,
        y: 100,
        w: 50,
        h: 50,
        props: { points: [[0, 0, 0.5], [50, 50, 0.5]], color: 'black', thickness: 4, brush: 'pen' },
      });
      board.history.clear();

      board.setTool('eraser');
      drag(board, [
        { x: 125, y: 125 },
        { x: 225, y: 125 },
        { x: 325, y: 125 },
      ]);

      expect(board.query()).toHaveLength(0);

      // Single undo restores all 3 elements
      board.undo();
      expect(board.query()).toHaveLength(3);
    });

    it('does not delete locked elements', () => {
      const board = setup();
      board.create({
        id: 'locked1',
        type: 'draw',
        x: 100,
        y: 100,
        w: 50,
        h: 50,
        locked: true,
        props: { points: [[0, 0, 0.5], [50, 50, 0.5]], color: 'black', thickness: 4, brush: 'pen' },
      });

      board.setTool('eraser');
      click(board, { x: 125, y: 125 });

      expect(board.getElement('locked1')).toBeDefined();
    });
  });
});
