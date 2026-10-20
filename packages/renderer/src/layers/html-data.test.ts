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
  type BoardResolvers,
} from '@kujam/core';
import { mountRenderer, type BoardView } from '../index.js';

interface Item {
  readonly title: string;
}

let boards: Board[] = [];
let views: BoardView[] = [];
const log = { mounts: [] as string[], updates: [] as string[], destroys: [] as string[] };

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
const tick = async () => {
  await new Promise((r) => setTimeout(r, 0));
  flushFrames();
};

const itemCard = defineElement({
  type: 'item-card',
  version: 1,
  props: schema({ itemId: string() }),
  defaults: { itemId: '' },
  geometry: (el) => rect(el.w, el.h),
  resolve: (el, ctx) => ctx.resolvers.item!(el.props.itemId) as Item | Promise<Item>,
  placeholder: (reason) => ({ label: reason === 'forbidden' ? 'Item privat' : '' }),
  render: {
    html: (host, el, data) => {
      log.mounts.push(el.id);
      const title = host.ownerDocument.createElement('strong');
      title.textContent = data?.title ?? '';
      const like = host.ownerDocument.createElement('button');
      like.dataset.boardInteractive = '';
      like.textContent = 'Suka';
      host.append(title, like);
      if (data?.title === 'boom') throw new Error('render bug');
      return {
        update: (next, nextData) => {
          log.updates.push(next.id);
          title.textContent = nextData?.title ?? '';
        },
        destroy: () => log.destroys.push(el.id),
      };
    },
  },
});

beforeEach(() => {
  log.mounts = [];
  log.updates = [];
  log.destroys = [];
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

function setup(resolvers: BoardResolvers) {
  const container = document.body.appendChild(document.createElement('div'));
  vi.spyOn(container, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(600);
  const board = createBoard({
    plugins: [definePlugin({ id: 'items', elements: [itemCard] })],
    resolvers,
  });
  boards.push(board);
  const view = mountRenderer(board, container);
  views.push(view);
  FakeResizeObserver.instances.at(-1)?.resize(800, 600);
  const add = (id: string, itemId: string, x = 10, y = 10) =>
    board.create({ id, type: 'item-card', x, y, w: 160, h: 90, props: { itemId } });
  const host = (id: string) =>
    container.querySelector<HTMLElement>(`[data-kujam-element-id="${id}"]`);
  return { board, add, host };
}

describe('BOARD-1201: render.html with resolved data', () => {
  it('mounts with data, updates on data or record changes only, not on camera moves', () => {
    const titles: Record<string, string> = { p1: 'Halo' };
    const { board, add, host } = setup({ item: (id) => ({ title: titles[id] ?? id }) });
    add('c1', 'p1');
    flushFrames();
    expect(host('c1')!.querySelector('strong')!.textContent).toBe('Halo');
    expect(log.mounts).toEqual(['c1']);

    board.setCamera({ x: 5, y: 5, zoom: 1.2 });
    flushFrames();
    expect(log.updates).toEqual([]);

    // A sync resolver refreshes in the same frame as the invalidate.
    titles.p1 = 'Halo lagi';
    board.invalidate('item', 'p1');
    flushFrames();
    expect(log.updates).toEqual(['c1']);
    expect(host('c1')!.querySelector('strong')!.textContent).toBe('Halo lagi');

    board.update('c1', { x: 40 });
    flushFrames();
    expect(log.updates).toEqual(['c1', 'c1']);
  });

  it('the host lets pointer events through except on data-board-interactive nodes', () => {
    const { add, host } = setup({ item: (id) => ({ title: id }) });
    add('c1', 'p1');
    flushFrames();
    expect(host('c1')!.style.pointerEvents).toBe('none');
    expect(host('c1')!.querySelector('button')!.style.pointerEvents).toBe('auto');
  });

  it('destroys views that leave the viewport, are deleted, or on unmount', () => {
    const { board, add } = setup({ item: (id) => ({ title: id }) });
    add('c1', 'p1');
    add('c2', 'p2');
    flushFrames();
    board.update('c1', { x: 5000 });
    flushFrames();
    board.delete('c2');
    flushFrames();
    expect(log.destroys.sort()).toEqual(['c1', 'c2']);
  });
});

describe('BOARD-1202: loading, placeholder, and error states', () => {
  it('shows a same-size skeleton while loading, then the view with data', async () => {
    const { add, host } = setup({ item: async (id) => ({ title: `async ${id}` }) });
    add('c1', 'p1');
    flushFrames();
    expect(host('c1')!.className).toContain('kujam-data-loading');
    expect(host('c1')!.style.width).toBe('160px');
    expect(log.mounts).toEqual([]);

    await tick();
    expect(log.mounts).toEqual(['c1']);
    expect(host('c1')!.querySelector('strong')!.textContent).toBe('async p1');
    expect(host('c1')!.className).not.toContain('kujam-data');
  });

  it('forbidden and not-found show the element placeholder without any data', () => {
    const { add, host } = setup({
      item: (id) => (id === 'secret' ? { status: 'forbidden' } : { status: 'not-found' }),
    });
    add('c1', 'secret');
    add('c2', 'gone');
    flushFrames();
    expect(host('c1')!.textContent).toBe('Item privat');
    expect(host('c2')!.textContent).toBe('Tidak ditemukan');
    expect(log.mounts).toEqual([]);
  });

  it('an error placeholder offers a retry that resolves again', async () => {
    let fail = true;
    const item = vi.fn(async (id: string) => {
      if (fail) throw new Error('down');
      return { title: id };
    });
    const { add, host } = setup({ item });
    add('c1', 'p1');
    flushFrames();
    await tick();
    const retry = host('c1')!.querySelector<HTMLButtonElement>('button')!;
    expect(host('c1')!.className).toContain('kujam-data-error');
    expect(retry.textContent).toBe('Coba lagi');

    fail = false;
    retry.click();
    flushFrames();
    await tick();
    expect(log.mounts).toEqual(['c1']);
    expect(item).toHaveBeenCalledTimes(2);
  });
});

describe('BOARD-1203: invalidating one ID updates only its element', () => {
  it('300 cards, one invalidate, one update', () => {
    const { board, add } = setup({ item: (id) => ({ title: id }) });
    for (let i = 0; i < 300; i++) add(`c${i}`, `p${i}`, (i % 20) * 30, Math.floor(i / 20) * 30);
    flushFrames();
    log.updates = [];
    board.invalidate('item', 'p7');
    flushFrames();
    expect(log.updates).toEqual(['c7']);
  });
});

describe('BOARD-1206: a throwing view only affects its element', () => {
  it('shows an error placeholder for that element and renders the others', () => {
    const { add, host } = setup({ item: (id) => ({ title: id === 'bad' ? 'boom' : id }) });
    add('c1', 'bad');
    add('c2', 'p2', 300);
    flushFrames();
    expect(host('c1')!.className).toBe('kujam-render-error');
    expect(host('c2')!.querySelector('strong')!.textContent).toBe('p2');
  });
});
