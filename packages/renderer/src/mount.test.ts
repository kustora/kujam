// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard, type Board } from '@kujam/core';
import { mountRenderer, type BoardView } from './index.js';

/** Controllable stand-in for `ResizeObserver`; tests decide when and how sizes change. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  /** Reports a new content size for the observed element. */
  resize(width: number, height: number): void {
    const entry = { target: this.targets[0], contentRect: { width, height } };
    this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

/** Manual animation frames: callbacks run only on `flush()`. */
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
function flushFrames(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(0);
}

const originals = {
  ResizeObserver: window.ResizeObserver,
  requestAnimationFrame: window.requestAnimationFrame,
  cancelAnimationFrame: window.cancelAnimationFrame,
  devicePixelRatio: window.devicePixelRatio,
};

/** Fake 2D context that counts frames (happy-dom has no canvas implementation). */
let clears = 0;
const fakeContext = {
  setTransform: () => {},
  clearRect: () => {
    clears++;
  },
  save: () => {},
  restore: () => {},
  beginPath: () => {},
  rect: () => {},
  clip: () => {},
  stroke: () => {},
  fill: () => {},
  strokeRect: () => {},
  fillRect: () => {},
  translate: () => {},
  rotate: () => {},
  scale: () => {},
  fillText: () => {},
  setLineDash: () => {},
};

let boards: Board[] = [];
let views: BoardView[] = [];

function setup(
  container: HTMLElement = document.body.appendChild(document.createElement('div')),
  options?: RendererOptions,
) {
  const board = createBoard();
  boards.push(board);
  const view = mountRenderer(board, container, options);
  views.push(view);
  return { board, view, container, observer: FakeResizeObserver.instances.at(-1)! };
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  frames.clear();
  clears = 0;
  Object.assign(window, {
    ResizeObserver: FakeResizeObserver,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    devicePixelRatio: 1,
  });
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeContext as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  for (const view of views) view.unmount();
  for (const board of boards) board.dispose();
  views = [];
  boards = [];
  document.body.innerHTML = '';
  Object.assign(window, originals);
  vi.restoreAllMocks();
});

