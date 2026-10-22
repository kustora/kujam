import { describe, expect, it } from 'vitest';
import {
  array,
  createBoard,
  defineElement,
  definePlugin,
  schema,
  string,
  type Board,
  type Point,
  type ToolPointerEvent,
} from '@kujam/core';
import { frameElement } from '../elements/frame.js';
import { selectTool, type SelectToolData } from './select.js';

const feed = defineElement({
  type: 'feed',
  version: 1,
  props: schema({ itemIds: array(string()) }),
  defaults: { itemIds: [] },
  dropTarget: {
    accepts: (dropped) => dropped.type === 'item',
    onDrop(target, dropped, _point, ctx) {
      ctx.updateProps({ itemIds: [...target.props.itemIds, String(dropped.props.itemId)] });
      if (dropped.props.keep !== 'yes') ctx.removeDropped();
    },
  },
});

const item = defineElement({
  type: 'item',
  version: 1,
  props: schema({ itemId: string(), keep: string() }),
  defaults: { itemId: '', keep: 'no' },
});

function pointer(type: ToolPointerEvent['type'], point: Point): ToolPointerEvent {
  return {
    type,
    pointerId: 1,
    pointerType: 'mouse',
    point,
    screen: point,
    pressure: type === 'pointer-up' ? 0 : 0.5,
    tiltX: 0,
    tiltY: 0,
    button: 0,
    buttons: type === 'pointer-up' ? 0 : 1,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  } as ToolPointerEvent;
}

function drag(board: Board, from: Point, to: Point, check?: () => void): void {
  board.dispatch(pointer('pointer-down', from));
  board.dispatch(pointer('pointer-move', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }));
  board.dispatch(pointer('pointer-move', to));
  check?.();
  board.dispatch(pointer('pointer-up', to));
}

function setup() {
  const board = createBoard({
    plugins: [
      definePlugin({ id: 'feed', elements: [feed, item, frameElement], tools: [selectTool] }),
    ],
  });
  board.create({ id: 'feed', type: 'feed', x: 400, y: 0, w: 200, h: 300 });
  board.create({
    id: 'p1',
    type: 'item',
    x: 0,
    y: 0,
    w: 50,
    h: 50,
    props: { itemId: 'item-1' },
  });
  board.setTool('select');
  return board;
}

describe('BOARD-1208: select tool drops onto element drop targets', () => {
  it('highlights the accepting target while dragging over it', () => {
    const board = setup();
    let during: string | null | undefined;
    drag(board, { x: 25, y: 25 }, { x: 500, y: 100 }, () => {
      during = (board.toolData as SelectToolData | null)?.dropTargetId;
    });
    expect(during).toBe('feed');
    expect((board.toolData as SelectToolData | null)?.dropTargetId ?? null).toBeNull();
  });

  it('does not highlight when not over a target', () => {
    const board = setup();
    let during: string | null | undefined = 'unset';
    drag(board, { x: 25, y: 25 }, { x: 200, y: 200 }, () => {
      during = (board.toolData as SelectToolData | null)?.dropTargetId;
    });
    expect(during ?? null).toBeNull();
    expect(board.getElement('p1')).toMatchObject({ x: 175, y: 175 });
  });

  it('moves, runs onDrop, and removes the dropped element as one undo step', () => {
    const board = setup();
    drag(board, { x: 25, y: 25 }, { x: 500, y: 100 });

    expect(board.getElement('feed')!.props.itemIds).toEqual(['item-1']);
    expect(board.getElement('p1')).toBeUndefined();
    expect(board.selection).toEqual(['feed']);

    board.undo();
    expect(board.getElement('feed')!.props.itemIds).toEqual([]);
    // The move is undone together with the drop.
    expect(board.getElement('p1')).toMatchObject({ x: 0, y: 0 });
  });

  it('keeps the dropped element when onDrop does not remove it', () => {
    const board = setup();
    board.update('p1', { props: { keep: 'yes' } });
    drag(board, { x: 25, y: 25 }, { x: 500, y: 100 });
    expect(board.getElement('feed')!.props.itemIds).toEqual(['item-1']);
    // Kept where it was released (snapping may shift it slightly).
    expect(board.getElement('p1')!.x).toBeGreaterThan(400);
    expect(board.selection).toEqual(['p1']);
  });
});
