// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, h, nextTick, shallowRef, watch, type App } from 'vue';
import {
  createBoard,
  defineElement,
  definePlugin,
  defineTool,
  object,
  type Board as CoreBoard,
} from '@kujam/core';
import type { BoardView } from '@kujam/renderer';
import {
  Board,
  useBoardEvent,
  useCamera,
  useHistory,
  useResolved,
  useSelection,
  useTool,
} from './index.js';

const box = defineElement({ type: 'box', version: 1, props: object({}), defaults: {} });
const plugin = definePlugin({
  id: 'test',
  elements: [box],
  tools: [
    defineTool({ id: 'select', initial: 'idle', states: { idle: {} } }),
    defineTool({ id: 'hand', initial: 'idle', states: { idle: {} } }),
  ],
});

let apps: App[] = [];
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
  for (const app of apps) app.unmount();
  for (const board of boards) if (!board.disposed) board.dispose();
  apps = [];
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function newBoard(): CoreBoard {
  const board = createBoard({ plugins: [plugin] });
  boards.push(board);
  return board;
}

function mountApp(render: () => ReturnType<typeof h>) {
  const container = document.body.appendChild(document.createElement('div'));
  const app = createApp({ render });
  app.mount(container);
  apps.push(app);
  return { app, container };
}

function viewports(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('[data-kujam-viewport]')];
}

/** Runs composables in an effect scope, like a component `setup`. */
function inScope<T>(fn: () => T): { result: T; stop: () => void } {
  const scope = effectScope();
  const result = scope.run(fn)!;
  return { result, stop: () => scope.stop() };
}

describe('BOARD-1303: <Board>', () => {
  it('mounts the renderer and removes it when the app unmounts', () => {
    const board = newBoard();
    const { app, container } = mountApp(() => h(Board, { board }));
    expect(viewports(container)).toHaveLength(1);

    app.unmount();
    apps = apps.filter((a) => a !== app);
    expect(viewports(container)).toHaveLength(0);
    expect(board.disposed).toBe(false);
  });

  it('emits mount and unmount with the view', () => {
    const board = newBoard();
    const events: string[] = [];
    const { app } = mountApp(() =>
      h(Board, {
        board,
        onMount: (view: BoardView) => events.push(`mount:${view.mounted}`),
        onUnmount: (view: BoardView) => events.push(`unmount:${view.mounted}`),
      }),
    );
    app.unmount();
    apps = apps.filter((a) => a !== app);
    expect(events).toEqual(['mount:true', 'unmount:true']);
  });

  it('remounts when the board changes and applies other props in place', async () => {
    const a = newBoard();
    const b = newBoard();
    const current = shallowRef(a);
    const props = shallowRef({
      background: 'grid' as const,
      debug: false,
      theme: 'light' as const,
    });
    const views: BoardView[] = [];
    const { container } = mountApp(() =>
      h(Board, { board: current.value, ...props.value, onMount: (v: BoardView) => views.push(v) }),
    );
    expect(views[0]!.background).toBe('grid');

    props.value = { background: 'none' as never, debug: true, theme: 'dark' as never };
    await nextTick();
    expect(views).toHaveLength(1);
    expect(views[0]!.background).toBe('none');
    expect(views[0]!.debug).toBe(true);
    expect(a.theme.mode).toBe('dark');

    current.value = b;
    await nextTick();
    expect(views).toHaveLength(2);
    expect(views[0]!.mounted).toBe(false);
    expect(views[1]!.board).toBe(b);
    expect(viewports(container)).toHaveLength(1);
  });

  it('renders nothing into a disposed board', () => {
    const board = newBoard();
    board.dispose();
    const { container } = mountApp(() => h(Board, { board }));
    expect(viewports(container)).toHaveLength(0);
  });
});

