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
  elementsInLasso,
  LASSO_MIN_POINT_DISTANCE_PX,
  MAX_LASSO_POINTS,
  type LassoToolData,
  type SelectToolData,
} from '../index.js';

const MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

/**
 * "C" shaped lasso around x 0..400, y 0..400 that opens to the right: its notch covers
 * x 100..400, y 100..300.
 */
const C_LASSO: Point[] = [
  { x: -10, y: -10 },
  { x: 400, y: -10 },
  { x: 400, y: 100 },
  { x: 100, y: 100 },
  { x: 100, y: 300 },
  { x: 400, y: 300 },
  { x: 400, y: 410 },
  { x: -10, y: 410 },
];

/**
 * Board at zoom 1 with rectangles `top` (inside the C's top bar), `notch` (inside the notch, so
 * its box is within the lasso bounds but outside the lasso), `across` (half in, half out of the
 * notch), a polyline `line` inside the C's left bar, and a locked `locked` in the bottom bar.
 */
function setup(): Board {
  const board = createBoard({ plugins: [defaultElements, defaultTools], snap: { grid: null } });
  board.camera.setViewport({ width: 1000, height: 1000 });
  board.create({ id: 'top', type: 'geo', x: 150, y: 20, w: 100, h: 40 });
  board.create({ id: 'notch', type: 'geo', x: 200, y: 150, w: 100, h: 100 });
  board.create({ id: 'across', type: 'geo', x: 50, y: 150, w: 100, h: 50 });
  board.create({
    id: 'line',
    type: 'line',
    x: 20,
    y: 120,
    w: 40,
    h: 160,
    props: {
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 80 },
        { x: 0, y: 160 },
      ],
    },
  });
  board.create({ id: 'locked', type: 'geo', x: 150, y: 340, w: 50, h: 40, locked: true });
  board.history.clear();
  return board;
}

function pointer(
  board: Board,
  type: ToolPointerEvent['type'],
  point: Point,
  mods: Partial<InputModifiers> = {},
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
  };
}

/** Press at the first point, move through the rest, and release unless `release` is false. */
function lasso(
  board: Board,
  points: readonly Point[],
  mods: Partial<InputModifiers> = {},
  release = true,
): void {
  board.dispatch(pointer(board, 'pointer-down', points[0]!, mods));
  for (const p of points.slice(1)) board.dispatch(pointer(board, 'pointer-move', p, mods));
  if (release) board.dispatch(pointer(board, 'pointer-up', points[points.length - 1]!, mods));
}

const data = (board: Board) => board.toolData as LassoToolData;

describe('BOARD-910: elementsInLasso', () => {
  it('selects by element contour inside a concave polygon, including lines', () => {
    const board = setup();
    expect(elementsInLasso(board, C_LASSO, false).sort()).toEqual(['line', 'top']);
    expect(elementsInLasso(board, C_LASSO, true).sort()).toEqual(['across', 'line', 'top']);
    expect(elementsInLasso(board, C_LASSO.slice(0, 2), true)).toEqual([]);
  });

  it('only counts a line as touched when the lasso reaches its stroke, not its bounding box', () => {
    const board = setup();
    // Triangle inside the line's bounding box (x 20..60, y 120..280), left of its bend.
    const pocket: Point[] = [
      { x: 18, y: 190 },
      { x: 30, y: 200 },
      { x: 18, y: 210 },
    ];
    expect(elementsInLasso(board, pocket, true)).toEqual([]);
    // Reaching the second segment just below the bend at (60, 200).
    const reach: Point[] = [
      { x: 50, y: 205 },
      { x: 70, y: 210 },
      { x: 50, y: 215 },
    ];
    expect(elementsInLasso(board, reach, true)).toEqual(['line']);
  });

  it('applies element rotation', () => {
    const board = setup();
    // 100×20 bar centered at (500, 500), rotated upright: x 490..510, y 450..550.
    board.create({ id: 'bar', type: 'geo', x: 450, y: 490, w: 100, h: 20, rotation: 90 });
    const upright: Point[] = [
      { x: 485, y: 445 },
      { x: 515, y: 445 },
      { x: 515, y: 555 },
      { x: 485, y: 555 },
    ];
    expect(elementsInLasso(board, upright, false)).toEqual(['bar']);
    board.update('bar', { rotation: 0 });
    expect(elementsInLasso(board, upright, false)).toEqual([]);
  });
});

