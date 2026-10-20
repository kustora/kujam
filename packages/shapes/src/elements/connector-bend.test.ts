// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createBoard,
  segmentHandles,
  type BindingRecord,
  type Board,
  type ElementRecord,
  type Point,
  type ToolPointerEvent,
} from '@kujam/core';
import {
  computeConnectorRoute,
  computeElementConnectorRoute,
  connectorElement,
  defaultElements,
  defaultTools,
  type ConnectorProps,
} from '../index.js';

function setup(): Board {
  const board = createBoard({ plugins: [defaultElements, defaultTools], snap: { grid: null } });
  board.camera.setViewport({ width: 1200, height: 900 });
  board.setTool('select');
  return board;
}

function pointer(
  board: Board,
  type: ToolPointerEvent['type'],
  point: Point,
  buttons = type === 'pointer-up' ? 0 : 1,
): ToolPointerEvent {
  return {
    type,
    pointerId: 1,
    pointerType: 'mouse',
    point,
    screen: board.camera.boardToScreen(point),
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    button: 0,
    buttons,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

/** Two stickies joined right side to left side by a bound elbow connector. */
function connected(board: Board): Readonly<ElementRecord<ConnectorProps>> {
  board.create({ id: 'a', type: 'sticky', x: 0, y: 0, w: 200, h: 100 });
  board.create({ id: 'b', type: 'sticky', x: 500, y: 300, w: 200, h: 100 });
  board.transact((tx) => {
    tx.put({
      ...board.getElement('a')!,
      id: 'c',
      type: 'connector',
      x: 200,
      y: 50,
      w: 300,
      h: 300,
      index: 'a9',
      props: {
        ...connectorElement.defaults,
        start: { x: 0, y: 0 },
        end: { x: 300, y: 300 },
        startBindingId: 'bs',
        endBindingId: 'be',
      },
    } as ElementRecord);
    tx.put({
      id: 'bs',
      kind: 'binding',
      fromId: 'c',
      toId: 'a',
      anchor: { x: 1, y: 0.5 },
    } as BindingRecord);
    tx.put({
      id: 'be',
      kind: 'binding',
      fromId: 'c',
      toId: 'b',
      anchor: { x: 0, y: 0.5 },
    } as BindingRecord);
  });
  board.history.clear();
  return board.getElement('c') as Readonly<ElementRecord<ConnectorProps>>;
}

function worldRoute(board: Board): Point[] {
  const c = board.getElement('c') as ElementRecord<ConnectorProps>;
  return computeElementConnectorRoute(c, board).points.map((p) => ({ x: c.x + p.x, y: c.y + p.y }));
}

describe('Flexible elbow connectors', () => {
  it('new connectors are elbow by default', () => {
    expect(connectorElement.defaults.style).toBe('elbow');
  });

  it('a bend places the middle segment at an offset from the midpoint between the ends', () => {
    const route = computeConnectorRoute({ x: 0, y: 0 }, { x: 300, y: 200 }, 'elbow', {
      bend: { axis: 'x', offset: 50 },
    });
    expect(route.points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 300, y: 200 },
    ]);
  });

  it('keeps the bent segment outside the bound sides', () => {
    // Leaves rightwards and enters from the left: the vertical segment stays between the stubs.
    const route = computeConnectorRoute({ x: 0, y: 0 }, { x: 300, y: 200 }, 'elbow', {
      startSide: 'right',
      endSide: 'left',
      bend: { axis: 'x', offset: 1000 },
    });
    const xs = route.points.map((p) => p.x);
    expect(Math.max(...xs)).toBe(300);
    expect(route.points.at(-2)).toEqual({ x: 284, y: 200 });
  });

  it('segmentHandles marks the inner segments with the axis they move along', () => {
    const handles = segmentHandles([
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 200 },
      { x: 300, y: 200 },
    ]);
    expect(handles).toEqual([{ index: 1, axis: 'x', x: 16, y: 100 }]);
  });

  it('dragging the middle segment stores a bend, in one undo step, and it follows moved shapes', () => {
    const board = setup();
    connected(board);
    board.select('c');

    const before = worldRoute(board);
    const [handle] = segmentHandles(
      before.map((p) => board.camera.boardToScreen(p)),
      32,
    );
    expect(handle?.axis).toBe('x');
    const start = board.camera.screenToBoard(handle!);

    board.dispatch(pointer(board, 'pointer-down', start));
    expect(board.toolState).toBe('bending');
    board.dispatch(pointer(board, 'pointer-move', { x: start.x - 100, y: start.y }));
    board.dispatch(pointer(board, 'pointer-up', { x: start.x - 100, y: start.y }));

    const c = board.getElement('c') as ElementRecord<ConnectorProps>;
    expect(c.props.bend).toEqual({ axis: 'x', offset: start.x - 100 - 350 });
    const bentX = worldRoute(board)[2]!.x;
    expect(bentX).toBeCloseTo(start.x - 100);

    // Moving the target moves the midpoint, and the bent segment with it.
    board.update('b', { x: 600 });
    expect(worldRoute(board)[2]!.x).toBeCloseTo(bentX + 50);

    board.undo();
    board.undo();
    expect((board.getElement('c') as ElementRecord<ConnectorProps>).props.bend).toBeUndefined();
  });

  it('the hover cursor follows the handle under the pointer', () => {
    const board = setup();
    connected(board);
    board.select('c');
    const [handle] = segmentHandles(
      worldRoute(board).map((p) => board.camera.boardToScreen(p)),
      32,
    );
    board.dispatch(pointer(board, 'pointer-move', board.camera.screenToBoard(handle!), 0));
    expect(board.cursor).toBe('ew-resize');

    board.dispatch(pointer(board, 'pointer-move', { x: 900, y: 800 }, 0));
    expect(board.cursor).toBe('default');
  });
});
