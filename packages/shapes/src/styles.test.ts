import { describe, expect, it } from 'vitest';
import {
  createBoard,
  defineBrush,
  definePlugin,
  type Board,
  type ElementAction,
  type InputModifiers,
  type Point,
  type ToolPointerEvent,
} from '@kujam/core';
import { createDrawTool, defaultElements, defaultTools } from './index.js';

const MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

function setup(locale: 'id' | 'en' = 'id', extra: Parameters<typeof createBoard>[0] = {}): Board {
  const board = createBoard({
    plugins: [defaultElements, defaultTools],
    snap: { grid: null },
    locale,
    ...extra,
  });
  board.camera.setViewport({ width: 1000, height: 1000 });
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
    button: type === 'pointer-move' ? -1 : 0,
    buttons: type === 'pointer-up' ? 0 : 1,
    modifiers: MODS,
  };
}

function click(board: Board, p: Point): void {
  board.dispatch(pointer(board, 'pointer-down', p));
  board.dispatch(pointer(board, 'pointer-up', p));
}

function stroke(board: Board, from: Point, to: Point): void {
  board.dispatch(pointer(board, 'pointer-down', from));
  board.dispatch(pointer(board, 'pointer-move', to));
  board.dispatch(pointer(board, 'pointer-up', to));
}

/** Creates one element with the tool and returns it. */
function createWith(board: Board, tool: string, at: Point = { x: 0, y: 0 }) {
  board.setTool(tool);
  if (tool === 'draw') stroke(board, at, { x: at.x + 50, y: at.y + 20 });
  else click(board, at);
  const id = board.selection.at(-1)!;
  return board.getElement(id)!;
}

function groups(actions: readonly ElementAction[]): string[] {
  return [...new Set(actions.map((a) => a.group))] as string[];
}

function action(board: Board, id: string, ids?: readonly string[]): ElementAction {
  const found = board.getActions(ids).find((a) => a.id === id);
  if (!found) throw new Error(`Aksi ${id} tidak ada.`);
  return found;
}

describe('BOARD-1108: style actions of built-in elements', () => {
  it('sticky offers the six sticky colors', () => {
    const board = setup();
    createWith(board, 'sticky');
    const actions = board.getActions();
    expect(groups(actions)).toEqual(['style.color']);
    expect(actions.map((a) => a.id)).toEqual([
      'style.color.yellow',
      'style.color.green',
      'style.color.pink',
      'style.color.blue',
      'style.color.purple',
      'style.color.gray',
    ]);
    expect(actions.find((a) => a.isActive?.())?.id).toBe('style.color.yellow');
    expect(actions[2]!.label).toBe('Warna: Merah muda');
  });

  it('text offers color, font size, and alignment', () => {
    const board = setup('en');
    createWith(board, 'text');
    const actions = board.getActions();
    expect(groups(actions)).toEqual(['style.color', 'style.size', 'style.align']);
    expect(actions.filter((a) => a.isActive?.()).map((a) => a.id)).toEqual([
      'style.color.black',
      'style.size.m',
      'style.align.start',
    ]);
    expect(actions.find((a) => a.id === 'style.size.xl')!.label).toBe('Font size: Extra large');
  });

  it('draw offers color, thickness, and every registered brush', () => {
    const marker = defineBrush({ id: 'example.marker', label: 'Spidol' });
    const board = setup('id', {
      plugins: [
        defaultElements,
        defaultTools,
        definePlugin({ id: 'example.brushes', brushes: [marker] }),
      ],
    });
    createWith(board, 'draw');
    const actions = board.getActions();
    expect(groups(actions)).toEqual(['style.color', 'style.thickness', 'style.brush']);
    const brushes = actions.filter((a) => a.group === 'style.brush');
    expect(brushes.map((a) => [a.id, a.label])).toEqual([
      ['style.brush.pen', 'Kuas: Pena'],
      ['style.brush.highlighter', 'Kuas: Stabilo'],
      ['style.brush.example.marker', 'Kuas: Spidol'],
    ]);
    expect(actions.find((a) => a.id === 'style.thickness.m')!.isActive?.()).toBe(true);
  });

  it('geo offers outline color, fill, fill color, thickness, and line style', () => {
    const board = setup();
    createWith(board, 'rectangle');
    const actions = board.getActions();
    expect(groups(actions)).toEqual([
      'style.color',
      'style.fill',
      'style.fillColor',
      'style.thickness',
      'style.dash',
    ]);
    action(board, 'style.dash.dashed').run();
    action(board, 'style.thickness.xl').run();
    action(board, 'style.color.red').run();
    const el = board.getElement(board.selection[0]!)!;
    expect(el.props).toMatchObject({ dash: 'dashed', strokeWidth: 8, strokeColor: 'red' });
  });

  it('applies a style to a multi-element selection, mixed types included, in one undo step', () => {
    const board = setup();
    const a = createWith(board, 'draw', { x: 0, y: 0 });
    const b = createWith(board, 'draw', { x: 0, y: 100 });
    const t = createWith(board, 'text', { x: 0, y: 200 });
    const g = createWith(board, 'rectangle', { x: 0, y: 300 });
    board.select([a.id, b.id, t.id, g.id]);
    // Only styles every element shares are offered.
    expect(groups(board.getActions())).toEqual(['style.color']);

    action(board, 'style.color.blue').run();
    expect(board.getElement(a.id)!.props.color).toBe('blue');
    expect(board.getElement(b.id)!.props.color).toBe('blue');
    expect(board.getElement(t.id)!.props.color).toBe('blue');
    expect(board.getElement(g.id)!.props.strokeColor).toBe('blue');
    expect(action(board, 'style.color.blue').isActive?.()).toBe(true);

    board.undo();
    expect(board.getElement(a.id)!.props.color).toBe('black');
    expect(board.getElement(b.id)!.props.color).toBe('black');
    expect(board.getElement(t.id)!.props.color).toBe('black');
    expect(board.getElement(g.id)!.props.strokeColor).toBe('black');
    // The four created elements are still there: the style was a single step.
    expect(board.query()).toHaveLength(4);
  });

  it('two strokes share thickness and brush as well', () => {
    const board = setup();
    const a = createWith(board, 'draw', { x: 0, y: 0 });
    const b = createWith(board, 'draw', { x: 0, y: 100 });
    board.select([a.id, b.id]);
    action(board, 'style.brush.highlighter').run();
    action(board, 'style.thickness.l').run();
    for (const id of [a.id, b.id]) {
      expect(board.getElement(id)!.props).toMatchObject({ brush: 'highlighter', thickness: 8 });
    }
  });
});

