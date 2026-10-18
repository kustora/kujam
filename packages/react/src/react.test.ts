// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createBoard,
  defineElement,
  definePlugin,
  defineTool,
  object,
  type Board as CoreBoard,
} from '@kujam/core';
import type { BoardView } from '@kujam/renderer';
import { Board, useBoardEvent, useCamera, useHistory, useSelection, useTool } from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box = defineElement({ type: 'box', version: 1, props: object({}), defaults: {} });
const tools = definePlugin({
  id: 'test-tools',
  elements: [box],
  tools: [
    defineTool({ id: 'select', initial: 'idle', states: { idle: {} } }),
    defineTool({ id: 'hand', initial: 'idle', states: { idle: {} } }),
  ],
});

let roots: Root[] = [];
let boards: CoreBoard[] = [];

beforeEach(() => {
  Object.assign(window, {
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    devicePixelRatio: 1,
  });
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  for (const board of boards) if (!board.disposed) board.dispose();
  roots = [];
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function newBoard(): CoreBoard {
  const board = createBoard({ plugins: [tools] });
  boards.push(board);
  return board;
}

function render(node: ReactNode): {
  container: HTMLElement;
  root: Root;
  rerender(n: ReactNode): void;
} {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return { container, root, rerender: (n) => act(() => root.render(n)) };
}

function viewports(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('[data-kujam-viewport]')];
}

/** Renders `useHook` in a probe component and records every value it renders with. */
function probe<T>(useHook: () => T) {
  const values: T[] = [];
  function Probe(): null {
    values.push(useHook());
    return null;
  }
  const result = render(createElement(Probe));
  return { values, ...result, latest: () => values[values.length - 1]! };
}

describe('BOARD-1302: <Board>', () => {
  it('mounts the renderer into its host and removes it on unmount', () => {
    const board = newBoard();
    const { container, root } = render(createElement(Board, { board, className: 'papan' }));
    const host = container.querySelector('.papan')!;
    expect(viewports(host)).toHaveLength(1);

    act(() => root.unmount());
    roots = roots.filter((r) => r !== root);
    expect(viewports(container)).toHaveLength(0);
  });

  it('leaves exactly one view under StrictMode double mounting', () => {
    const board = newBoard();
    const onMount = vi.fn();
    const { container } = render(
      createElement(StrictMode, null, createElement(Board, { board, onMount })),
    );
    expect(viewports(container)).toHaveLength(1);
    // Mounted, unmounted, and mounted again by StrictMode.
    expect(onMount).toHaveBeenCalledTimes(2);
    expect((onMount.mock.calls.at(-1)![0] as BoardView).mounted).toBe(true);
  });

  it('remounts when the board changes and keeps the view across other prop changes', () => {
    const a = newBoard();
    const b = newBoard();
    const views: BoardView[] = [];
    const onMount = (view: BoardView) => {
      views.push(view);
    };
    const { container, rerender } = render(createElement(Board, { board: a, onMount }));
    rerender(createElement(Board, { board: a, onMount, className: 'x', debug: true }));
    expect(views).toHaveLength(1);
    expect(views[0]!.debug).toBe(true);

    rerender(createElement(Board, { board: b, onMount }));
    expect(views).toHaveLength(2);
    expect(views[0]!.mounted).toBe(false);
    expect(views[1]!.board).toBe(b);
    expect(viewports(container)).toHaveLength(1);
  });

  it('applies theme and background props without remounting', () => {
    const board = newBoard();
    let view: BoardView | undefined;
    const onMount = (v: BoardView) => {
      view = v;
    };
    const { rerender } = render(
      createElement(Board, { board, onMount, theme: 'light', background: 'grid' }),
    );
    expect(view!.background).toBe('grid');
    expect(board.theme.mode).toBe('light');

    rerender(createElement(Board, { board, onMount, theme: 'dark', background: 'none' }));
    expect(board.theme.mode).toBe('dark');
    expect(view!.background).toBe('none');
    expect(view!.mounted).toBe(true);
  });

  it('runs the onMount cleanup before the view unmounts', () => {
    const board = newBoard();
    const order: string[] = [];
    const { root } = render(
      createElement(Board, {
        board,
        onMount: (view) => () => order.push(`cleanup:${view.mounted}`),
      }),
    );
    act(() => root.unmount());
    roots = roots.filter((r) => r !== root);
    expect(order).toEqual(['cleanup:true']);
  });

  it('renders nothing into a disposed board', () => {
    const board = newBoard();
    board.dispose();
    const { container } = render(createElement(Board, { board }));
    expect(viewports(container)).toHaveLength(0);
  });
});

describe('BOARD-1302: hooks', () => {
  it('useSelection follows the selection and skips renders for no-op changes', () => {
    const board = newBoard();
    const el = board.create({ type: 'box', x: 0, y: 0 })!;
    const { values, latest } = probe(() => useSelection(board));
    expect(latest()).toEqual([]);

    act(() => board.select([el.id]));
    expect(latest()).toEqual([el.id]);
    const renders = values.length;
    act(() => board.select([el.id]));
    expect(values).toHaveLength(renders);
  });

  it('useSelection with a selector re-renders only when the derived value changes', () => {
    const board = newBoard();
    const a = board.create({ type: 'box', x: 0, y: 0 })!;
    const b = board.create({ type: 'box', x: 10, y: 0 })!;
    const { values, latest } = probe(() => useSelection(board, (s) => s.length > 0));
    expect(latest()).toBe(false);

    act(() => board.select([a.id]));
    expect(latest()).toBe(true);
    const renders = values.length;
    act(() => board.select([a.id, b.id]));
    act(() => board.select([b.id]));
    expect(values).toHaveLength(renders);
  });

  it('useCamera with a selector does not re-render on pan', () => {
    const board = newBoard();
    const { values, latest } = probe(() => useCamera(board, (c) => c.zoom));
    expect(latest()).toBe(1);
    const renders = values.length;

    act(() => {
      for (let i = 1; i <= 20; i++) board.camera.set({ x: i * 10, y: i * 5 });
    });
    expect(values).toHaveLength(renders);

    act(() => board.camera.set({ zoom: 2 }));
    expect(latest()).toBe(2);
  });

  it('useCamera with a custom equality keeps the previous value', () => {
    const board = newBoard();
    const { values, latest } = probe(() =>
      useCamera(
        board,
        (c) => ({ x: Math.round(c.x / 100) }),
        (p, n) => p.x === n.x,
      ),
    );
    const first = latest();
    const renders = values.length;
    act(() => board.camera.set({ x: 20 }));
    expect(values).toHaveLength(renders);
    act(() => board.camera.set({ x: 260 }));
    expect(latest()).toEqual({ x: 3 });
    expect(latest()).not.toBe(first);
  });

  it('useCamera without a selector returns the camera state', () => {
    const board = newBoard();
    const { latest } = probe(() => useCamera(board));
    act(() => board.camera.set({ x: 42 }));
    expect(latest()).toBe(board.camera.get());
    expect(latest().x).toBe(42);
  });

  it('useTool follows the active tool', () => {
    const board = newBoard();
    const { latest } = probe(() => useTool(board));
    expect(latest()).toBe(board.tool);
    act(() => board.setTool('hand'));
    expect(latest()).toBe('hand');
  });

  it('useHistory exposes canUndo/canRedo and bound actions', () => {
    const board = newBoard();
    const { latest, values } = probe(() => useHistory(board));
    expect(latest()).toMatchObject({ canUndo: false, canRedo: false });

    act(() => {
      board.create({ type: 'box', x: 0, y: 0 });
    });
    expect(latest()).toMatchObject({ canUndo: true, canRedo: false });
    const renders = values.length;
    act(() => {
      board.create({ type: 'box', x: 5, y: 0 });
    });
    expect(values).toHaveLength(renders);

    act(() => latest().undo());
    act(() => latest().undo());
    expect(latest()).toMatchObject({ canUndo: false, canRedo: true });
    act(() => latest().redo());
    expect(board.query()).toHaveLength(1);
    expect(latest().undo).toBe(values[0]!.undo);
  });

  it('useBoardEvent calls the latest listener and unsubscribes on unmount', () => {
    const board = newBoard();
    const calls: string[] = [];
    function Listener({ tag }: { tag: string }): null {
      useBoardEvent(board, 'tool', (e) => calls.push(`${tag}:${e.id}`));
      return null;
    }
    const { rerender, root } = render(createElement(Listener, { tag: 'a' }));
    act(() => board.setTool('hand'));
    rerender(createElement(Listener, { tag: 'b' }));
    act(() => board.setTool('select'));
    act(() => root.unmount());
    roots = roots.filter((r) => r !== root);
    act(() => board.setTool('hand'));

    expect(calls).toEqual(['a:hand', 'b:select']);
  });

  it('hooks keep working after the board is disposed', () => {
    const board = newBoard();
    const selection = probe(() => useSelection(board));
    const history = probe(() => useHistory(board));
    act(() => board.dispose());
    expect(selection.latest()).toEqual([]);
    expect(history.latest()).toMatchObject({ canUndo: false, canRedo: false });
  });
});