describe('BOARD-910: lasso tool', () => {
  it('draws a free-form polygon and selects the fully covered elements', () => {
    const board = setup();
    board.setTool('lasso');
    lasso(board, C_LASSO, {}, false);
    expect(data(board).lasso).toEqual(C_LASSO);
    expect([...board.selection].sort()).toEqual(['line', 'top']);
    board.dispatch(pointer(board, 'pointer-up', C_LASSO[C_LASSO.length - 1]!));
    expect(data(board).lasso).toBeNull();
    expect([...board.selection].sort()).toEqual(['line', 'top']);
    // Selecting changes no document state, so there is nothing to undo.
    expect(board.history.canUndo).toBe(false);
  });

  it('selects touched elements with Alt, never locked ones', () => {
    const board = setup();
    board.setTool('lasso');
    lasso(board, C_LASSO, { alt: true });
    expect([...board.selection].sort()).toEqual(['across', 'line', 'top']);
  });

  it('adds to the selection with Shift and replaces it otherwise', () => {
    const board = setup();
    board.select('notch');
    board.setTool('lasso');
    lasso(board, C_LASSO, { shift: true });
    expect([...board.selection].sort()).toEqual(['line', 'notch', 'top']);
    lasso(board, C_LASSO);
    expect([...board.selection].sort()).toEqual(['line', 'top']);
  });

  it('restores the selection from before the drag on Esc', () => {
    const board = setup();
    board.select('notch');
    board.setTool('lasso');
    lasso(board, C_LASSO, {}, false);
    expect([...board.selection].sort()).toEqual(['line', 'top']);
    board.dispatch({
      type: 'key-down',
      key: 'Escape',
      code: 'Escape',
      repeat: false,
      modifiers: MODS,
    });
    expect(board.selection).toEqual(['notch']);
    expect(data(board).lasso).toBeNull();
  });

  it('skips points closer than the minimum screen distance and caps the point count', () => {
    const board = setup();
    board.setTool('lasso');
    const step = LASSO_MIN_POINT_DISTANCE_PX / 2;
    lasso(
      board,
      [
        { x: 0, y: 0 },
        { x: step, y: 0 },
        { x: 2 * step, y: 0 },
      ],
      {},
      false,
    );
    expect(data(board).lasso).toHaveLength(2);
    for (let i = 0; i < MAX_LASSO_POINTS + 50; i++) {
      board.dispatch(pointer(board, 'pointer-move', { x: 10 + i * 4, y: (i % 2) * 4 }));
    }
    expect(data(board).lasso).toHaveLength(MAX_LASSO_POINTS);
  });
});

describe('BOARD-910: Ctrl/Cmd+drag in the select tool', () => {
  it.each([{ ctrl: true }, { meta: true }])('draws a lasso on empty space with %o', (mods) => {
    const board = setup();
    board.setTool('select');
    lasso(board, C_LASSO, mods, false);
    const d = board.toolData as SelectToolData;
    expect(d.brush).toBeNull();
    expect(d.lasso).toEqual(C_LASSO);
    expect([...board.selection].sort()).toEqual(['line', 'top']);
    board.dispatch(pointer(board, 'pointer-up', C_LASSO[C_LASSO.length - 1]!, mods));
    expect((board.toolData as SelectToolData).lasso).toBeNull();
    expect([...board.selection].sort()).toEqual(['line', 'top']);
  });

  it('keeps the plain drag as a selection box', () => {
    const board = setup();
    board.setTool('select');
    lasso(board, [...C_LASSO, { x: 420, y: 420 }], {}, false);
    const d = board.toolData as SelectToolData;
    expect(d.lasso).toBeNull();
    expect(d.brush).not.toBeNull();
    // The box spans the whole C, so the notch element is inside it too.
    expect(board.selection).toContain('notch');
  });
});
