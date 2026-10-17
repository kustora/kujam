// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  rect,
  schema,
  string,
  type Board,
} from '@kujam/core';
import { mountRenderer, type BoardView } from './index.js';
import { HTML_VIEWPORT_MARGIN } from './html-layer.js';

let boards: Board[] = [];
let views: BoardView[] = [];
let cardUpdates = 0;
let cardDestroys = 0;

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(): void {}
  disconnect(): void {}

  resize(width: number, height: number): void {
    const entry = { target: this.targets[0], contentRect: { width, height } };
    this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
function flushFrames(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(0);
}

const htmlCardElement = defineElement({
  type: 'html-card',
  version: 1,
  props: schema({ title: string() }),
  geometry: (el) => rect(el.w, el.h),
  render: {
    html: (host, el) => {
      host.textContent = el.props.title;
      return {
        update: (nextEl) => {
          cardUpdates++;
          host.textContent = nextEl.props.title;
        },
        destroy: () => {
          cardDestroys++;
        },
      };
    },
  },
});

const htmlCardPlugin = definePlugin({
  id: 'html-cards',
  elements: [htmlCardElement],
});

beforeEach(() => {
  cardUpdates = 0;
  cardDestroys = 0;
  frames.clear();
  FakeResizeObserver.instances = [];

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
});

afterEach(() => {
  for (const view of views) view.unmount();
  for (const board of boards) board.dispose();
  views = [];
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function setup(options: { width?: number; height?: number } = {}) {
  const container = document.body.appendChild(document.createElement('div'));
  const width = options.width ?? 800;
  const height = options.height ?? 600;

  vi.spyOn(container, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(height);

  const board = createBoard({ plugins: [htmlCardPlugin] });
  boards.push(board);

  const view = mountRenderer(board, container);
  views.push(view);

  const observer = FakeResizeObserver.instances.at(-1);
  if (observer) observer.resize(width, height);

  return { board, view, container, observer };
}

describe('BOARD-804: HTML Layer Camera Transform', () => {
  it('wrapper receives translate() scale() transform while child elements stay in board coordinates', () => {
    const { board, view } = setup({ width: 800, height: 600 });

    const card = board.create({
      id: 'card-1',
      type: 'html-card',
      x: 150,
      y: 200,
      w: 120,
      h: 80,
      rotation: 45,
      opacity: 0.8,
      props: { title: 'Card 1' },
    });

    flushFrames();

    const cameraHost = view.layers.htmlCamera;
    expect(cameraHost.dataset.kujamHtmlCamera).toBe('');
    expect(cameraHost.style.transformOrigin).toBe('0 0');
    expect(cameraHost.style.willChange).toBe('transform');
    expect(cameraHost.style.transform).toBe('translate(0px, 0px) scale(1)');

    const host = cameraHost.querySelector(`[data-kujam-element-id="${card.id}"]`) as HTMLElement;
    expect(host).not.toBeNull();
    // Element host is positioned strictly in board units
    expect(host.style.left).toBe('150px');
    expect(host.style.top).toBe('200px');
    expect(host.style.width).toBe('120px');
    expect(host.style.height).toBe('80px');
    expect(host.style.transform).toBe('rotate(45deg)');
    expect(host.style.opacity).toBe('0.8');
    expect(host.style.pointerEvents).toBe('auto');

    // Pan and zoom camera: wrapper transform updates instantly
    board.setCamera({ x: 50, y: 100, zoom: 2 });
    flushFrames();

    expect(cameraHost.style.transform).toBe('translate(-100px, -200px) scale(2)');
    // Element host coordinates in board units remain untouched!
    expect(host.style.left).toBe('150px');
    expect(host.style.top).toBe('200px');
  });
});

describe('BOARD-804: Viewport Virtualization', () => {
  it('mounts HTML elements when entering viewport with margin and destroys when leaving', () => {
    const { board, view } = setup({ width: 800, height: 600 });
    const cameraHost = view.layers.htmlCamera;

    // Element in viewport (0, 0 to 800, 600)
    const cardIn = board.create({
      id: 'card-in',
      type: 'html-card',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { title: 'In Viewport' },
    });

    // Element far outside viewport and its margin
    const cardOut = board.create({
      id: 'card-out',
      type: 'html-card',
      x: 3000,
      y: 3000,
      w: 100,
      h: 100,
      props: { title: 'Far Away' },
    });

    flushFrames();

    expect(cameraHost.querySelector(`[data-kujam-element-id="${cardIn.id}"]`)).not.toBeNull();
    expect(cameraHost.querySelector(`[data-kujam-element-id="${cardOut.id}"]`)).toBeNull();

    // Pan camera towards cardOut so it enters viewport
    board.setCamera({ x: 2800, y: 2800 });
    flushFrames();

    // cardOut is now mounted
    expect(cameraHost.querySelector(`[data-kujam-element-id="${cardOut.id}"]`)).not.toBeNull();
    // cardIn left the viewport and was destroyed
    expect(cameraHost.querySelector(`[data-kujam-element-id="${cardIn.id}"]`)).toBeNull();
    expect(cardDestroys).toBe(1);
  });

  it('respects the viewport buffer margin', () => {
    const { board, view } = setup({ width: 800, height: 600 });
    const cameraHost = view.layers.htmlCamera;

    // Viewport is 0 to 800 on X.
    // Place element at 850 (outside 800 width, but within HTML_VIEWPORT_MARGIN = 150)
    const cardMarginal = board.create({
      id: 'card-marginal',
      type: 'html-card',
      x: 800 + HTML_VIEWPORT_MARGIN - 20,
      y: 100,
      w: 50,
      h: 50,
      props: { title: 'In Margin' },
    });

    flushFrames();

    // Mounted because it falls within the buffer margin
    expect(cameraHost.querySelector(`[data-kujam-element-id="${cardMarginal.id}"]`)).not.toBeNull();
  });

  it('calls update when element props or position change', () => {
    const { board } = setup({ width: 800, height: 600 });

    const card = board.create({
      id: 'card-1',
      type: 'html-card',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { title: 'Initial' },
    });

    flushFrames();
    expect(cardUpdates).toBe(0);

    board.update(card.id, { props: { title: 'Updated Title' } });
    flushFrames();

    expect(cardUpdates).toBe(1);
    const host = document.querySelector(`[data-kujam-element-id="${card.id}"]`);
    expect(host?.textContent).toBe('Updated Title');
  });

  it('destroys mounted views on unmount or page change', () => {
    const { board, view } = setup({ width: 800, height: 600 });

    board.create({
      id: 'card-1',
      type: 'html-card',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { title: 'Card' },
    });

    flushFrames();
    expect(cardDestroys).toBe(0);

    // Switch page
    board.pages.create({ id: 'page:2' });
    board.pages.setCurrent('page:2');
    flushFrames();

    expect(cardDestroys).toBe(1);

    // Switch back
    board.pages.setCurrent('page:main');
    flushFrames();
    expect(cardDestroys).toBe(1);

    view.unmount();
    expect(cardDestroys).toBe(2);
  });
});

describe('BOARD-804: Stacking Order Consistency', () => {
  it('orders DOM children consistently with layer paint order', () => {
    const { board, view } = setup({ width: 800, height: 600 });
    const elementsHost = view.layers.htmlCamera.querySelector(
      '[data-kujam-html-elements]',
    ) as HTMLElement;

    // Create cards with explicit indices
    const cardB = board.create({
      id: 'card-b',
      type: 'html-card',
      index: 'a2',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { title: 'B' },
    });
    const cardA = board.create({
      id: 'card-a',
      type: 'html-card',
      index: 'a1',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { title: 'A' },
    });
    const cardC = board.create({
      id: 'card-c',
      type: 'html-card',
      index: 'a3',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { title: 'C' },
    });

    flushFrames();

    const ids = [...elementsHost.children].map((child) => (child as HTMLElement).dataset.kujamElementId);
    // Even though created out of order, DOM order strictly matches index 'a1' -> 'a2' -> 'a3'
    expect(ids).toEqual([cardA.id, cardB.id, cardC.id]);
  });
});

describe('BOARD-804: Text Editor Host', () => {
  it('mounts active text editor in the HTML camera layer and cleans up on unmount', () => {
    const { board, view } = setup({ width: 800, height: 600 });
    const cameraHost = view.layers.htmlCamera;

    const editorEl = document.createElement('div');
    editorEl.contentEditable = 'true';
    editorEl.textContent = 'Active text editing...';

    const unmountEditor = view.mountEditor(editorEl, {
      x: 200,
      y: 150,
      w: 300,
      h: 50,
      rotation: 10,
    });

    expect(editorEl.parentElement?.dataset.kujamHtmlEditor).toBe('');
    expect(editorEl.parentElement?.parentElement).toBe(cameraHost);
    expect(editorEl.style.position).toBe('absolute');
    expect(editorEl.style.left).toBe('200px');
    expect(editorEl.style.top).toBe('150px');
    expect(editorEl.style.width).toBe('300px');
    expect(editorEl.style.height).toBe('50px');
    expect(editorEl.style.transform).toBe('rotate(10deg)');
    expect(editorEl.style.pointerEvents).toBe('auto');

    // Moves with camera transform
    board.setCamera({ x: 50, y: 50, zoom: 1.5 });
    flushFrames();
    expect(cameraHost.style.transform).toBe('translate(-75px, -75px) scale(1.5)');

    // Unmount editor
    unmountEditor();
    expect(editorEl.parentElement).toBeNull();
  });
});
