import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  object,
  string,
  transformHandles,
  selectionFrame,
  type Board,
  type InputModifiers,
  type Point,
  type ToolPointerEvent,
} from '@kujam/core';
import { defaultTools, ROTATE_HANDLE_OFFSET_PX, type SelectToolData } from './index.js';

const MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

const onDoubleClick = vi.fn();
const box = defineElement({
  type: 'box',
  version: 1,
  props: object({ label: string() }),
  defaults: { label: '' },
  onDoubleClick,
});
const boxes = definePlugin({ id: 'boxes', elements: [box] });

/** Board at zoom 1 with `a` (0,0 100×100), `b` (300,0 100×100), and `c` (0,300 50×50). */
function setup(): Board {
  const board = createBoard({ plugins: [boxes, defaultTools], snap: { grid: null } });
  board.camera.setViewport({ width: 1000, height: 1000 });
  board.create({ id: 'a', type: 'box', x: 0, y: 0, w: 100, h: 100 });
  board.create({ id: 'b', type: 'box', x: 300, y: 0, w: 100, h: 100 });
  board.create({ id: 'c', type: 'box', x: 0, y: 300, w: 50, h: 50 });
  board.history.clear();
  board.setTool('select');
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

function click(board: Board, p: Point, mods: Partial<InputModifiers> = {}, clickCount = 1): void {
  board.dispatch(pointer(board, 'pointer-down', p, mods, { clickCount }));
  board.dispatch(pointer(board, 'pointer-up', p, mods));
}

/** Press at the first point, move through the rest, and release unless `release` is false. */
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

function escape(board: Board): void {
  board.dispatch({
    type: 'key-down',
    key: 'Escape',
    code: 'Escape',
    repeat: false,
    modifiers: MODS,
  });
}

const data = (board: Board) => board.toolData as SelectToolData;
const pos = (board: Board, id: string) => {
  const el = board.getElement(id)!;
  return { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation };
};

describe('BOARD-502: select tool, clicking', () => {
  it('selects the element under the pointer and clears on empty space', () => {
    const board = setup();
    click(board, { x: 50, y: 50 });
    expect(board.selection).toEqual(['a']);
    click(board, { x: 350, y: 50 });
    expect(board.selection).toEqual(['b']);
    click(board, { x: 700, y: 700 });
    expect(board.selection).toEqual([]);
  });

  it('toggles with Shift+click', () => {
    const board = setup();
    click(board, { x: 50, y: 50 });
    click(board, { x: 350, y: 50 }, { shift: true });
    expect(board.selection).toEqual(['a', 'b']);
    click(board, { x: 50, y: 50 }, { shift: true });
    expect(board.selection).toEqual(['b']);
  });

  it('narrows a multi-selection to the clicked element when there is no drag', () => {
    const board = setup();
    board.select(['a', 'b']);
    click(board, { x: 50, y: 50 });
    expect(board.selection).toEqual(['a']);
  });

  it('forwards a double click to the element type with the element context', () => {
    const board = setup();
    const actions: string[] = [];
    board.on('action', (e) => actions.push(e.name));
    onDoubleClick.mockImplementationOnce((_el, ctx) => ctx.emit('box.edit'));
    click(board, { x: 50, y: 50 }, {}, 2);
    expect(onDoubleClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      board.elementContext,
    );
    expect(board.elementContext.locale).toBe('id');
    expect(actions).toEqual(['box.edit']);
    expect(board.selection).toEqual(['a']);
  });

  it('never hits locked elements', () => {
    const board = setup();
    board.update('a', { locked: true });
    click(board, { x: 50, y: 50 });
    expect(board.selection).toEqual([]);
  });
});

describe('BOARD-502: select tool, selection box', () => {
  it('selects fully covered elements and shows the box while dragging', () => {
    const board = setup();
    drag(
      board,
      [
        { x: -10, y: -10 },
        { x: 200, y: 400 },
      ],
      {},
      false,
    );
    expect(data(board).brush).toEqual({ minX: -10, minY: -10, maxX: 200, maxY: 400 });
    expect(board.selection).toEqual(['a', 'c']);
    board.dispatch(pointer(board, 'pointer-up', { x: 200, y: 400 }));
    expect(data(board).brush).toBeNull();
    expect(board.selection).toEqual(['a', 'c']);
  });

  it('selects partially covered elements with Alt', () => {
    const board = setup();
    drag(board, [
      { x: 150, y: 50 },
      { x: 350, y: 60 },
    ]);
    expect(board.selection).toEqual([]);
    drag(
      board,
      [
        { x: 150, y: 50 },
        { x: 350, y: 60 },
      ],
      { alt: true },
    );
    expect(board.selection).toEqual(['b']);
  });

  it('adds to the selection with Shift', () => {
    const board = setup();
    board.select('b');
    drag(
      board,
      [
        { x: -10, y: 250 },
        { x: 60, y: 360 },
      ],
      { shift: true },
    );
    expect(board.selection).toEqual(['b', 'c']);
  });

  it('restores the previous selection on Esc', () => {
    const board = setup();
    board.select('b');
    drag(
      board,
      [
        { x: -10, y: 250 },
        { x: 60, y: 360 },
      ],
      { shift: true },
      false,
    );
    expect(board.selection).toEqual(['b', 'c']);
    escape(board);
    expect(board.selection).toEqual(['b']);
    expect(board.toolState).toBe('idle');
  });
});

describe('BOARD-502: select tool, moving', () => {
  it('moves the whole selection as one undo step', () => {
    const board = setup();
    board.select(['a', 'c']);
    drag(board, [
      { x: 50, y: 50 },
      { x: 60, y: 55 },
      { x: 70, y: 80 },
    ]);
    expect(pos(board, 'a')).toMatchObject({ x: 20, y: 30 });
    expect(pos(board, 'c')).toMatchObject({ x: 20, y: 330 });
    expect(board.selection).toEqual(['a', 'c']);
    board.undo();
    expect(pos(board, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(board.history.canUndo).toBe(false);
  });

  it('ignores movement below the drag threshold', () => {
    const board = setup();
    drag(board, [
      { x: 50, y: 50 },
      { x: 52, y: 51 },
    ]);
    expect(pos(board, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(board.history.canUndo).toBe(false);
  });

  it('snaps to other elements, shows guides, and Ctrl turns snapping off', () => {
    const board = setup();
    // Dragging b left by 197 puts its left edge at 103, 3 units from a's right edge.
    drag(
      board,
      [
        { x: 350, y: 50 },
        { x: 153, y: 50 },
      ],
      {},
      false,
    );
    expect(pos(board, 'b').x).toBe(100);
    expect(data(board).guides).toContainEqual(
      expect.objectContaining({ axis: 'x', position: 100 }),
    );
    board.dispatch(pointer(board, 'pointer-move', { x: 153, y: 50 }, { ctrl: true }));
    expect(pos(board, 'b').x).toBe(103);
    expect(data(board).guides).toEqual([]);
    board.dispatch(pointer(board, 'pointer-up', { x: 153, y: 50 }, { ctrl: true }));
  });

  it('restores positions and selection on Esc', () => {
    const board = setup();
    board.select('b');
    drag(
      board,
      [
        { x: 50, y: 50 },
        { x: 500, y: 500 },
      ],
      {},
      false,
    );
    expect(board.selection).toEqual(['a']);
    escape(board);
    expect(pos(board, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(board.selection).toEqual(['b']);
    expect(board.history.canUndo).toBe(false);
  });

  it('does not move locked elements', () => {
    const board = setup();
    board.update('c', { locked: true });
    board.history.clear();
    board.select(['a', 'c']);
    // Ctrl: no snapping (locked elements still count as snap targets).
    drag(
      board,
      [
        { x: 50, y: 50 },
        { x: 80, y: 80 },
      ],
      { ctrl: true },
    );
    expect(pos(board, 'a')).toMatchObject({ x: 30, y: 30 });
    expect(pos(board, 'c')).toMatchObject({ x: 0, y: 300 });
  });
});

describe('BOARD-502: select tool, handles', () => {
  function handlePoint(board: Board, handle: string): Point {
    const frame = selectionFrame(board.selection.map((id) => board.getElement(id)!))!;
    return transformHandles(frame, ROTATE_HANDLE_OFFSET_PX).find((h) => h.handle === handle)!;
  }

  it('resizes with a corner handle, keeping the ratio with Shift', () => {
    const board = setup();
    board.select('a');
    drag(board, [handlePoint(board, 'se'), { x: 150, y: 120 }]);
    expect(pos(board, 'a')).toMatchObject({ x: 0, y: 0, w: 150, h: 120 });
    board.undo();
    drag(board, [handlePoint(board, 'se'), { x: 150, y: 120 }], { shift: true });
    expect(pos(board, 'a')).toMatchObject({ x: 0, y: 0, w: 150, h: 150 });
  });

  it('resizes several elements through their common frame', () => {
    const board = setup();
    board.select(['a', 'b']);
    drag(board, [handlePoint(board, 'e'), { x: 800, y: 50 }]);
    expect(pos(board, 'a')).toMatchObject({ x: 0, w: 200 });
    expect(pos(board, 'b')).toMatchObject({ x: 600, w: 200 });
  });

  it('rotates with the rotate handle and snaps to 15 degrees with Shift', () => {
    const board = setup();
    board.select('a');
    const start = handlePoint(board, 'rotate');
    // From straight above the center (50, 50) to its right: a quarter turn.
    drag(board, [start, { x: 50 + 74, y: 50 }]);
    expect(pos(board, 'a').rotation).toBeCloseTo(90);
    board.undo();
    const angle = ((-90 + 37) * Math.PI) / 180;
    drag(
      board,
      [
        handlePoint(board, 'rotate'),
        { x: 50 + Math.cos(angle) * 74, y: 50 + Math.sin(angle) * 74 },
      ],
      {
        shift: true,
      },
    );
    expect(pos(board, 'a').rotation).toBeCloseTo(30);
  });

  it('rolls back a resize on Esc', () => {
    const board = setup();
    board.select('a');
    drag(board, [handlePoint(board, 'se'), { x: 300, y: 300 }], {}, false);
    expect(pos(board, 'a').w).toBe(300);
    escape(board);
    expect(pos(board, 'a')).toMatchObject({ w: 100, h: 100 });
  });
});

describe('BOARD-502: navigation', () => {
  it('hand tool pans with a drag and restores the camera on Esc', () => {
    const board = setup();
    board.setTool('hand');
    drag(board, [
      { x: 100, y: 100 },
      { x: 140, y: 70 },
    ]);
    expect(board.camera.get()).toMatchObject({ x: -40, y: 30 });
    expect(board.history.canUndo).toBe(false);

    board.dispatch(pointer(board, 'pointer-down', { x: 0, y: 0 }));
    board.dispatch({
      ...pointer(board, 'pointer-move', { x: 0, y: 0 }),
      screen: { x: 300, y: 300 },
    });
    expect(board.toolState).toBe('panning');
    escape(board);
    expect(board.camera.get()).toMatchObject({ x: -40, y: 30 });
  });

  it('scrolls with the wheel and zooms with Ctrl+wheel or pinch around the pointer', () => {
    const board = setup();
    const wheel = (deltaX: number, deltaY: number, mods: Partial<InputModifiers> = {}) =>
      board.dispatch({
        type: 'wheel',
        point: { x: 0, y: 0 },
        screen: { x: 200, y: 100 },
        deltaX,
        deltaY,
        modifiers: { ...MODS, ...mods },
      });
    wheel(10, 20);
    expect(board.camera.get()).toMatchObject({ x: 10, y: 20, zoom: 1 });

    const anchor = board.camera.screenToBoard({ x: 200, y: 100 });
    wheel(0, -50, { ctrl: true });
    const zoom = board.camera.get().zoom;
    expect(zoom).toBeGreaterThan(1);
    const after = board.camera.screenToBoard({ x: 200, y: 100 });
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);

    board.dispatch({
      type: 'pinch',
      phase: 'update',
      point: anchor,
      screen: { x: 200, y: 100 },
      scale: 2,
      deltaX: 0,
      deltaY: 0,
    });
    expect(board.camera.get().zoom).toBeCloseTo(Math.min(zoom * 2, 4));
  });
});
