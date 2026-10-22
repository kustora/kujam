import { describe, expect, it, vi } from 'vitest';
import {
  array,
  createBoard,
  defineElement,
  definePlugin,
  dropOnTarget,
  ElementDefinitionError,
  findDropTarget,
  schema,
  string,
  type BoardErrorEvent,
  type ElementDropTarget,
} from '../index.js';

type FeedProps = { itemIds: string[] };

function feedElement(dropTarget: ElementDropTarget<FeedProps>) {
  return defineElement({
    type: 'feed',
    version: 1,
    props: schema({ itemIds: array(string()) }),
    defaults: { itemIds: [] },
    dropTarget,
  });
}

const item = defineElement({
  type: 'item',
  version: 1,
  props: schema({ itemId: string() }),
  defaults: { itemId: '' },
});

const note = defineElement({
  type: 'note',
  version: 1,
  props: schema({}),
});

const absorbing: ElementDropTarget<FeedProps> = {
  accepts: (dropped) => dropped.type === 'item',
  onDrop(target, dropped, _point, ctx) {
    ctx.updateProps({ itemIds: [...target.props.itemIds, String(dropped.props.itemId)] });
    ctx.removeDropped();
  },
};

function setup(dropTarget: ElementDropTarget<FeedProps> = absorbing) {
  const board = createBoard({
    plugins: [definePlugin({ id: 'feed', elements: [feedElement(dropTarget), item, note] })],
  });
  const errors: BoardErrorEvent[] = [];
  board.on('error', (e) => errors.push(e));
  const feed = board.create({ id: 'feed', type: 'feed', x: 0, y: 0, w: 300, h: 400 })!;
  const p1 = board.create({
    id: 'p1',
    type: 'item',
    x: 100,
    y: 100,
    w: 50,
    h: 50,
    props: { itemId: 'item-1' },
  })!;
  const p2 = board.create({
    id: 'p2',
    type: 'item',
    x: 120,
    y: 120,
    w: 50,
    h: 50,
    props: { itemId: 'item-2' },
  })!;
  const n1 = board.create({ id: 'n1', type: 'note', x: 110, y: 110, w: 20, h: 20 })!;
  return { board, errors, feed, p1, p2, n1 };
}

