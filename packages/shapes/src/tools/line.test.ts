// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createBoard,
  type Board,
  type ElementRecord,
  type InputModifiers,
  type Point,
  type ToolPointerEvent,
} from '@kujam/core';
import { defaultElements, defaultTools, type LineProps, type LineToolData } from '../index.js';
import { lineWorldPoints, normalizeLinePoints } from '../elements/line.js';

const NO_MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

function setup(): Board {
  const board = createBoard({ plugins: [defaultElements, defaultTools], snap: { grid: null } });
  board.camera.setViewport({ width: 1200, height: 900 });
  return board;
}

let nextPointerId = 1;

function pointer(
  board: Board,
  type: ToolPointerEvent['type'],
  point: Point,
  options: { clickCount?: number; modifiers?: Partial<InputModifiers>; pointerId?: number } = {},
): ToolPointerEvent {
  return {
    type,
    pointerId: options.pointerId ?? 1,
    pointerType: 'mouse',
    point,
    screen: board.camera.boardToScreen(point),
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    button: 0,
    buttons: type === 'pointer-up' || type === 'pointer-move' ? 0 : 1,
    modifiers: { ...NO_MODS, ...options.modifiers },
    clickCount: options.clickCount ?? 1,
  };
}

function click(
  board: Board,
  point: Point,
  options: { clickCount?: number; modifiers?: Partial<InputModifiers>; pointerId?: number } = {},
): void {
  board.dispatch(pointer(board, 'pointer-down', point, options));
  board.dispatch(pointer(board, 'pointer-up', point, options));
}

function drag(board: Board, from: Point, to: Point, modifiers: Partial<InputModifiers> = {}): void {
  board.dispatch(pointer(board, 'pointer-down', from, { modifiers }));
  board.dispatch({ ...pointer(board, 'pointer-move', to, { modifiers }), buttons: 1 });
  board.dispatch(pointer(board, 'pointer-up', to, { modifiers }));
}

function key(board: Board, keyName: string): boolean {
  return board.dispatch({
    type: 'key-down',
    key: keyName,
    code: keyName,
    repeat: false,
    modifiers: NO_MODS,
  });
}

function lines(board: Board): Readonly<ElementRecord<LineProps>>[] {
  return board.query().filter((el) => el.type === 'line') as Readonly<ElementRecord<LineProps>>[];
}

describe('line tool (BOARD-1106)', () => {
  it('is in defaultTools with the Shift+L shortcut', () => {
    const board = setup();
    expect(board.tools.has('line')).toBe(true);
    expect(board.keybindings.get('Shift+L')?.target).toBe('tool:line');
  });

  it('adds a point per click and finishes on double click as one undo step', () => {
    const board = setup();
    board.setTool('line');
    click(board, { x: 0, y: 0 });
    click(board, { x: 100, y: 0 });
    click(board, { x: 100, y: 80 });
    expect(lines(board)).toHaveLength(0);
    // Second press of a double click on the last point.
    click(board, { x: 100, y: 80 }, { clickCount: 2 });

    const [created] = lines(board);
    expect(created).toBeDefined();
    expect(lineWorldPoints(created!)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]);
    expect({ x: created!.x, y: created!.y, w: created!.w, h: created!.h }).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
    expect(board.selection).toEqual([created!.id]);
    expect(board.tool).toBe('line');

    board.undo();
    expect(lines(board)).toHaveLength(0);
  });

  it('finishes on Enter and accepts taps from different pointers', () => {
    const board = setup();
    board.setTool('line');
    click(board, { x: 10, y: 10 }, { pointerId: nextPointerId++ });
    click(board, { x: 60, y: 10 }, { pointerId: nextPointerId++ });
    expect(key(board, 'Enter')).toBe(true);
    expect(lineWorldPoints(lines(board)[0]!)).toEqual([
      { x: 10, y: 10 },
      { x: 60, y: 10 },
    ]);
  });

  it('shows a preview through the pointer while placing', () => {
    const board = setup();
    board.setTool('line');
    click(board, { x: 0, y: 0 });
    board.dispatch(pointer(board, 'pointer-move', { x: 50, y: 40 }));
    const data = board.toolData as LineToolData;
    expect(data.connectorPreview?.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 40 },
    ]);
    expect(data.connectorPreview?.style).toBe('straight');
  });

  it('drops repeated points, needs 2 points, and Backspace removes the last point', () => {
    const board = setup();
    board.setTool('line');
    click(board, { x: 0, y: 0 });
    click(board, { x: 0.5, y: 0 });
    expect((board.toolData as LineToolData).points).toHaveLength(1);
    expect(key(board, 'Enter')).toBe(true);
    expect(lines(board)).toHaveLength(0);

    click(board, { x: 0, y: 0 });
    click(board, { x: 50, y: 0 });
    click(board, { x: 50, y: 50 });
    expect(key(board, 'Backspace')).toBe(true);
    key(board, 'Enter');
    expect(lineWorldPoints(lines(board)[0]!)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
    // Without a line in progress, keys are left to the shortcuts.
    board.clearSelection();
    expect(key(board, 'Enter')).toBe(false);
  });

  it('a drag adds both the press and the release point', () => {
    const board = setup();
    board.setTool('line');
    drag(board, { x: 0, y: 0 }, { x: 80, y: 30 });
    key(board, 'Enter');
    expect(lineWorldPoints(lines(board)[0]!)).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 30 },
    ]);
  });

  it('Shift snaps the next segment to 45 degrees', () => {
    const board = setup();
    board.setTool('line');
    click(board, { x: 0, y: 0 });
    click(board, { x: 100, y: 10 }, { modifiers: { shift: true } });
    key(board, 'Enter');
    const [, second] = lineWorldPoints(lines(board)[0]!);
    expect(second!.y).toBeCloseTo(0);
    expect(second!.x).toBeCloseTo(Math.hypot(100, 10));
  });

  it('uses the remembered line style', () => {
    const board = setup();
    board.toolStyles.set('line', { color: 'red', endArrow: 'arrow', dash: 'dashed' });
    board.setTool('line');
    click(board, { x: 0, y: 0 });
    click(board, { x: 40, y: 0 });
    key(board, 'Enter');
    expect(lines(board)[0]!.props).toMatchObject({
      color: 'red',
      endArrow: 'arrow',
      dash: 'dashed',
    });
  });

  it('Esc drops the unfinished line', () => {
    const board = setup();
    board.setTool('line');
    click(board, { x: 0, y: 0 });
    click(board, { x: 40, y: 0 });
    key(board, 'Escape');
    expect(lines(board)).toHaveLength(0);
    expect(board.tool).toBe('select');
  });

  it('creates nothing on a read-only board', () => {
    const board = setup();
    board.setTool('line');
    board.setReadOnly(true);
    click(board, { x: 0, y: 0 });
    click(board, { x: 40, y: 0 });
    key(board, 'Enter');
    expect(lines(board)).toHaveLength(0);
  });
});