describe('BOARD-1108: last style is remembered per tool', () => {
  it('a style action on a sticky colors the next sticky', () => {
    const board = setup();
    createWith(board, 'sticky');
    action(board, 'style.color.blue').run();
    expect(board.toolStyles.get('sticky')).toEqual({ color: 'blue' });
    const next = createWith(board, 'sticky', { x: 300, y: 0 });
    expect(next.props.color).toBe('blue');
  });

  it('the draw tool uses the remembered color, brush, and thickness', () => {
    const board = setup();
    board.toolStyles.set('draw', { color: 'red', brush: 'highlighter' });
    const first = createWith(board, 'draw');
    // Without a remembered thickness the brush's default size is used.
    expect(first.props).toMatchObject({ color: 'red', brush: 'highlighter', thickness: 16 });
    board.toolStyles.set('draw', { thickness: 2 });
    expect(createWith(board, 'draw', { x: 0, y: 100 }).props.thickness).toBe(2);
  });

  it('the remembered style wins over draw tool options', () => {
    const board = createBoard({
      plugins: [
        defaultElements,
        definePlugin({
          id: 'pens',
          tools: [createDrawTool({ id: 'marker', color: 'green', thickness: 6 })],
        }),
      ],
    });
    board.camera.setViewport({ width: 1000, height: 1000 });
    expect(createWith(board, 'marker').props).toMatchObject({ color: 'green', thickness: 6 });
    board.toolStyles.set('marker', { color: 'orange' });
    expect(createWith(board, 'marker', { x: 0, y: 100 }).props).toMatchObject({
      color: 'orange',
      thickness: 6,
    });
  });

  it('shape tools share one style and keep their own shape kind', () => {
    const board = setup();
    createWith(board, 'rectangle');
    action(board, 'style.fill.solid').run();
    const ellipse = createWith(board, 'ellipse', { x: 300, y: 0 });
    expect(ellipse.props).toMatchObject({ geo: 'ellipse', fill: 'solid' });
    board.toolStyles.set('geo', { geo: 'star' });
    expect(createWith(board, 'rectangle', { x: 600, y: 0 }).props.geo).toBe('rectangle');
  });

  it('ignores remembered values that are not valid props of the element', () => {
    const board = setup();
    board.toolStyles.set('sticky', { color: 'red', unknown: 1 });
    board.toolStyles.set('text', { size: 'xxl', align: 'center' });
    expect(createWith(board, 'sticky').props.color).toBe('yellow');
    expect(createWith(board, 'text', { x: 300, y: 0 }).props).toMatchObject({
      size: 'm',
      align: 'center',
    });
  });

  it('a rejected style action (locked element) is not remembered', () => {
    const board = setup();
    const sticky = createWith(board, 'sticky');
    board.update(sticky.id, { locked: true });
    action(board, 'style.color.pink', [sticky.id]).run();
    expect(board.getElement(sticky.id)!.props.color).toBe('yellow');
    expect(board.toolStyles.get('sticky')).toEqual({});
  });
});