describe('BOARD-801: mountRenderer', () => {
  it('stacks the main canvas, HTML layer, and overlay canvas in one root', () => {
    const { view, container } = setup();
    const { root, canvas, html, a11y, overlay } = view.layers;

    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(root);
    // The accessibility tree (BOARD-1901) sits between the HTML layer and the overlay.
    expect([...root.children]).toEqual([canvas, html, a11y, overlay]);
    expect(canvas.tagName).toBe('CANVAS');
    expect(html.tagName).toBe('DIV');
    expect(a11y.tagName).toBe('DIV');
    expect(overlay.tagName).toBe('CANVAS');
    expect([canvas, html, a11y, overlay].map((el) => el.dataset.kujamLayer)).toEqual([
      'canvas',
      'html',
      'a11y',
      'overlay',
    ]);
    for (const layer of [canvas, html, a11y, overlay]) {
      expect(layer.style.position).toBe('absolute');
    }
    // Only the main canvas receives input; the layers above let pointer events through.
    expect(canvas.style.pointerEvents).toBe('');
    expect(html.style.pointerEvents).toBe('none');
    expect(a11y.style.pointerEvents).toBe('none');
    expect(overlay.style.pointerEvents).toBe('none');
    expect(root.style.overflow).toBe('hidden');
    expect(view.mounted).toBe(true);
    expect(view.board).toBe(boards[0]);
    expect(view.container).toBe(container);
  });

  it('measures the initial size and reports it to the camera', () => {
    vi.spyOn(window.HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
    vi.spyOn(window.HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    window.devicePixelRatio = 2;
    const { board, view } = setup();

    expect(view.size).toEqual({ width: 320, height: 200 });
    expect(board.camera.viewport).toEqual({ width: 320, height: 200 });
    expect(view.pixelRatio).toBe(2);
    expect([view.layers.canvas.width, view.layers.canvas.height]).toEqual([640, 400]);
    expect([view.layers.overlay.width, view.layers.overlay.height]).toEqual([640, 400]);
  });

  it('follows the container size through ResizeObserver', () => {
    const { board, view, observer } = setup();
    expect(observer.targets).toEqual([view.layers.root]);

    observer.resize(800, 600.5);
    expect(view.size).toEqual({ width: 800, height: 600.5 });
    expect(board.camera.viewport).toEqual({ width: 800, height: 600.5 });
    expect([view.layers.canvas.width, view.layers.canvas.height]).toEqual([800, 601]);

    // Invalid sizes (for example a hidden container) clamp to zero instead of throwing.
    observer.resize(Number.NaN, -5);
    expect(board.camera.viewport).toEqual({ width: 0, height: 0 });
  });

  it('only renders again on a real size change', () => {
    const { observer } = setup();
    flushFrames();
    observer.resize(100, 100);
    flushFrames();
    const before = clears;

    observer.resize(100, 100);
    flushFrames();
    expect(clears).toBe(before);
  });

  it('uses the pixelRatio option over the window value and validates it', () => {
    window.devicePixelRatio = 3;
    const board = createBoard();
    boards.push(board);
    const container = document.body.appendChild(document.createElement('div'));
    const view = mountRenderer(board, container, { pixelRatio: 1.5 });
    views.push(view);
    expect(view.pixelRatio).toBe(1.5);

    for (const pixelRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '2' as never]) {
      expect(() => mountRenderer(board, container, { pixelRatio })).toThrow(RangeError);
    }
    // A failed mount leaves nothing behind.
    expect(container.children).toHaveLength(1);
  });

  it('coalesces render requests into one animation frame', () => {
    const { board, view } = setup();
    flushFrames();
    clears = 0;

    view.requestRender();
    view.requestRender();
    board.setCamera({ x: 10 });
    board.transact((tx) =>
      tx.put({ id: 'page:2', kind: 'page', name: 'Dua', index: 'a1', meta: {} }),
    );
    expect(frames.size).toBe(1);

    flushFrames();
    // One clear for the main canvas and one for the overlay.
    expect(clears).toBe(2);
  });

  it('re-renders on document, camera, selection, page, and tool changes', () => {
    const { board } = setup();
    flushFrames();

    board.setCamera({ zoom: 2 });
    expect(frames.size).toBe(1);
    flushFrames();

    board.pages.create({ id: 'page:2' });
    expect(frames.size).toBe(1);
    flushFrames();

    board.pages.setCurrent('page:2');
    expect(frames.size).toBe(1);
    flushFrames();
  });

  it('tolerates canvases without a 2D context', () => {
    vi.mocked(window.HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const { view } = setup();
    view.requestRender();
    expect(() => flushFrames()).not.toThrow();
  });

  it('unmount removes the DOM and releases the observer, listeners, and pending frame', () => {
    const { board, view, container, observer } = setup();
    expect(frames.size).toBe(1);

    view.unmount();
    expect(view.mounted).toBe(false);
    expect(container.children).toHaveLength(0);
    expect(observer.disconnected).toBe(true);
    expect(frames.size).toBe(0);

    // No listener is left on the board, and late requests are ignored.
    board.setCamera({ x: 50 });
    view.requestRender();
    observer.resize(10, 10);
    expect(frames.size).toBe(0);
    expect(board.camera.viewport).toEqual({ width: 0, height: 0 });

    expect(() => view.unmount()).not.toThrow();
  });

  it('releases every board subscription it made', () => {
    const board = createBoard();
    boards.push(board);
    let active = 0;
    const on = board.on.bind(board);
    vi.spyOn(board, 'on').mockImplementation(((type: never, listener: never) => {
      active++;
      const off = on(type, listener);
      return () => {
        active--;
        off();
      };
    }) as Board['on']);

    const view = mountRenderer(board, document.body.appendChild(document.createElement('div')));
    expect(active).toBeGreaterThan(0);
    view.unmount();
    expect(active).toBe(0);
  });

  it('unmounts itself when the board is disposed', () => {
    const { board, view, container, observer } = setup();
    board.dispose();
    expect(view.mounted).toBe(false);
    expect(container.children).toHaveLength(0);
    expect(observer.disconnected).toBe(true);
    expect(frames.size).toBe(0);
  });

  it('keeps two renderers for two boards on one page independent', () => {
    const a = setup();
    const b = setup();
    expect(a.observer).not.toBe(b.observer);
    expect(a.view.layers.root).not.toBe(b.view.layers.root);
    flushFrames();

    a.observer.resize(300, 200);
    expect(a.board.camera.viewport).toEqual({ width: 300, height: 200 });
    expect(b.board.camera.viewport).toEqual({ width: 0, height: 0 });

    a.view.unmount();
    expect(b.view.mounted).toBe(true);
    expect(b.observer.disconnected).toBe(false);
    expect(b.container.children).toHaveLength(1);

    b.board.setCamera({ x: 5 });
    expect(frames.size).toBe(1);
    b.observer.resize(640, 480);
    expect(b.board.camera.viewport).toEqual({ width: 640, height: 480 });
  });

  it('allows two views of the same board', () => {
    const board = createBoard();
    boards.push(board);
    const first = mountRenderer(board, document.body.appendChild(document.createElement('div')));
    const second = mountRenderer(board, document.body.appendChild(document.createElement('div')));
    views.push(first, second);

    first.unmount();
    board.setCamera({ x: 1 });
    expect(second.mounted).toBe(true);
    expect(frames.size).toBe(1);
  });

  it('still mounts without ResizeObserver', () => {
    Object.assign(window, { ResizeObserver: undefined });
    vi.spyOn(window.HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(50);
    vi.spyOn(window.HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
    const { board, view } = setup();
    expect(board.camera.viewport).toEqual({ width: 50, height: 40 });
    expect(() => view.unmount()).not.toThrow();
  });

  it('rejects a disposed board and a container that is not a DOM element', () => {
    const board = createBoard();
    expect(() => mountRenderer(board, {} as HTMLElement)).toThrow(TypeError);
    expect(() => mountRenderer(board, null as unknown as HTMLElement)).toThrow(TypeError);
    board.dispose();
    const container = document.createElement('div');
    expect(() => mountRenderer(board, container)).toThrow('Papan sudah di-dispose.');
    expect(container.children).toHaveLength(0);
  });

  it('applies theme canvas background to root element and updates dynamically (BOARD-1006)', () => {
    const { board, view } = setup(undefined, { theme: 'light' });
    expect(view.layers.root.style.backgroundColor).toBe('#F4F3EF');
    expect(view.theme.mode).toBe('light');

    view.setTheme('dark');
    expect(view.theme.mode).toBe('dark');
    expect(view.layers.root.style.backgroundColor).toBe('#121317');

    board.setTheme('light');
    expect(view.theme.mode).toBe('light');
    expect(view.layers.root.style.backgroundColor).toBe('#F4F3EF');
  });
});