describe('select tool line editing (BOARD-1106)', () => {
  function withLine(board: Board, world: Point[]): Readonly<ElementRecord<LineProps>> {
    const box = normalizeLinePoints(world);
    const el = board.create({
      id: 'l',
      type: 'line',
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      props: { points: box.points },
    });
    board.history.clear();
    board.setTool('select');
    board.select(['l']);
    return el as Readonly<ElementRecord<LineProps>>;
  }

  const path = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 300 },
  ];

  function points(board: Board): Point[] {
    return lineWorldPoints(board.getElement('l') as ElementRecord<LineProps>);
  }

  it('drags a point as one undo step', () => {
    const board = setup();
    withLine(board, path);
    board.dispatch(pointer(board, 'pointer-down', { x: 300, y: 100 }));
    board.dispatch({ ...pointer(board, 'pointer-move', { x: 320, y: 60 }), buttons: 1 });
    board.dispatch({ ...pointer(board, 'pointer-move', { x: 350, y: 50 }), buttons: 1 });
    board.dispatch(pointer(board, 'pointer-up', { x: 350, y: 50 }));
    expect(points(board)).toEqual([
      { x: 100, y: 100 },
      { x: 350, y: 50 },
      { x: 300, y: 300 },
    ]);
    expect(board.history.undoStack).toHaveLength(1);
    board.undo();
    expect(points(board)).toEqual(path);
  });

  it('a plain click on a point changes nothing', () => {
    const board = setup();
    withLine(board, path);
    click(board, { x: 300, y: 100 });
    expect(points(board)).toEqual(path);
    expect(board.history.undoStack).toHaveLength(0);
  });

  it('dragging a segment middle inserts a point there', () => {
    const board = setup();
    withLine(board, path);
    drag(board, { x: 200, y: 100 }, { x: 200, y: 40 });
    expect(points(board)).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 40 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
    expect(board.history.undoStack).toHaveLength(1);
  });

  it('clicking a segment middle inserts a point at the middle', () => {
    const board = setup();
    withLine(board, path);
    click(board, { x: 300, y: 200 });
    expect(points(board)).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 300, y: 300 },
    ]);
    // The second press of a double click there does not delete the new point again.
    click(board, { x: 300, y: 200 }, { clickCount: 2 });
    expect(points(board)).toHaveLength(4);
  });

  it('double click or Alt+click on a point deletes it, keeping at least 2 points', () => {
    const board = setup();
    withLine(board, path);
    click(board, { x: 300, y: 100 });
    click(board, { x: 300, y: 100 }, { clickCount: 2 });
    expect(points(board)).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 300 },
    ]);
    expect(board.history.undoStack).toHaveLength(1);
    click(board, { x: 100, y: 100 }, { modifiers: { alt: true } });
    expect(points(board)).toHaveLength(2);
    board.undo();
    expect(points(board)).toEqual(path);
  });

  it('Esc during a point drag restores the line', () => {
    const board = setup();
    withLine(board, path);
    board.dispatch(pointer(board, 'pointer-down', { x: 100, y: 100 }));
    board.dispatch({ ...pointer(board, 'pointer-move', { x: 0, y: 0 }), buttons: 1 });
    key(board, 'Escape');
    expect(points(board)).toEqual(path);
  });

  it('dragging the line body moves the whole line', () => {
    const board = setup();
    withLine(board, path);
    drag(board, { x: 300, y: 250 }, { x: 330, y: 260 });
    expect(points(board)).toEqual(path.map((p) => ({ x: p.x + 30, y: p.y + 10 })));
  });

  it('locked lines show no point handles', () => {
    const board = setup();
    withLine(board, path);
    board.update('l', { locked: true });
    drag(board, { x: 300, y: 100 }, { x: 350, y: 50 });
    expect(points(board)).toEqual(path);
  });
});
