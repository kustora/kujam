// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createBoard,
  QUICK_CONNECT_OFFSET_PX,
  quickConnectHandles,
  type BindingRecord,
  type Board,
  type Point,
  type QuickConnectSide,
  type ToolPointerEvent,
} from '@kujam/core';
import { defaultElements, defaultTools } from '../index.js';
import { QUICK_CONNECT_GAP } from './quick-connect.js';

function setup(): Board {
  const board = createBoard({ plugins: [defaultElements, defaultTools], snap: { grid: null } });
  board.camera.setViewport({ width: 1200, height: 900 });
  board.setTool('select');
  return board;
}

function pointer(board: Board, type: ToolPointerEvent['type'], point: Point): ToolPointerEvent {
  return {
    type,
    pointerId: 1,
    pointerType: 'mouse',
    point,
    screen: board.camera.boardToScreen(point),
    pressure: type === 'pointer-up' ? 0 : 0.5,
    tiltX: 0,
    tiltY: 0,
    button: 0,
    buttons: type === 'pointer-up' ? 0 : 1,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

/** Board position of a quick-connect dot of the lone selected element. */
function dot(board: Board, side: QuickConnectSide): Point {
  const el = board.getElement(board.selection[0]!)!;
  const zoom = board.camera.get().zoom;
  return quickConnectHandles(el, QUICK_CONNECT_OFFSET_PX / zoom).find((h) => h.side === side)!;
}

function bindingsOf(board: Board, connectorId: string): BindingRecord[] {
  return Object.values(board.getDocument().records).filter(
    (r): r is BindingRecord => r.kind === 'binding' && r.fromId === connectorId,
  );
}

describe('Quick connect from the select tool', () => {
  it('clicking a dot places a connected copy on that side, in one undo step', () => {
    const board = setup();
    const a = board.create({
      type: 'sticky',
      x: 100,
      y: 100,
      w: 192,
      h: 144,
      props: { text: [{ insert: 'A\n' }], color: 'green' },
    })!;
    board.select(a.id);

    const p = dot(board, 'right');
    board.dispatch(pointer(board, 'pointer-down', p));
    board.dispatch(pointer(board, 'pointer-up', p));

    const copy = board.getElement(board.selection[0]!)!;
    expect(copy.id).not.toBe(a.id);
    expect(copy).toMatchObject({ type: 'sticky', x: 100 + 192 + QUICK_CONNECT_GAP, y: 100 });
    // Same style, empty text
    expect(copy.props).toMatchObject({ color: 'green', text: [{ insert: '\n' }] });

    const connector = board.query({ type: 'connector' })[0]!;
    const bindings = bindingsOf(board, connector.id);
    expect(bindings.map((b) => [b.toId, b.anchor])).toEqual([
      [a.id, { x: 1, y: 0.5 }],
      [copy.id, { x: 0, y: 0.5 }],
    ]);

    board.undo();
    expect(board.query().map((el) => el.id)).toEqual([a.id]);
  });

  it('dragging from a dot to another shape binds both ends and selects the connector', () => {
    const board = setup();
    const a = board.create({
      type: 'geo',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { geo: 'rectangle' },
    })!;
    const b = board.create({
      type: 'geo',
      x: 500,
      y: 100,
      w: 100,
      h: 100,
      props: { geo: 'ellipse' },
    })!;
    board.select(a.id);

    const p = dot(board, 'right');
    board.dispatch(pointer(board, 'pointer-down', p));
    board.dispatch(pointer(board, 'pointer-move', { x: 400, y: 150 }));
    expect(board.toolState).toBe('quick-connecting');
    expect((board.toolData as { connectorPreview?: unknown }).connectorPreview).toBeDefined();
    board.dispatch(pointer(board, 'pointer-move', { x: 502, y: 150 }));
    board.dispatch(pointer(board, 'pointer-up', { x: 502, y: 150 }));

    const connector = board.getElement(board.selection[0]!)!;
    expect(connector.type).toBe('connector');
    expect(bindingsOf(board, connector.id).map((r) => r.toId)).toEqual([a.id, b.id]);
    expect(board.query({ type: 'geo' })).toHaveLength(2);
  });

  it('dragging to empty space leaves the end free', () => {
    const board = setup();
    const a = board.create({
      type: 'geo',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { geo: 'rectangle' },
    })!;
    board.select(a.id);

    const p = dot(board, 'bottom');
    board.dispatch(pointer(board, 'pointer-down', p));
    board.dispatch(pointer(board, 'pointer-move', { x: 150, y: 500 }));
    board.dispatch(pointer(board, 'pointer-up', { x: 150, y: 500 }));

    const connector = board.getElement(board.selection[0]!)!;
    expect(bindingsOf(board, connector.id).map((r) => r.toId)).toEqual([a.id]);
    expect(connector.props).toMatchObject({ endBindingId: null });
  });

  it('shows no dots for connectors, locked elements, or several selected elements', () => {
    const board = setup();
    const a = board.create({
      type: 'geo',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { geo: 'rectangle' },
    })!;
    const b = board.create({
      type: 'geo',
      x: 400,
      y: 100,
      w: 100,
      h: 100,
      props: { geo: 'rectangle' },
    })!;
    board.select(a.id);
    const p = dot(board, 'right');

    board.select([a.id, b.id]);
    board.dispatch(pointer(board, 'pointer-down', p));
    expect(board.toolState).not.toBe('quick-connecting');
    board.dispatch(pointer(board, 'pointer-up', p));

    board.update(a.id, { locked: true });
    board.select(a.id);
    board.dispatch(pointer(board, 'pointer-down', p));
    expect(board.toolState).not.toBe('quick-connecting');
  });
});