describe('BOARD-1208: element drop targets', () => {
  it('validates the dropTarget contract in defineElement', () => {
    expect(() =>
      defineElement({
        type: 'bad',
        version: 1,
        props: schema({}),
        dropTarget: { accepts: () => true } as never,
      }),
    ).toThrow(ElementDefinitionError);
    expect(() =>
      defineElement({ type: 'bad', version: 1, props: schema({}), dropTarget: 1 as never }),
    ).toThrow(/dropTarget/);
  });

  it('finds the target under the point only for accepted elements', () => {
    const { board, feed } = setup();
    expect(findDropTarget(board, ['p1'], { x: 150, y: 150 })?.id).toBe(feed.id);
    expect(findDropTarget(board, ['n1'], { x: 150, y: 150 })).toBeUndefined();
    expect(findDropTarget(board, ['p1'], { x: 500, y: 500 })).toBeUndefined();
    // The dragged element itself is never its own target.
    expect(findDropTarget(board, ['feed'], { x: 150, y: 150 })).toBeUndefined();
  });

  it('skips locked, forbidden, and read-only targets', () => {
    const { board, feed } = setup();
    board.update(feed.id, { locked: true });
    expect(findDropTarget(board, ['p1'], { x: 150, y: 150 })).toBeUndefined();
    board.update(feed.id, { locked: false }, { force: true });
    board.setReadOnly(true);
    expect(findDropTarget(board, ['p1'], { x: 150, y: 150 })).toBeUndefined();

    const guarded = createBoard({
      plugins: [definePlugin({ id: 'feed', elements: [feedElement(absorbing), item] })],
      permissions: (action, el) => !(action === 'update' && el?.type === 'feed'),
    });
    guarded.create({ id: 'feed', type: 'feed', x: 0, y: 0, w: 300, h: 400 });
    guarded.create({ id: 'p1', type: 'item', x: 10, y: 10, w: 10, h: 10 });
    expect(findDropTarget(guarded, ['p1'], { x: 15, y: 15 })).toBeUndefined();
  });

  it('updates the target and removes dropped elements in one transaction and undo step', () => {
    const { board, feed } = setup();
    const changes = vi.fn();
    board.on('change', changes);

    const result = dropOnTarget(board, ['p1', 'p2', 'n1'], { x: 150, y: 150 });

    expect(result).toEqual({
      targetId: feed.id,
      acceptedIds: ['p1', 'p2'],
      removedIds: ['p1', 'p2'],
    });
    expect(board.getElement(feed.id)!.props.itemIds).toEqual(['item-1', 'item-2']);
    expect(board.getElement('p1')).toBeUndefined();
    expect(board.getElement('p2')).toBeUndefined();
    expect(board.getElement('n1')).toBeDefined();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes.mock.calls[0]![0].label).toBe('element.drop');

    expect(board.undo()).toBe(true);
    expect(board.getElement(feed.id)!.props.itemIds).toEqual([]);
    expect(board.getElement('p1')).toBeDefined();
    expect(board.getElement('p2')).toBeDefined();
  });

  it('keeps the dropped element when onDrop does not remove it', () => {
    const point = vi.fn();
    const { board, feed } = setup({
      accepts: () => true,
      onDrop(target, dropped, at, ctx) {
        point(at);
        ctx.updateProps({ itemIds: [...target.props.itemIds, dropped.id] });
      },
    });
    const result = dropOnTarget(board, ['p1'], { x: 150, y: 160 });
    expect(result?.removedIds).toEqual([]);
    expect(board.getElement('p1')).toBeDefined();
    expect(board.getElement(feed.id)!.props.itemIds).toEqual(['p1']);
    expect(point).toHaveBeenCalledWith({ x: 150, y: 160 });
  });

  it('isolates errors: a throwing onDrop rolls back the whole drop and emits plugin-error', () => {
    const { board, feed, errors } = setup({
      accepts: () => true,
      onDrop(target, dropped, _at, ctx) {
        ctx.updateProps({ itemIds: [...target.props.itemIds, dropped.id] });
        if (dropped.id === 'p2') throw new Error('boom');
      },
    });
    expect(() => dropOnTarget(board, ['p1', 'p2'], { x: 150, y: 150 })).not.toThrow();
    expect(dropOnTarget(board, ['p1', 'p2'], { x: 150, y: 150 })).toBeNull();
    expect(board.getElement(feed.id)!.props.itemIds).toEqual([]);
    expect(errors.some((e) => e.code === 'plugin-error' && /boom/.test(e.message))).toBe(true);
    expect(board.history.canUndo).toBe(true); // only the setup creations
  });

  it('treats a throwing accepts as not accepted', () => {
    const { board, errors } = setup({
      accepts: () => {
        throw new Error('nope');
      },
      onDrop: () => {},
    });
    expect(findDropTarget(board, ['p1'], { x: 150, y: 150 })).toBeUndefined();
    expect(errors).toHaveLength(0);
    expect(dropOnTarget(board, ['p1'], { x: 150, y: 150 })).toBeNull();
    expect(errors[0]?.code).toBe('plugin-error');
  });

  it('picks the topmost accepting target', () => {
    const { board } = setup();
    board.create({ id: 'feed2', type: 'feed', x: 100, y: 100, w: 100, h: 100 });
    expect(findDropTarget(board, ['p1'], { x: 150, y: 150 })?.id).toBe('feed2');
    expect(findDropTarget(board, ['p1'], { x: 20, y: 20 })?.id).toBe('feed');
  });
});
