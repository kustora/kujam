// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defaultCommands,
  defineElement,
  definePlugin,
  object,
  string,
  type Board,
  type BoardLocale,
} from '@kujam/core';
import { mountRenderer, type BoardView } from '../index.js';
import { A11Y_MAX_ITEMS, A11Y_SYNC_INTERVAL_MS } from './a11y-tree.js';

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

const noop = () => {};
const fakeContext = new Proxy(
  { measureText: () => ({ width: 0 }) },
  { get: (target, key) => (key in target ? target[key as keyof typeof target] : noop) },
);

const note = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
  onDoubleClick: noop,
  a11y: (el, _data, ctx) => ({
    role: 'note',
    label: `${ctx.locale === 'en' ? 'Note' : 'Catatan'}: ${el.props.text}`,
  }),
});
/** No `a11y` callback: gets the localized fallback label. */
const box = defineElement({ type: 'box', version: 1, props: object({}), defaults: {} });
const elements = definePlugin({ id: 'test-elements', elements: [note, box] });

let boards: Board[] = [];
let views: BoardView[] = [];

function setup(options: { locale?: BoardLocale; size?: [number, number] } = {}) {
  const board = createBoard({
    plugins: [elements, defaultCommands],
    platform: 'other',
    locale: options.locale,
  });
  boards.push(board);
  const container = document.body.appendChild(document.createElement('div'));
  const view = mountRenderer(board, container);
  views.push(view);
  const [width, height] = options.size ?? [800, 600];
  FakeResizeObserver.instances.at(-1)!.resize(width, height);
  return { board, view, root: view.layers.root, list: listOf(view) };
}

function listOf(view: BoardView): HTMLElement {
  return view.layers.a11y.querySelector('[role="list"]') as HTMLElement;
}

/** Runs pending reconciliations and animation frames. */
function settle(): void {
  vi.advanceTimersByTime(A11Y_SYNC_INTERVAL_MS + 1);
  flushFrames();
}

function items(view: BoardView): HTMLElement[] {
  return [...listOf(view).children] as HTMLElement[];
}

function ids(view: BoardView): string[] {
  return items(view).map((item) => item.dataset.kujamA11yId!);
}

