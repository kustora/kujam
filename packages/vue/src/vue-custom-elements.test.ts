// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createApp,
  defineComponent,
  h,
  inject,
  nextTick,
  onBeforeUnmount,
  provide,
  type App,
  type Component,
  type InjectionKey,
} from 'vue';
import {
  createBoard,
  defineElement,
  definePlugin,
  object,
  string,
  type Board as CoreBoard,
  type BoardResolvers,
  type ElementContext,
  type ElementHtmlHost,
  type ElementRecord,
} from '@kujam/core';
import {
  Board,
  defineVueElement,
  type CustomVueElementProps,
} from './index.js';

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

let apps: App[] = [];
let boards: CoreBoard[] = [];

beforeEach(() => {
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
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  for (const app of apps) app.unmount();
  for (const board of boards) {
    if (!board.disposed) board.dispose();
  }
  apps = [];
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function renderWithApp(
  component: Component,
  width = 800,
  height = 600,
): { container: HTMLDivElement; app: App } {
  const container = document.body.appendChild(document.createElement('div'));
  vi.spyOn(container, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(height);

  const app = createApp(component);
  apps.push(app);
  app.mount(container);

  const observer = FakeResizeObserver.instances.at(-1);
  if (observer) observer.resize(width, height);
  flushFrames();

  return { container, app };
}

describe('BOARD-1305: Vue Custom Elements in <Board>', () => {
  it('renders custom element via <Board :elements="{ ... }"> with Vue component', async () => {
    const board = createBoard();
    boards.push(board);

    const ItemCard = defineComponent({
      name: 'ItemCard',
      props: ['element', 'data', 'status', 'board'],
      setup(props) {
        return () =>
          h(
            'div',
            { class: 'item-card', 'data-testid': 'item' },
            `Item ID: ${props.element.id}`,
          );
      },
    });

    const { container } = renderWithApp({
      render() {
        return h(Board, {
          board,
          elements: { 'custom-item': ItemCard },
        });
      },
    });

    board.create({
      id: 'i1',
      type: 'custom-item',
      x: 10,
      y: 10,
      w: 200,
      h: 100,
    });
    flushFrames();
    await nextTick();

    const itemNode = container.querySelector('.item-card');
    expect(itemNode).not.toBeNull();
    expect(itemNode?.textContent).toBe('Item ID: i1');
  });

  it('passes typed props: element, data, status, and board', async () => {
    interface ItemData {
      name: string;
      stock: number;
    }

    const resolvers: BoardResolvers = {
      product: (id: string) => ({ name: `Product ${id}`, stock: 42 }),
    };

    const resolvedElement = defineElement({
      type: 'product-card',
      version: 1,
      props: object({ productId: string() }),
      defaults: { productId: 'p1' },
      resolve: (el, ctx) => ctx.resolvers.product!(el.props.productId) as ItemData,
    });

    const plugin = definePlugin({
      id: 'products',
      elements: [resolvedElement],
    });

    const board = createBoard({
      plugins: [plugin],
      resolvers,
    });
    boards.push(board);

    let capturedProps: CustomVueElementProps<{ productId: string }, ItemData> | null = null;

    const ProductCard = defineComponent({
      name: 'ProductCard',
      props: ['element', 'data', 'status', 'board'],
      setup(props) {
        capturedProps = props as unknown as CustomVueElementProps<{ productId: string }, ItemData>;
        return () =>
          h(
            'div',
            { class: 'product-card' },
            `${(props.data as ItemData)?.name ?? 'loading'} - ${(props.data as ItemData)?.stock ?? 0}`,
          );
      },
    });

    const { container } = renderWithApp({
      render() {
        return h(Board, {
          board,
          elements: { 'product-card': ProductCard },
        });
      },
    });

    board.create({
      id: 'prod-100',
      type: 'product-card',
      x: 20,
      y: 20,
      w: 180,
      h: 90,
      props: { productId: '100' },
    });
    flushFrames();
    await nextTick();

    expect(capturedProps).not.toBeNull();
    expect(capturedProps!.element.id).toBe('prod-100');
    expect(capturedProps!.element.props.productId).toBe('100');
    expect(capturedProps!.data).toEqual({ name: 'Product 100', stock: 42 });
    expect(capturedProps!.status).toBe('ready');
    expect(capturedProps!.board).toBe(board);

    const card = container.querySelector('.product-card');
    expect(card?.textContent).toBe('Product 100 - 42');
  });

  it('preserves Vue provide/inject inheritance across Teleport', async () => {
    const ThemeKey: InjectionKey<string> = Symbol('ThemeKey');
    const UserKey: InjectionKey<{ name: string }> = Symbol('UserKey');

    const ContextCard = defineComponent({
      name: 'ContextCard',
      props: ['element', 'data', 'status', 'board'],
      setup() {
        const theme = inject(ThemeKey);
        const user = inject(UserKey);
        return () =>
          h('div', { class: 'context-card' }, `Theme: ${theme}, User: ${user?.name}`);
      },
    });

    const board = createBoard();
    boards.push(board);

    const RootApp = defineComponent({
      setup() {
        provide(ThemeKey, 'dark-mode');
        provide(UserKey, { name: 'Alice' });

        return () =>
          h(Board, {
            board,
            elements: { 'context-test': ContextCard },
          });
      },
    });

    const { container } = renderWithApp(RootApp);

    board.create({
      id: 'ctx-1',
      type: 'context-test',
      x: 0,
      y: 0,
      w: 150,
      h: 80,
    });
    flushFrames();
    await nextTick();

    const node = container.querySelector('.context-card');
    expect(node?.textContent).toBe('Theme: dark-mode, User: Alice');
  });

  it('updates props re-actively and cleans up on element unmount/deletion', async () => {
    const unmountedIds: string[] = [];

    const TrackedCard = defineComponent({
      name: 'TrackedCard',
      props: ['element', 'data', 'status', 'board'],
      setup(props) {
        onBeforeUnmount(() => {
          unmountedIds.push(props.element.id);
        });
        return () => h('div', { class: 'tracked-card' }, props.element.props.title as string);
      },
    });

    const trackedDef = defineElement({
      type: 'tracked-card',
      version: 1,
      props: object({ title: string() }),
      defaults: { title: '' },
    });
    const plugin = definePlugin({
      id: 'tracked-plugin',
      elements: [trackedDef],
    });
    const board = createBoard({ plugins: [plugin] });
    boards.push(board);

    const { container } = renderWithApp({
      render() {
        return h(Board, {
          board,
          elements: { 'tracked-card': TrackedCard },
        });
      },
    });

    const el = board.create({
      id: 'track-1',
      type: 'tracked-card',
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      props: { title: 'First Title' },
    });
    flushFrames();
    await nextTick();

    let node = container.querySelector('.tracked-card');
    expect(node?.textContent).toBe('First Title');

    // 1. Update element props
    board.update(el!.id, {
      props: { title: 'Second Title' },
    });
    flushFrames();
    await nextTick();

    node = container.querySelector('.tracked-card');
    expect(node?.textContent).toBe('Second Title');
    expect(unmountedIds).toEqual([]);

    // 2. Delete element
    board.delete(el!.id);
    flushFrames();
    await nextTick();

    expect(unmountedIds).toEqual(['track-1']);
    expect(container.querySelector('.tracked-card')).toBeNull();
  });

  it('automatically sets pointer-events: auto on data-board-interactive elements', async () => {
    const InteractiveCard = defineComponent({
      name: 'InteractiveCard',
      setup() {
        return () =>
          h('div', { class: 'interactive-wrapper' }, [
            h('button', { 'data-board-interactive': '', class: 'my-btn' }, 'Click me'),
            h('span', { class: 'plain-text' }, 'Plain'),
          ]);
      },
    });

    const board = createBoard();
    boards.push(board);

    const { container } = renderWithApp({
      render() {
        return h(Board, {
          board,
          elements: { 'interactive-card': InteractiveCard },
        });
      },
    });

    board.create({
      id: 'inter-1',
      type: 'interactive-card',
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
    flushFrames();
    await nextTick();

    const btn = container.querySelector<HTMLElement>('.my-btn');
    const span = container.querySelector<HTMLElement>('.plain-text');

    expect(btn).not.toBeNull();
    expect(btn?.style.pointerEvents).toBe('auto');
    expect(span?.style.pointerEvents).not.toBe('auto');
  });

  it('standalone defineVueElement mounts via createApp fallback outside <Board>', () => {
    const StandaloneCard = defineComponent({
      name: 'StandaloneCard',
      props: ['element'],
      setup(props) {
        return () => h('div', { class: 'standalone-content' }, `Standalone: ${props.element.id}`);
      },
    });

    const elementDef = defineVueElement({
      type: 'standalone-el',
      component: StandaloneCard,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const fakeRecord: ElementRecord = {
      id: 'sa-1',
      type: 'standalone-el',
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      index: 'a0',
      kind: 'element',
      pageId: 'page:1',
      parentId: null,
      locked: false,
      opacity: 1,
      rotation: 0,
      props: {},
    };

    const view = elementDef.render.html(
      host as unknown as ElementHtmlHost,
      fakeRecord,
      undefined,
      {} as unknown as ElementContext,
    );

    const rendered = host.querySelector('.standalone-content');
    expect(rendered).not.toBeNull();
    expect(rendered?.textContent).toBe('Standalone: sa-1');

    view.destroy();
    expect(host.querySelector('.standalone-content')).toBeNull();
    host.remove();
  });
});
