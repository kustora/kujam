import { describe, expect, it } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  enumOf,
  schema,
  string,
  type BoardErrorEvent,
  type ToolStyleEvent,
} from '../index.js';

const COLORS = ['yellow', 'pink', 'blue'] as const;

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: schema({ text: string(), color: enumOf(COLORS) }),
  defaults: { text: '', color: 'yellow' },
  actions: (el, _data, ctx) => [
    ...COLORS.map((color) => ({
      id: `style.color.${color}`,
      label: color,
      group: 'style.color',
      isActive: () => el.props.color === color,
      run: () => {
        ctx.updateProps({ color });
        ctx.toolStyles.set('note', { color });
      },
    })),
    { id: `only.${el.id}`, label: 'Only this', run: () => {} },
  ],
});

const plainElement = defineElement({ type: 'plain', version: 1, props: schema({}) });

const plugin = definePlugin({ id: 'notes', elements: [noteElement, plainElement] });

function setup(options: Parameters<typeof createBoard>[0] = {}) {
  const board = createBoard({ plugins: [plugin], ...options });
  const a = board.create({ id: 'a', type: 'note', x: 0, y: 0, w: 10, h: 10 })!;
  const b = board.create({ id: 'b', type: 'note', x: 20, y: 0, w: 10, h: 10 })!;
  return { board, a, b };
}

describe('BOARD-1108: board.toolStyles', () => {
  it('starts empty, merges patches, removes undefined keys, and emits tool-style', () => {
    const board = createBoard();
    const events: ToolStyleEvent[] = [];
    board.on('tool-style', (e) => events.push(e));
    const empty = board.toolStyles.get('sticky');
    expect(empty).toEqual({});
    expect(Object.isFrozen(empty)).toBe(true);

    board.toolStyles.set('sticky', { color: 'pink' });
    board.toolStyles.set('draw', { color: 'red', thickness: 8 });
    board.toolStyles.set('draw', { thickness: undefined, brush: 'highlighter' });
    expect(board.toolStyles.get('sticky')).toEqual({ color: 'pink' });
    expect(board.toolStyles.get('draw')).toEqual({ color: 'red', brush: 'highlighter' });
    expect(events.map((e) => [e.toolId, e.style])).toEqual([
      ['sticky', { color: 'pink' }],
      ['draw', { color: 'red', thickness: 8 }],
      ['draw', { color: 'red', brush: 'highlighter' }],
    ]);
    expect(events[2]!.previous).toEqual({ color: 'red', thickness: 8 });
    expect(Object.isFrozen(events[2]!.style)).toBe(true);
  });

  it('keeps the same object and emits nothing when the patch changes nothing', () => {
    const board = createBoard();
    board.toolStyles.set('sticky', { color: 'pink' });
    const style = board.toolStyles.get('sticky');
    let count = 0;
    board.on('tool-style', () => count++);
    board.toolStyles.set('sticky', { color: 'pink', missing: undefined });
    expect(board.toolStyles.get('sticky')).toBe(style);
    expect(count).toBe(0);
  });

  it('is session state: not in the document or history, kept across loadDocument, allowed read-only', () => {
    const board = createBoard({ readOnly: true });
    const before = board.getDocument();
    board.toolStyles.set('sticky', { color: 'blue' });
    expect(board.getDocument()).toBe(before);
    expect(board.history.canUndo).toBe(false);
    board.loadDocument(before);
    expect(board.toolStyles.get('sticky')).toEqual({ color: 'blue' });
  });

  it('rejects invalid tool IDs, patches, and values without changing the style', () => {
    const board = createBoard();
    board.toolStyles.set('draw', { thickness: 4 });
    expect(() => board.toolStyles.get('')).toThrow(TypeError);
    expect(() => board.toolStyles.set('draw', null as never)).toThrow(TypeError);
    expect(() => board.toolStyles.set('draw', { thickness: Number.NaN })).toThrow(TypeError);
    expect(() => board.toolStyles.set('draw', { color: 'red', points: [] as never })).toThrow(
      TypeError,
    );
    expect(board.toolStyles.get('draw')).toEqual({ thickness: 4 });
  });

  it('keeps keys such as __proto__ as own keys', () => {
    const board = createBoard();
    board.toolStyles.set('x', JSON.parse('{"__proto__": "a"}') as Record<string, string>);
    expect(Object.keys(board.toolStyles.get('x'))).toEqual(['__proto__']);
  });
});

describe('BOARD-1108: board.getActions', () => {
  it('returns the actions of the selection, with isActive', () => {
    const { board } = setup();
    board.select('a');
    const actions = board.getActions();
    expect(actions.map((a) => a.id)).toEqual([
      'style.color.yellow',
      'style.color.pink',
      'style.color.blue',
      'only.a',
    ]);
    expect(actions[0]).toMatchObject({ label: 'yellow', group: 'style.color' });
    expect(actions.map((a) => a.isActive?.())).toEqual([true, false, false, undefined]);
    expect(actions.every((a) => a.isEnabled?.())).toBe(true);
  });

  it('keeps only the actions every element provides', () => {
    const { board } = setup();
    expect(board.getActions(['a', 'b']).map((a) => a.id)).toEqual([
      'style.color.yellow',
      'style.color.pink',
      'style.color.blue',
    ]);
    board.create({ id: 'p', type: 'plain', x: 0, y: 0, w: 1, h: 1 });
    expect(board.getActions(['a', 'p'])).toEqual([]);
    expect(board.getActions([])).toEqual([]);
    expect(board.getActions(['missing'])).toEqual([]);
    expect(() => board.getActions([1] as never)).toThrow(TypeError);
  });

  it('applies a style to several elements in one undo step and remembers it for the tool', () => {
    const { board } = setup();
    board.select(['a', 'b']);
    const pink = board.getActions().find((a) => a.id === 'style.color.pink')!;
    expect(pink.isActive?.()).toBe(false);
    pink.run();
    expect(board.getElement('a')!.props.color).toBe('pink');
    expect(board.getElement('b')!.props.color).toBe('pink');
    expect(board.toolStyles.get('note')).toEqual({ color: 'pink' });
    expect(
      board
        .getActions()
        .find((a) => a.id === 'style.color.pink')!
        .isActive?.(),
    ).toBe(true);

    board.undo();
    expect(board.getElement('a')!.props.color).toBe('yellow');
    expect(board.getElement('b')!.props.color).toBe('yellow');
    expect(board.history.canUndo).toBe(true);
  });

  it('runs nothing when the permission hook rejects one element', () => {
    const errors: BoardErrorEvent[] = [];
    const { board } = setup({
      permissions: (action, element) => !(action === 'action' && element?.id === 'b'),
    });
    board.on('error', (e) => errors.push(e));
    const blue = board.getActions(['a', 'b']).find((a) => a.id === 'style.color.blue')!;
    expect(blue.isEnabled?.()).toBe(false);
    blue.run();
    expect(board.getElement('a')!.props.color).toBe('yellow');
    expect(errors.map((e) => e.code)).toEqual(['forbidden']);
  });
});
