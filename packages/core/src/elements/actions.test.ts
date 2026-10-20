import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  rect,
  schema,
  string,
  type ActionEvent,
  type BoardErrorEvent,
} from '../index.js';

const card = defineElement({
  type: 'card',
  version: 1,
  props: schema({ itemId: string(), tone: string() }),
  defaults: { itemId: '', tone: 'calm' },
  geometry: (el) => rect(el.w, el.h),
  resolve: (el, ctx) => ctx.resolvers.item!(el.props.itemId) as { title: string },
  actions: (el, data, ctx) => [
    {
      id: 'card.open',
      label: data ? `Buka ${data.title}` : 'Buka',
      icon: 'open',
      group: 'card',
      run: () => ctx.emit('open-item', { itemId: el.props.itemId }),
    },
    {
      id: `card.only-${el.id}`,
      label: 'Hanya untuk elemen ini',
      run: () => {},
    },
    {
      id: 'card.loud',
      label: 'Keras',
      isEnabled: () => el.props.tone !== 'loud',
      run: () => ctx.updateProps({ tone: 'loud' }),
    },
  ],
});

const broken = defineElement({
  type: 'broken',
  version: 1,
  props: schema({}),
  actions: () => {
    throw new Error('bug in actions');
  },
});

function setup(can?: (action: string) => boolean) {
  const board = createBoard({
    plugins: [definePlugin({ id: 'cards', elements: [card, broken] })],
    resolvers: { item: (id) => ({ title: `Item ${id}` }) },
    ...(can ? { permissions: (action: string) => can(action) } : {}),
  });
  const actions: ActionEvent[] = [];
  const errors: BoardErrorEvent[] = [];
  board.on('action', (e) => actions.push(e));
  board.on('error', (e) => errors.push(e));
  for (const id of ['a', 'b']) {
    board.create({ id, type: 'card', x: 0, y: 0, w: 100, h: 60, props: { itemId: id } });
  }
  return { board, actions, errors };
}

describe('BOARD-605: actions contract', () => {
  it('passes resolved data and returns { id, label, icon, group, isEnabled, run }', () => {
    const { board } = setup();
    const [open] = board.getActions('a');
    expect(open).toMatchObject({
      id: 'card.open',
      label: 'Buka Item a',
      icon: 'open',
      group: 'card',
    });
  });

  it('merges a multi-selection to the actions every element offers', () => {
    const { board } = setup();
    expect(board.getActions(['a', 'b']).map((a) => a.id)).toEqual(['card.open', 'card.loud']);
  });

  it('ctx.emit raises an action event for the application', () => {
    const { board, actions } = setup();
    board
      .getActions('a')
      .find((a) => a.id === 'card.open')!
      .run();
    expect(actions).toEqual([{ name: 'open-item', payload: { itemId: 'a' } }]);
  });

  it('checks the permission hook before running', () => {
    const can = vi.fn((action: string) => action !== 'action');
    const { board } = setup(can);
    const loud = board.getActions(['a', 'b']).find((a) => a.id === 'card.loud')!;
    loud.run();
    expect(board.getElement('a')!.props.tone).toBe('calm');
    expect(can).toHaveBeenCalledWith('action');
  });

  it('a throwing actions() only costs that element its actions', () => {
    const { board, errors } = setup();
    board.create({ id: 'x', type: 'broken', x: 0, y: 0, w: 10, h: 10 });
    expect(board.getActions('x')).toEqual([]);
    expect(board.getActions('a').length).toBeGreaterThan(0);
    expect(errors.map((e) => e.code)).toEqual(['action-error']);
  });
});