/** The focusable node of an element's item. */
function target(view: BoardView, id: string): HTMLElement {
  const item = listOf(view).querySelector(`[data-kujam-a11y-id="${id}"]`) as HTMLElement;
  return (item.querySelector('[tabindex]') as HTMLElement | null) ?? item;
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  FakeResizeObserver.instances = [];
  frames.clear();
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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('BOARD-1901: parallel accessibility tree', () => {
  it('lists elements with their a11y role and label in reading order', () => {
    const { board, view, root } = setup();
    board.create({ id: 'c', type: 'note', x: 0, y: 300, w: 100, h: 100, props: { text: 'Tiga' } });
    board.create({ id: 'b', type: 'box', x: 200, y: 0, w: 100, h: 100 });
    board.create({ id: 'a', type: 'note', x: 0, y: 0, w: 100, h: 100, props: { text: 'Satu' } });
    settle();

    expect(ids(view)).toEqual(['a', 'b', 'c']);
    const [a, b] = items(view);
    expect(a!.getAttribute('role')).toBe('listitem');
    expect(target(view, 'a').getAttribute('role')).toBe('note');
    expect(target(view, 'a').getAttribute('aria-label')).toBe('Catatan: Satu');
    // Without an `a11y` callback the item itself is focusable, with a localized fallback label.
    expect(target(view, 'b')).toBe(b);
    expect(b!.getAttribute('aria-label')).toBe('Elemen box');
    expect(items(view).map((item) => item.getAttribute('aria-posinset'))).toEqual(['1', '2', '3']);
    expect(a!.getAttribute('aria-setsize')).toBe('3');

    expect(root.getAttribute('role')).toBe('region');
    expect(root.getAttribute('aria-label')).toBe('Papan tulis');
    const help = document.getElementById(root.getAttribute('aria-describedby')!)!;
    expect(help.textContent).toContain('Esc lalu Tab');
    expect(listOf(view).getAttribute('aria-label')).toBe('Elemen papan');
  });

  it('uses English through the board locale', () => {
    const { board, view, root } = setup({ locale: 'en' });
    board.create({ id: 'b', type: 'box', x: 0, y: 0, w: 10, h: 10, locked: true });
    settle();
    expect(target(view, 'b').getAttribute('aria-label')).toBe('box element');
    expect(target(view, 'b').getAttribute('aria-description')).toBe('Locked');
    expect(root.getAttribute('aria-label')).toBe('Whiteboard');
    expect(listOf(view).getAttribute('aria-label')).toBe('Board elements');
  });

  it('is invisible and never takes pointer input', () => {
    const { board, view } = setup();
    board.create({ id: 'a', type: 'note', x: 10, y: 20, w: 100, h: 50, rotation: 30 });
    board.camera.set({ x: 5, y: 5, zoom: 2 });
    settle();
    const { a11y, canvas, overlay } = view.layers;
    expect(a11y.style.pointerEvents).toBe('none');
    expect(a11y.style.overflow).toBe('hidden');
    for (const node of a11y.querySelectorAll<HTMLElement>(
      '[role="list"], [role="listitem"], [tabindex]',
    )) {
      expect(node.style.pointerEvents).toBe('none');
    }
    expect(listOf(view).textContent).toBe('');
    // Items sit at their elements, under one camera transform.
    expect(listOf(view).style.transform).toBe('translate(-10px, -10px) scale(2)');
    expect(items(view)[0]!.style).toMatchObject({
      left: '10px',
      top: '20px',
      width: '100px',
      height: '50px',
      transform: 'rotate(30deg)',
    });
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
  });

  it('patches changed items in place and follows additions and deletions', () => {
    const { board, view } = setup();
    board.create({ id: 'a', type: 'note', x: 0, y: 0, w: 100, h: 100, props: { text: 'Lama' } });
    board.create({ id: 'b', type: 'note', x: 200, y: 0, w: 100, h: 100 });
    settle();
    const before = items(view)[0];

    board.update('a', { props: { text: 'Baru' } });
    flushFrames();
    expect(items(view)[0]).toBe(before);
    expect(target(view, 'a').getAttribute('aria-label')).toBe('Catatan: Baru');

    board.update('a', { x: 400 });
    settle();
    expect(ids(view)).toEqual(['b', 'a']);
    expect(items(view)[1]).toBe(before);

    board.delete('b');
    expect(ids(view)).toEqual(['a']); // removed at once
    board.create({ id: 'c', type: 'box', x: 0, y: 300, w: 10, h: 10 });
    settle();
    expect(ids(view)).toEqual(['a', 'c']);
    expect(items(view).map((item) => item.getAttribute('aria-setsize'))).toEqual(['2', '2']);
  });

  it('virtualizes large boards to the viewport and keeps the full count', () => {
    const { board, view } = setup();
    board.transact(() => {
      for (let i = 0; i < 3000; i++) {
        const x = (i % 60) * 150;
        const y = Math.floor(i / 60) * 150;
        board.create({ id: `n${i}`, type: 'box', x, y, w: 100, h: 100 });
      }
    });
    settle();
    const visible = ids(view);
    // 800×600 plus a 100 px margin covers about 7 columns × 6 rows.
    expect(visible.length).toBeGreaterThan(20);
    expect(visible.length).toBeLessThan(80);
    expect(visible[0]).toBe('n0');
    expect(items(view)[0]!.getAttribute('aria-setsize')).toBe('3000');

    const kept = items(view).find((item) => item.dataset.kujamA11yId === 'n3')!;
    board.camera.set({ x: 300, y: 0 });
    settle();
    expect(ids(view)).not.toContain('n0');
    expect(ids(view)).toContain('n8');
    // Elements that stay visible keep their DOM node.
    expect(items(view).find((item) => item.dataset.kujamA11yId === 'n3')).toBe(kept);

    board.camera.set({ x: 0, y: 0, zoom: 0.1 });
    settle();
    expect(items(view)).toHaveLength(A11Y_MAX_ITEMS);
  });

  it('coalesces camera moves and waits for drags to finish', () => {
    const { board, view } = setup();
    board.create({ id: 'a', type: 'box', x: 0, y: 0, w: 10, h: 10 });
    board.create({ id: 'far', type: 'box', x: 5000, y: 0, w: 10, h: 10 });
    settle();
    expect(ids(view)).toEqual(['a']);
    const query = vi.spyOn(board, 'query');
    for (let i = 1; i <= 20; i++) board.camera.set({ x: i * 250 });
    vi.advanceTimersByTime(A11Y_SYNC_INTERVAL_MS + 1);
    // One reconciliation (one spatial query) for 20 camera moves.
    expect(query).toHaveBeenCalledTimes(1);
    expect(ids(view)).toEqual(['far']);

    // While a tool interaction runs (for example a drag), reconciliation waits.
    board.tools.register({
      id: 'hold',
      initial: 'idle',
      states: { idle: { onPointerDown: () => 'holding' }, holding: {} },
    });
    board.setTool('hold');
    board.dispatch({
      type: 'pointer-down',
      pointerId: 1,
      pointerType: 'mouse',
      point: { x: 5000, y: 0 },
      screen: { x: 0, y: 0 },
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 1,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    board.camera.set({ x: 0 });
    vi.advanceTimersByTime(A11Y_SYNC_INTERVAL_MS * 5);
    expect(ids(view)).toEqual(['far']);
    board.dispatch({
      type: 'key-down',
      key: 'Escape',
      code: 'Escape',
      repeat: false,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    expect(board.toolState).toBe('idle');
    vi.advanceTimersByTime(A11Y_SYNC_INTERVAL_MS + 1);
    expect(ids(view)).toEqual(['a']);
  });
});

describe('BOARD-1902: keyboard focus and navigation', () => {
  function threeNotes() {
    const ctx = setup();
    const { board } = ctx;
    board.create({ id: 'a', type: 'note', x: 0, y: 0, w: 100, h: 100, props: { text: 'A' } });
    board.create({ id: 'b', type: 'note', x: 200, y: 0, w: 100, h: 100, props: { text: 'B' } });
    board.create({ id: 'c', type: 'note', x: 400, y: 0, w: 100, h: 100, props: { text: 'C' } });
    settle();
    ctx.root.focus();
    return ctx;
  }

  it('Tab moves DOM focus through the elements in reading order', () => {
    const { board, view } = threeNotes();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(board.selection).toEqual(['a']);
    expect(document.activeElement).toBe(target(view, 'a'));
    press('Tab');
    expect(document.activeElement).toBe(target(view, 'b'));
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(target(view, 'a'));
  });

  it('shows a 2px focus ring 2px outside the element after keyboard use only', () => {
    const { board, view, root } = threeNotes();
    board.camera.set({ zoom: 2 });
    flushFrames();
    press('Tab');
    const focused = target(view, 'a');
    // The list is scaled by the zoom, so 1 board unit is 2 screen pixels here.
    expect(focused.style).toMatchObject({
      outlineStyle: 'solid',
      outlineWidth: '1px',
      outlineColor: '#2F6FDB',
      outlineOffset: '1px',
    });

    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(focused.style.outlineStyle).toBe('none');
    board.setTheme('dark');
    press('Shift'); // keyboard use again
    expect(focused.style).toMatchObject({ outlineStyle: 'solid', outlineColor: '#6EA0F0' });
  });

  it('lets Tab leave the board after the last element and Shift+Tab before the first', () => {
    const { board, view } = threeNotes();
    board.select('c');
    expect(document.activeElement).toBe(target(view, 'c'));
    expect(press('Tab').defaultPrevented).toBe(false);
    board.select('a');
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
  });

  it('Esc returns focus to the board, then Tab leaves it', () => {
    const { board, view, root } = threeNotes();
    press('Tab');
    press('Tab');
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(board.selection).toEqual([]);
    expect(document.activeElement).toBe(root);
    const exit = press('Tab');
    expect(exit.defaultPrevented).toBe(false);
    expect(board.selection).toEqual([]);
    // Without the Esc right before, Tab from the board enters the elements again.
    root.blur();
    root.focus();
    press('Tab');
    expect(document.activeElement).toBe(target(view, 'a'));
  });

  it('entering the board from outside resumes at the selected element', () => {
    const { view, root } = threeNotes();
    press('Tab');
    press('Tab');
    const outside = document.body.appendChild(document.createElement('button'));
    outside.focus();
    root.focus();
    expect(document.activeElement).toBe(target(view, 'b'));
    press('Tab');
    expect(document.activeElement).toBe(target(view, 'c'));
  });

  it('keeps focus on the board when the focused element is deleted', () => {
    const { board, root } = threeNotes();
    press('Tab');
    expect(press('Delete').defaultPrevented).toBe(true);
    expect(board.getElement('a')).toBeUndefined();
    expect(document.activeElement).toBe(root);
  });

  it('arrow keys move the focused element and the item follows', () => {
    const { board, view } = threeNotes();
    press('Tab');
    press('ArrowRight', { shiftKey: true });
    press('ArrowDown');
    flushFrames();
    expect(board.getElement('a')).toMatchObject({ x: 10, y: 1 });
    expect(items(view)[0]!.style.left).toBe('10px');
    expect(document.activeElement).toBe(target(view, 'a'));
  });

  it('brings an off-screen element into the tree and the view when it gets focus', () => {
    const { board, view } = threeNotes();
    board.create({
      id: 'far',
      type: 'note',
      x: 3000,
      y: 0,
      w: 100,
      h: 100,
      props: { text: 'Jauh' },
    });
    settle();
    expect(ids(view)).not.toContain('far');
    board.select('c');
    press('Tab');
    expect(board.selection).toEqual(['far']);
    expect(document.activeElement).toBe(target(view, 'far'));
    expect(ids(view).at(-1)).toBe('far');
    const viewBounds = board.camera.getViewportBounds();
    expect(viewBounds.minX).toBeLessThanOrEqual(3000);
    expect(viewBounds.maxX).toBeGreaterThanOrEqual(3100);
    settle();
    expect(ids(view)).toContain('far');
    expect(document.activeElement).toBe(target(view, 'far'));
  });

  it('does not steal focus from outside the board', () => {
    const { board, view } = threeNotes();
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    board.select('b');
    expect(document.activeElement).toBe(input);
    settle();
    expect(ids(view)).toContain('b');
  });

  it('returns focus to the edited element when a focused editor closes', () => {
    const { board, view } = threeNotes();
    press('Tab');
    const editor = document.createElement('div');
    editor.tabIndex = 0;
    const close = view.mountEditor(editor, { x: 0, y: 0, w: 100, h: 100 });
    editor.focus();
    close();
    expect(board.selection).toEqual(['a']);
    expect(document.activeElement).toBe(target(view, 'a'));
  });

  it('leaves navigation keys to interactive content of custom HTML elements', () => {
    const { board, view } = threeNotes();
    const elementsHost = view.layers.htmlCamera.firstElementChild as HTMLElement;
    const button = elementsHost.appendChild(document.createElement('button'));
    button.focus();
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(press('Enter').defaultPrevented).toBe(false);
    expect(board.selection).toEqual([]);
  });

  it('ignores keys typed into text inputs on the board', () => {
    const { board, view } = threeNotes();
    press('Tab');
    const input = view.layers.htmlCamera.appendChild(document.createElement('input'));
    input.focus();
    press('ArrowRight');
    expect(board.getElement('a')).toMatchObject({ x: 0 });
  });
});
