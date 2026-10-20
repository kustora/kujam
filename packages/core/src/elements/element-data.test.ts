import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  isResolveError,
  rect,
  schema,
  string,
  type BoardErrorEvent,
  type BoardResolvers,
  type ElementDataEvent,
} from '../index.js';

interface Item {
  readonly title: string;
  readonly status: string;
}

const card = defineElement({
  type: 'card',
  version: 1,
  props: schema({ itemId: string() }),
  defaults: { itemId: '' },
  geometry: (el) => rect(el.w, el.h),
  resolve: (el, ctx) => ctx.resolvers.item!(el.props.itemId) as Item | Promise<Item>,
});

const plain = defineElement({
  type: 'plain',
  version: 1,
  props: schema({ label: string() }),
  defaults: { label: '' },
});

function setup(resolvers: BoardResolvers) {
  const board = createBoard({
    plugins: [definePlugin({ id: 'cards', elements: [card, plain] })],
    resolvers,
  });
  const events: ElementDataEvent[] = [];
  const errors: BoardErrorEvent[] = [];
  board.on('data', (e) => events.push(e));
  board.on('error', (e) => errors.push(e));
  const add = (id: string, itemId: string) =>
    board.create({ id, type: 'card', x: 0, y: 0, w: 100, h: 60, props: { itemId } })!;
  return { board, events, errors, add };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('BOARD-604: resolve contract runtime', () => {
  it('resolves synchronous data, and elements without resolve are ready with no data', () => {
    const item = vi.fn((id: string) => ({ title: `Item ${id}`, status: 'published' }));
    const { board, add } = setup({ item });
    add('c1', 'p1');
    board.create({ id: 'x', type: 'plain', x: 0, y: 0, w: 10, h: 10 });

    expect(board.getElementData('c1')).toEqual({
      status: 'ready',
      data: { title: 'Item p1', status: 'published' },
    });
    // A data object with a `status` field is not mistaken for a ResolveError.
    expect(isResolveError({ title: 'x', status: 'error' })).toBe(false);
    expect(board.getElementData('x')).toEqual({ status: 'ready', data: undefined });
    board.getElementData('c1');
    expect(item).toHaveBeenCalledTimes(1);
  });

  it('async data: loading, then ready with one data event, sharing a request in flight', async () => {
    const item = vi.fn(async (id: string) => ({ title: id, status: 'draft' }));
    const { board, events, add } = setup({ item });
    add('c1', 'same');
    add('c2', 'same');

    expect(board.getElementData('c1')).toEqual({ status: 'loading' });
    expect(board.getElementData('c2')).toEqual({ status: 'loading' });
    expect(item).toHaveBeenCalledTimes(1);
    await flush();

    expect(board.getElementData('c1')).toMatchObject({ status: 'ready', data: { title: 'same' } });
    expect(board.getElementData('c2')).toMatchObject({ status: 'ready' });
    expect(events.flatMap((e) => e.ids).sort()).toEqual(['c1', 'c2']);
  });

  it('maps ResolveError values to placeholder statuses', () => {
    const { board, add } = setup({
      item: (id) =>
        id === 'secret'
          ? { status: 'forbidden' }
          : { status: 'not-found', message: 'Item dihapus' },
    });
    add('c1', 'secret');
    add('c2', 'gone');
    expect(board.getElementData('c1')).toEqual({ status: 'forbidden' });
    expect(board.getElementData('c2')).toEqual({ status: 'not-found', message: 'Item dihapus' });
  });

  it('invalidating one ID out of 300 resets only the element that used it, in one event', () => {
    const item = vi.fn((id: string) => ({ title: id, status: 'published' }));
    const { board, events, add } = setup({ item });
    for (let i = 0; i < 300; i++) add(`c${i}`, `p${i}`);
    for (let i = 0; i < 300; i++) board.getElementData(`c${i}`);
    expect(item).toHaveBeenCalledTimes(300);

    board.invalidate('item', 'p42');
    expect(events).toEqual([{ ids: ['c42'] }]);
    for (let i = 0; i < 300; i++) board.getElementData(`c${i}`);
    expect(item).toHaveBeenCalledTimes(301);
    expect(item).toHaveBeenLastCalledWith('p42');

    // Without an ID, the whole resolver cache goes.
    events.length = 0;
    board.invalidate('item');
    expect(events).toHaveLength(1);
    expect(events[0]!.ids).toHaveLength(300);
  });

  it('a props change resolves again; moving the element does not', () => {
    const item = vi.fn((id: string) => ({ title: id, status: 'published' }));
    const { board, add } = setup({ item });
    add('c1', 'p1');
    board.getElementData('c1');

    board.update('c1', { x: 500, w: 300 });
    expect(board.getElementData('c1')).toMatchObject({ data: { title: 'p1' } });
    expect(item).toHaveBeenCalledTimes(1);

    board.update('c1', { props: { itemId: 'p2' } });
    expect(board.getElementData('c1')).toMatchObject({ data: { title: 'p2' } });
    expect(item).toHaveBeenCalledTimes(2);
  });

  it('failures become error states, are reported, and are not cached', async () => {
    let fail = true;
    const item = vi.fn(async (id: string) => {
      if (fail) throw new Error('server down');
      return { title: id, status: 'published' };
    });
    const { board, errors, add } = setup({ item });
    add('c1', 'p1');
    board.getElementData('c1');
    await flush();

    expect(board.getElementData('c1')).toEqual({ status: 'error', message: 'server down' });
    expect(errors.map((e) => e.code)).toEqual(['resolve-error']);

    fail = false;
    board.reloadElementData('c1');
    board.getElementData('c1');
    await flush();
    expect(board.getElementData('c1')).toMatchObject({ status: 'ready', data: { title: 'p1' } });
    expect(item).toHaveBeenCalledTimes(2);
  });

  it('an exception thrown by resolve only affects that element', () => {
    const { board, errors, add } = setup({
      item: (id) => {
        if (id === 'boom') throw new Error('bug');
        return { title: id, status: 'published' };
      },
    });
    add('c1', 'boom');
    add('c2', 'ok');
    expect(board.getElementData('c1')).toEqual({ status: 'error', message: 'bug' });
    expect(board.getElementData('c2')).toMatchObject({ status: 'ready' });
    expect(errors).toHaveLength(1);
  });

  it('a late result for a deleted or reset element is ignored', async () => {
    let release!: (v: Item) => void;
    const { board, events, add } = setup({
      item: () => new Promise<Item>((r) => (release = r)),
    });
    add('c1', 'p1');
    board.getElementData('c1');
    board.delete('c1');
    release({ title: 'late', status: 'published' });
    await flush();
    expect(events).toEqual([]);
  });
});