describe('BOARD-1303: composables', () => {
  it('useSelection follows the selection and stops on scope dispose', () => {
    const board = newBoard();
    const el = board.create({ type: 'box', x: 0, y: 0 })!;
    const { result: selection, stop } = inScope(() => useSelection(board));
    expect(selection.value).toEqual([]);

    board.select([el.id]);
    expect(selection.value).toEqual([el.id]);

    stop();
    board.clearSelection();
    expect(selection.value).toEqual([el.id]);
  });

  it('selectors only update the ref when the selected value changes', () => {
    const board = newBoard();
    const a = board.create({ type: 'box', x: 0, y: 0 })!;
    const b = board.create({ type: 'box', x: 10, y: 0 })!;
    const { result, stop } = inScope(() => {
      const hasSelection = useSelection(board, (ids) => ids.length > 0);
      const zoom = useCamera(board, (c) => c.zoom);
      const runs = { selection: 0, zoom: 0 };
      watch(hasSelection, () => runs.selection++, { flush: 'sync' });
      watch(zoom, () => runs.zoom++, { flush: 'sync' });
      return { hasSelection, zoom, runs };
    });

    board.select([a.id]);
    board.select([a.id, b.id]);
    board.select([b.id]);
    expect(result.hasSelection.value).toBe(true);
    expect(result.runs.selection).toBe(1);

    for (let i = 1; i <= 20; i++) board.camera.set({ x: i * 10 });
    expect(result.runs.zoom).toBe(0);
    board.camera.set({ zoom: 2 });
    expect(result.zoom.value).toBe(2);
    expect(result.runs.zoom).toBe(1);
    stop();
  });

  it('useCamera supports a custom equality and the full state', () => {
    const board = newBoard();
    const { result, stop } = inScope(() => ({
      full: useCamera(board),
      bucket: useCamera(
        board,
        (c) => ({ x: Math.round(c.x / 100) }),
        (p, n) => p.x === n.x,
      ),
    }));
    const first = result.bucket.value;
    board.camera.set({ x: 20 });
    expect(result.bucket.value).toBe(first);
    board.camera.set({ x: 260 });
    expect(result.bucket.value).toEqual({ x: 3 });
    expect(result.full.value).toBe(board.camera.get());
    stop();
  });

  it('useTool and useHistory follow the board', () => {
    const board = newBoard();
    const { result, stop } = inScope(() => ({ tool: useTool(board), history: useHistory(board) }));
    board.setTool('hand');
    expect(result.tool.value).toBe('hand');

    expect(result.history.canUndo.value).toBe(false);
    board.create({ type: 'box', x: 0, y: 0 });
    expect(result.history.canUndo.value).toBe(true);
    result.history.undo();
    expect(result.history.canUndo.value).toBe(false);
    expect(result.history.canRedo.value).toBe(true);
    result.history.redo();
    expect(board.query()).toHaveLength(1);
    stop();
  });

  it('follows a board given as a ref and resubscribes when it changes', async () => {
    const a = newBoard();
    const b = newBoard();
    const current = shallowRef(a);
    const events: string[] = [];
    const { result, stop } = inScope(() => {
      useBoardEvent(current, 'tool', (e) => events.push(`${e.id}`));
      return useTool(() => current.value);
    });

    a.setTool('hand');
    expect(result.value).toBe('hand');

    current.value = b;
    await nextTick();
    expect(result.value).toBe(b.tool);
    a.setTool('select');
    b.setTool('hand');
    expect(events).toEqual(['hand', 'hand']);
    expect(result.value).toBe('hand');
    stop();
  });

  it('useBoardEvent stops listening on scope dispose', () => {
    const board = newBoard();
    const listener = vi.fn();
    const { stop } = inScope(() => useBoardEvent(board, 'tool', listener));
    board.setTool('hand');
    stop();
    board.setTool('select');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps working after the board is disposed', () => {
    const board = newBoard();
    const { result, stop } = inScope(() => ({
      selection: useSelection(board),
      history: useHistory(board),
    }));
    board.dispose();
    expect(result.selection.value).toEqual([]);
    expect(result.history.canUndo.value).toBe(false);
    stop();
  });

  it('returns read-only refs', () => {
    const board = newBoard();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, stop } = inScope(() => useTool(board));
    (result as { value: string | null }).value = 'hacked';
    expect(result.value).toBe(board.tool);
    expect(warn).toHaveBeenCalled();
    stop();
  });

  it('works inside a component and cleans up on unmount', () => {
    const board = newBoard();
    let tool: Readonly<{ value: string | null }> | undefined;
    const { app } = mountApp(() =>
      h({
        setup() {
          tool = useTool(board);
          return () => null;
        },
      }),
    );
    board.setTool('hand');
    expect(tool!.value).toBe('hand');
    app.unmount();
    apps = apps.filter((a) => a !== app);
    board.setTool('select');
    expect(tool!.value).toBe('hand');
  });

  describe('BOARD-1306: useResolved', () => {
    it('returns synchronous resolver data and status ready immediately', () => {
      const board = createBoard({
        resolvers: {
          item: (id) => ({ title: `Item ${id}` }),
        },
      });
      boards.push(board);

      const { result, stop } = inScope(() => useResolved(board, 'item', 'i1'));
      expect(result.data.value).toEqual({ title: 'Item i1' });
      expect(result.status.value).toBe('ready');
      stop();
    });

    it('handles async resolver with loading then ready', async () => {
      let resolvePromise: ((val: { content: string }) => void) | undefined;
      const promise = new Promise<{ content: string }>((resolve) => {
        resolvePromise = resolve;
      });

      const board = createBoard({
        resolvers: {
          asyncItem: () => promise,
        },
      });
      boards.push(board);

      const { result, stop } = inScope(() => useResolved(board, 'asyncItem', 'a1'));
      expect(result.data.value).toBeUndefined();
      expect(result.status.value).toBe('loading');

      resolvePromise!({ content: 'Async Loaded' });
      await promise;
      await nextTick();

      expect(result.data.value).toEqual({ content: 'Async Loaded' });
      expect(result.status.value).toBe('ready');
      stop();
    });

    it('re-evaluates when board.invalidate(resolver, id) is called', async () => {
      let currentTitle = 'Original';
      const board = createBoard({
        resolvers: {
          item: (id) => ({ title: `${currentTitle} ${id}` }),
        },
      });
      boards.push(board);

      const { result, stop } = inScope(() => useResolved(board, 'item', 'p1'));
      expect(result.data.value).toEqual({ title: 'Original p1' });
      expect(result.status.value).toBe('ready');

      currentTitle = 'Updated';
      board.invalidate('item', 'p1');
      await nextTick();

      expect(result.data.value).toEqual({ title: 'Updated p1' });
      expect(result.status.value).toBe('ready');
      stop();
    });

    it('re-evaluates when board.invalidate(resolver) is called without id', async () => {
      let currentTitle = 'Initial';
      const board = createBoard({
        resolvers: {
          item: (id) => ({ title: `${currentTitle} ${id}` }),
        },
      });
      boards.push(board);

      const { result, stop } = inScope(() => useResolved(board, 'item', 'p2'));
      expect(result.data.value).toEqual({ title: 'Initial p2' });
      expect(result.status.value).toBe('ready');

      currentTitle = 'Broad Invalidate';
      board.invalidate('item');
      await nextTick();

      expect(result.data.value).toEqual({ title: 'Broad Invalidate p2' });
      expect(result.status.value).toBe('ready');
      stop();
    });

    it('follows ref changes for resolver and id', async () => {
      const board = createBoard({
        resolvers: {
          item: (id) => ({ title: `Item ${id}` }),
          user: (id) => ({ name: `User ${id}` }),
        },
      });
      boards.push(board);

      const resRef = shallowRef('item');
      const idRef = shallowRef('1');

      const { result, stop } = inScope(() => useResolved(board, resRef, idRef));
      expect(result.data.value).toEqual({ title: 'Item 1' });

      idRef.value = '2';
      await nextTick();
      expect(result.data.value).toEqual({ title: 'Item 2' });

      resRef.value = 'user';
      await nextTick();
      expect(result.data.value).toEqual({ name: 'User 2' });

      stop();
    });

    it('handles ResolveError status for forbidden and not-found', () => {
      const board = createBoard({
        resolvers: {
          secret: () => ({ status: 'forbidden' }),
          missing: () => ({ status: 'not-found', message: 'Item gone' }),
        },
      });
      boards.push(board);

      const secret = inScope(() => useResolved(board, 'secret', 's1'));
      const missing = inScope(() => useResolved(board, 'missing', 'm1'));

      expect(secret.result.data.value).toBeUndefined();
      expect(secret.result.status.value).toBe('forbidden');

      expect(missing.result.data.value).toBeUndefined();
      expect(missing.result.status.value).toBe('not-found');

      secret.stop();
      missing.stop();
    });

    it('returns error status when resolver is not registered', () => {
      const board = createBoard();
      boards.push(board);

      const { result, stop } = inScope(() => useResolved(board, 'unknown-resolver', 'u1'));
      expect(result.data.value).toBeUndefined();
      expect(result.status.value).toBe('error');
      stop();
    });
  });
});
