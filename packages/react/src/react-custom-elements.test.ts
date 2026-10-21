// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createBoard,
  defineElement,
  definePlugin,
  object,
  string,
  type Board as CoreBoard,
  type BoardResolvers,
  type ElementHtmlView,
} from '@kujam/core';
import {
  Board,
  defineReactElement,
  type CustomElementComponentProps,
} from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

let roots: Root[] = [];
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
  act(() => {
    for (const root of roots) root.unmount();
  });
  for (const board of boards) {
    if (!board.disposed) board.dispose();
  }
  roots = [];
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function renderWithContainer(node: ReactNode, width = 800, height = 600): {
  container: HTMLDivElement;
  root: Root;
  observer: FakeResizeObserver | undefined;
} {
  const container = document.body.appendChild(document.createElement('div'));
  vi.spyOn(container, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(height);

  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));

  const observer = FakeResizeObserver.instances.at(-1);
  if (observer) observer.resize(width, height);
  act(() => flushFrames());

  return { container, root, observer };
}

describe('BOARD-1304: React Custom Elements in <Board>', () => {
  it('renders custom element via <Board elements={{ ... }}> with React component', () => {
    const board = createBoard();
    boards.push(board);

    function PostCard({ element }: CustomElementComponentProps) {
      return createElement(
        'div',
        { className: 'post-card', 'data-testid': 'post' },
        `Post ID: ${element.id}`,
      );
    }

    const { container } = renderWithContainer(
      createElement(Board, {
        board,
        elements: { 'tayang-post': PostCard },
      }),
    );

    act(() => {
      board.create({
        id: 'p1',
        type: 'tayang-post',
        x: 10,
        y: 10,
        w: 200,
        h: 100,
      });
      flushFrames();
    });

    const postNode = container.querySelector('.post-card');
    expect(postNode).not.toBeNull();
    expect(postNode?.textContent).toBe('Post ID: p1');

    const host = container.querySelector('[data-kujam-element-id="p1"]') as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.style.pointerEvents).toBe('none');
  });

  it('passes typed props to the custom component: element, data, status, board', () => {
    let capturedProps: CustomElementComponentProps | undefined;

    function InspectorCard(props: CustomElementComponentProps) {
      capturedProps = props;
      return createElement(
        'div',
        { className: 'inspector-card' },
        `Status: ${props.status}`,
      );
    }

    const board = createBoard();
    boards.push(board);

    renderWithContainer(
      createElement(Board, {
        board,
        elements: { inspector: InspectorCard },
      }),
    );

    let el: any;
    act(() => {
      el = board.create({
        id: 'insp-1',
        type: 'inspector',
        x: 20,
        y: 20,
        w: 150,
        h: 80,
      });
      flushFrames();
    });

    expect(capturedProps).toBeDefined();
    expect(capturedProps?.element.id).toBe(el.id);
    expect(capturedProps?.element.type).toBe('inspector');
    expect(capturedProps?.board).toBe(board);
    expect(capturedProps?.status).toBe('ready');
    expect(capturedProps?.data).toBeUndefined();
  });

  it('inherits React Context naturally across the portal boundary', () => {
    interface ThemeContextValue {
      colorScheme: string;
      fontSize: number;
    }
    const AppThemeContext = createContext<ThemeContextValue>({
      colorScheme: 'light',
      fontSize: 14,
    });

    function ThemedCard({ element }: CustomElementComponentProps) {
      const theme = useContext(AppThemeContext);
      return createElement(
        'div',
        {
          className: 'themed-card',
          'data-color-scheme': theme.colorScheme,
          'data-font-size': theme.fontSize,
        },
        `Theme: ${theme.colorScheme}`,
      );
    }

    const board = createBoard();
    boards.push(board);

    const { container } = renderWithContainer(
      createElement(
        AppThemeContext.Provider,
        { value: { colorScheme: 'dark', fontSize: 18 } },
        createElement(Board, {
          board,
          elements: { 'themed-card': ThemedCard },
        }),
      ),
    );

    act(() => {
      board.create({
        id: 'tc1',
        type: 'themed-card',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
      });
      flushFrames();
    });

    const card = container.querySelector('.themed-card') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.dataset.colorScheme).toBe('dark');
    expect(card.dataset.fontSize).toBe('18');
    expect(card.textContent).toBe('Theme: dark');
  });

  it('updates when element props or external data change', async () => {
    interface ItemData {
      title: string;
    }
    const titles: Record<string, string> = { i1: 'Original Title' };
    const resolvers: BoardResolvers = {
      item: (id: string) => ({ title: titles[id] ?? id }),
    };

    const resolvedElement = defineElement({
      type: 'article-card',
      version: 1,
      props: object({ itemId: string(), subtitle: string() }),
      defaults: { itemId: 'i1', subtitle: 'Sub 1' },
      resolve: (el, ctx) => ctx.resolvers.item!(el.props.itemId) as ItemData,
    });

    const plugin = definePlugin({
      id: 'articles',
      elements: [resolvedElement],
    });

    const board = createBoard({
      plugins: [plugin],
      resolvers,
    });
    boards.push(board);

    function ArticleCard({
      element,
      data,
    }: CustomElementComponentProps<{ itemId: string; subtitle: string }, ItemData>) {
      return createElement(
        'div',
        { className: 'article-card' },
        createElement('h4', null, data?.title ?? 'No title'),
        createElement('p', null, element.props.subtitle),
      );
    }

    const { container } = renderWithContainer(
      createElement(Board, {
        board,
        elements: { 'article-card': ArticleCard },
      }),
    );

    let article: any;
    act(() => {
      article = board.create({
        id: 'art-1',
        type: 'article-card',
        x: 10,
        y: 10,
        w: 200,
        h: 120,
        props: { itemId: 'i1', subtitle: 'Initial Subtitle' },
      });
      flushFrames();
    });

    const titleEl = container.querySelector('.article-card h4');
    const subEl = container.querySelector('.article-card p');
    expect(titleEl?.textContent).toBe('Original Title');
    expect(subEl?.textContent).toBe('Initial Subtitle');

    // 1. Update element props
    act(() => {
      board.update(article.id, {
        props: { subtitle: 'Updated Subtitle' },
      });
      flushFrames();
    });

    expect(container.querySelector('.article-card p')?.textContent).toBe('Updated Subtitle');

    // 2. Invalidate external data
    act(() => {
      titles.i1 = 'Refreshed Title';
      board.invalidate('item', 'i1');
      flushFrames();
    });

    expect(container.querySelector('.article-card h4')?.textContent).toBe('Refreshed Title');
  });

  it('unmounts and cleans up when element is deleted or leaves viewport', () => {
    const unmountedIds: string[] = [];

    function TrackedCard({ element }: CustomElementComponentProps) {
      useEffect(() => {
        return () => {
          unmountedIds.push(element.id);
        };
      }, [element.id]);

      return createElement('div', { className: 'tracked-card' }, element.id);
    }

    const board = createBoard();
    boards.push(board);

    const { container } = renderWithContainer(
      createElement(Board, {
        board,
        elements: { tracked: TrackedCard },
      }),
    );

    let c1: any;
    let c2: any;
    act(() => {
      c1 = board.create({ id: 'c1', type: 'tracked', x: 0, y: 0, w: 100, h: 50 });
      c2 = board.create({ id: 'c2', type: 'tracked', x: 120, y: 0, w: 100, h: 50 });
      flushFrames();
    });

    expect(container.querySelectorAll('.tracked-card')).toHaveLength(2);
    expect(unmountedIds).toEqual([]);

    // 1. Delete element c1
    act(() => {
      board.delete(c1.id);
      flushFrames();
    });

    expect(unmountedIds).toContain('c1');
    expect(container.querySelector('[data-kujam-element-id="c1"]')).toBeNull();

    // 2. Move element c2 far outside the viewport
    act(() => {
      board.update(c2.id, { x: 50_000, y: 50_000 });
      flushFrames();
    });

    expect(unmountedIds).toContain('c2');
    expect(container.querySelector('[data-kujam-element-id="c2"]')).toBeNull();
  });

  it('respects data-board-interactive on nodes and enables pointer events for interactions', () => {
    let clickCount = 0;

    function InteractiveCard() {
      const [count, setCount] = useState(0);

      return createElement(
        'div',
        { className: 'interactive-card' },
        createElement('span', null, `Count: ${count}`),
        createElement(
          'button',
          {
            'data-board-interactive': '',
            onClick: () => {
              clickCount++;
              setCount((c) => c + 1);
            },
          },
          'Click me',
        ),
      );
    }

    const board = createBoard();
    boards.push(board);

    const { container } = renderWithContainer(
      createElement(Board, {
        board,
        elements: { interactive: InteractiveCard },
      }),
    );

    act(() => {
      board.create({
        id: 'btn-1',
        type: 'interactive',
        x: 0,
        y: 0,
        w: 200,
        h: 100,
      });
      flushFrames();
    });

    const host = container.querySelector('[data-kujam-element-id="btn-1"]') as HTMLElement;
    expect(host.style.pointerEvents).toBe('none');

    const button = host.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.style.pointerEvents).toBe('auto');

    act(() => {
      button.click();
    });

    expect(clickCount).toBe(1);
    expect(host.querySelector('span')?.textContent).toBe('Count: 1');
  });

  it('defineReactElement works standalone outside <Board> with fallback createRoot', () => {
    let unmounted = false;

    function StandaloneCard({ element }: CustomElementComponentProps) {
      useEffect(() => {
        return () => {
          unmounted = true;
        };
      }, []);

      return createElement('div', { className: 'standalone-card' }, element.props.name as string);
    }

    const elementDef = defineReactElement({
      type: 'standalone-card',
      component: StandaloneCard,
    });

    const host = document.body.appendChild(document.createElement('div'));
    const el = {
      id: 'sa-1',
      type: 'standalone-card',
      pageId: 'p1',
      index: 'a0',
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      rotation: 0,
      opacity: 1,
      locked: false,
      typeVersion: 1,
      props: { name: 'Initial Standalone' },
    };

    const mockCtx = {
      locale: 'en',
      theme: { mode: 'light' } as any,
      emit: vi.fn(),
      resolveBrush: vi.fn(),
    };

    let view!: ElementHtmlView<any, any>;
    act(() => {
      view = elementDef.render!.html!(host, el as any, undefined, mockCtx);
    });

    expect(host.querySelector('.standalone-card')?.textContent).toBe('Initial Standalone');

    // Update
    act(() => {
      view.update({ ...el, props: { name: 'Updated Standalone' } } as any, undefined);
    });
    expect(host.querySelector('.standalone-card')?.textContent).toBe('Updated Standalone');

    // Destroy
    act(() => {
      view.destroy();
    });
    expect(unmounted).toBe(true);
  });

  it('renders many custom element cards efficiently in a single unified React tree', () => {
    function SimpleCard({ element }: CustomElementComponentProps) {
      return createElement('div', { className: 'card' }, `Card ${element.id}`);
    }

    const board = createBoard();
    boards.push(board);

    const { container } = renderWithContainer(
      createElement(Board, {
        board,
        elements: { card: SimpleCard },
      }),
      2000,
      2000,
    );

    act(() => {
      for (let i = 0; i < 100; i++) {
        board.create({
          id: `c-${i}`,
          type: 'card',
          x: (i % 10) * 120,
          y: Math.floor(i / 10) * 80,
          w: 100,
          h: 60,
        });
      }
      flushFrames();
    });

    const renderedCards = container.querySelectorAll('.card');
    expect(renderedCards).toHaveLength(100);
    expect(renderedCards[0]?.textContent).toBe('Card c-0');
    expect(renderedCards[99]?.textContent).toBe('Card c-99');
  });
});
