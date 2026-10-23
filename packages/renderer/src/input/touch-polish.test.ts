// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineTool,
  definePlugin,
  type Board,
  type BoardInputEvent,
  type ToolPointerEvent,
} from '@kujam/core';
import { mountRenderer, OverlayRenderer, type BoardView, type RendererOptions } from '../index.js';
import { LONG_PRESS_MS } from './input.js';

/** BOARD-911: touch and stylus polish (palm rejection, taps, prediction, hover, box, inertia). */

let boards: Board[] = [];
let views: BoardView[] = [];
let events: BoardInputEvent[] = [];

const tool = (id: string) => defineTool({ id, initial: 'idle', states: { idle: {} } });
/** Freehand-like tool that publishes a brush tip for a hovering pen, like the built-in pen. */
const drawTool = defineTool<'idle', { tip: { color: string; thickness: number } | null }>({
  id: 'draw',
  initial: 'idle',
  data: () => ({ tip: null }),
  states: {
    idle: {
      onPointerMove(ctx, e) {
        ctx.data.tip =
          e.pointerType === 'pen' && e.buttons === 0 ? { color: '#000', thickness: 8 } : null;
      },
    },
  },
});
const testTools = definePlugin({
  id: 'test-tools',
  tools: [tool('select'), drawTool, tool('hand')],
});

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

/** Runs pending animation frames, `count` rounds, 16 ms apart. */
function runFrames(count: number, start = 1000): void {
  for (let i = 0; i < count; i++) {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, cb] of pending) cb(start + i * 16);
  }
}

beforeEach(() => {
  events = [];
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

function setup(options: RendererOptions = {}, toolId = 'select') {
  const container = document.body.appendChild(document.createElement('div'));
  vi.spyOn(container, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(600);
  const board = createBoard({ plugins: [testTools] });
  board.setTool(toolId);
  boards.push(board);
  const original = board.dispatch.bind(board);
  vi.spyOn(board, 'dispatch').mockImplementation((event: BoardInputEvent) => {
    events.push(event);
    return original(event);
  });
  const view = mountRenderer(board, container, options);
  views.push(view);
  FakeResizeObserver.instances.at(-1)?.resize(800, 600);
  return { board, view, canvas: view.layers.canvas };
}

interface PointerInit {
  id: number;
  type: 'mouse' | 'pen' | 'touch';
  x: number;
  y: number;
  buttons?: number;
  time?: number;
}

function pointer(canvas: HTMLCanvasElement, name: string, init: PointerInit): PointerEvent {
  const event = new PointerEvent(name, {
    pointerId: init.id,
    pointerType: init.type,
    clientX: init.x,
    clientY: init.y,
    button: name === 'pointermove' ? -1 : 0,
    buttons: init.buttons ?? (name === 'pointerup' ? 0 : 1),
    bubbles: true,
    cancelable: true,
  });
  if (init.time !== undefined) {
    Object.defineProperty(event, 'timeStamp', { value: init.time });
  }
  canvas.dispatchEvent(event);
  return event;
}

const types = () => events.map((e) => e.type);

describe('BOARD-911: palm rejection', () => {
  it('ignores touches while the pen is down and keeps the stroke going', () => {
    const { canvas } = setup({}, 'draw');
    pointer(canvas, 'pointerdown', { id: 1, type: 'pen', x: 100, y: 100 });
    // A palm lands, moves, and lifts during the stroke.
    pointer(canvas, 'pointerdown', { id: 2, type: 'touch', x: 300, y: 300 });
    pointer(canvas, 'pointermove', { id: 2, type: 'touch', x: 320, y: 310 });
    pointer(canvas, 'pointerup', { id: 2, type: 'touch', x: 320, y: 310 });
    pointer(canvas, 'pointermove', { id: 1, type: 'pen', x: 120, y: 100 });
    pointer(canvas, 'pointerup', { id: 1, type: 'pen', x: 120, y: 100 });

    expect(types()).toEqual(['pointer-down', 'pointer-move', 'pointer-up']);
  });

  it('lets fingers draw until a pen is used, then one finger pans instead', () => {
    const { view, board, canvas } = setup({}, 'draw');
    pointer(canvas, 'pointerdown', { id: 1, type: 'touch', x: 100, y: 100 });
    pointer(canvas, 'pointerup', { id: 1, type: 'touch', x: 100, y: 100 });
    expect(types()).toEqual(['pointer-down', 'pointer-up']);
    expect(view.penDetected).toBe(false);

    pointer(canvas, 'pointerdown', { id: 2, type: 'pen', x: 100, y: 100 });
    pointer(canvas, 'pointerup', { id: 2, type: 'pen', x: 100, y: 100 });
    expect(view.penDetected).toBe(true);

    events = [];
    const before = board.camera.get();
    pointer(canvas, 'pointerdown', { id: 3, type: 'touch', x: 100, y: 100 });
    pointer(canvas, 'pointermove', { id: 3, type: 'touch', x: 150, y: 130 });
    pointer(canvas, 'pointerup', { id: 3, type: 'touch', x: 150, y: 130 });
    expect(events.filter((e) => e.type.startsWith('pointer'))).toEqual([]);
    expect(board.camera.get().x).toBeCloseTo(before.x - 50);
    expect(board.camera.get().y).toBeCloseTo(before.y - 30);
  });

  it('pen wins over a palm that touched first: the touch action rolls back', () => {
    const { canvas } = setup({}, 'draw');
    pointer(canvas, 'pointerdown', { id: 1, type: 'touch', x: 300, y: 300 });
    pointer(canvas, 'pointerdown', { id: 2, type: 'pen', x: 100, y: 100 });
    pointer(canvas, 'pointermove', { id: 2, type: 'pen', x: 110, y: 100 });
    // The palm's later events are ignored.
    pointer(canvas, 'pointermove', { id: 1, type: 'touch', x: 320, y: 300 });
    pointer(canvas, 'pointerup', { id: 1, type: 'touch', x: 320, y: 300 });

    expect(types()).toEqual(['pointer-down', 'pointer-cancel', 'pointer-down', 'pointer-move']);
    const [palmDown, , penDown] = events as ToolPointerEvent[];
    expect(palmDown!.pointerType).toBe('touch');
    expect(penDown!.pointerType).toBe('pen');
  });

  it('"pen draws, fingers pan" pans with one finger from the start; `draw` turns rejection off', () => {
    const { view, canvas } = setup({ touch: { fingers: 'pan' } }, 'draw');
    pointer(canvas, 'pointerdown', { id: 1, type: 'touch', x: 100, y: 100 });
    pointer(canvas, 'pointerup', { id: 1, type: 'touch', x: 100, y: 100 });
    expect(events).toEqual([]);

    view.setTouchOptions({ fingers: 'draw' });
    expect(view.touchOptions).toEqual({ fingers: 'draw', tapGestures: true, inertia: true });
    pointer(canvas, 'pointerdown', { id: 2, type: 'pen', x: 100, y: 100 });
    pointer(canvas, 'pointerdown', { id: 3, type: 'touch', x: 200, y: 100 });
    // Without rejection the finger starts a two-pointer gesture, as in 0.1.
    expect(types()).toEqual(['pointer-down', 'pointer-cancel', 'pinch']);
  });

  it('rejects an unknown finger mode', () => {
    const { view } = setup();
    expect(() => view.setTouchOptions({ fingers: 'palm' as never })).toThrow(RangeError);
    expect(() => setup({ touch: { fingers: 'x' as never } })).toThrow(RangeError);
  });

  it('keeps the select tool behavior for one finger after a pen was used', () => {
    const { canvas } = setup();
    pointer(canvas, 'pointerdown', { id: 1, type: 'pen', x: 10, y: 10 });
    pointer(canvas, 'pointerup', { id: 1, type: 'pen', x: 10, y: 10 });
    events = [];
    // Empty space with the select tool still pans (ADR-004) and a tap still reaches nothing.
    pointer(canvas, 'pointerdown', { id: 2, type: 'touch', x: 100, y: 100 });
    pointer(canvas, 'pointerup', { id: 2, type: 'touch', x: 100, y: 100 });
    expect(events).toEqual([]);
  });
});

describe('BOARD-911: two- and three-finger taps', () => {
  function tapFingers(canvas: HTMLCanvasElement, count: number, duration = 100, move = 0): void {
    for (let i = 0; i < count; i++) {
      pointer(canvas, 'pointerdown', {
        id: 10 + i,
        type: 'touch',
        x: 100 + i * 60,
        y: 100,
        time: 0,
      });
    }
    if (move > 0) {
      pointer(canvas, 'pointermove', { id: 10, type: 'touch', x: 100 + move, y: 100, time: 50 });
    }
    for (let i = 0; i < count; i++) {
      pointer(canvas, 'pointerup', {
        id: 10 + i,
        type: 'touch',
        x: 100 + i * 60 + (i === 0 ? move : 0),
        y: 100,
        time: duration,
      });
    }
  }

  it('undoes with a two-finger tap and redoes with a three-finger tap', () => {
    const { board, canvas } = setup();
    const undo = vi.spyOn(board, 'undo');
    const redo = vi.spyOn(board, 'redo');
    tapFingers(canvas, 2);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();
    tapFingers(canvas, 3);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a slow tap, a moving pinch, or when switched off', () => {
    const { board, view, canvas } = setup();
    const undo = vi.spyOn(board, 'undo');
    tapFingers(canvas, 2, 400);
    tapFingers(canvas, 2, 100, 30);
    view.setTouchOptions({ tapGestures: false });
    tapFingers(canvas, 2);
    expect(undo).not.toHaveBeenCalled();
  });

  it('does not fire on a read-only board', () => {
    const { board, canvas } = setup();
    board.setReadOnly(true);
    const undo = vi.spyOn(board, 'undo');
    tapFingers(canvas, 2);
    expect(undo).not.toHaveBeenCalled();
  });
});

describe('BOARD-911: predicted pen points', () => {
  it('passes getPredictedEvents() positions in board coordinates on the last move', () => {
    const { board, canvas } = setup({}, 'draw');
    board.camera.set({ x: 10, y: 20, zoom: 2 });
    pointer(canvas, 'pointerdown', { id: 1, type: 'pen', x: 100, y: 100 });
    const move = new PointerEvent('pointermove', {
      pointerId: 1,
      pointerType: 'pen',
      clientX: 110,
      clientY: 100,
      buttons: 1,
      pressure: 0.6,
    });
    const ahead = new PointerEvent('pointermove', {
      pointerId: 1,
      pointerType: 'pen',
      clientX: 130,
      clientY: 110,
      buttons: 1,
      pressure: 0.7,
    });
    Object.defineProperty(move, 'getPredictedEvents', { value: () => [ahead] });
    canvas.dispatchEvent(move);

    const last = events.at(-1) as ToolPointerEvent;
    expect(last.type).toBe('pointer-move');
    expect(last.predicted).toHaveLength(1);
    expect(last.predicted![0]!.x).toBeCloseTo(10 + 130 / 2);
    expect(last.predicted![0]!.y).toBeCloseTo(20 + 110 / 2);
    expect(last.predicted![0]!.pressure).toBeCloseTo(0.7);
  });

  it('leaves `predicted` out when the browser has no predictions', () => {
    const { canvas } = setup({}, 'draw');
    pointer(canvas, 'pointerdown', { id: 1, type: 'pen', x: 100, y: 100 });
    pointer(canvas, 'pointermove', { id: 1, type: 'pen', x: 110, y: 100 });
    expect('predicted' in (events.at(-1) as object)).toBe(false);
  });
});

describe('BOARD-911: pen hover', () => {
  it('sends hover moves of a pen to any tool and previews the tool brush tip', () => {
    const { board, view, canvas } = setup({}, 'draw');
    pointer(canvas, 'pointermove', { id: 1, type: 'pen', x: 50, y: 60, buttons: 0 });
    const hover = events.at(-1) as ToolPointerEvent;
    expect(hover.type).toBe('pointer-move');
    expect(hover.buttons).toBe(0);

    expect(board.toolData).toEqual({ tip: { color: '#000', thickness: 8 } });
    // The overlay gets the hover position (drawn in overlay.test.ts) and loses it on leave.
    const overlay = vi.spyOn(OverlayRenderer.prototype, 'setPenHover');
    pointer(canvas, 'pointermove', { id: 1, type: 'pen', x: 55, y: 60, buttons: 0 });
    expect(overlay).toHaveBeenLastCalledWith({ x: 55, y: 60 });
    canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, pointerType: 'pen' }));
    expect(overlay).toHaveBeenLastCalledWith(null);
    // A pen press ends the hover too, and its stroke has no tip.
    pointer(canvas, 'pointermove', { id: 1, type: 'pen', x: 55, y: 60, buttons: 0 });
    pointer(canvas, 'pointerdown', { id: 1, type: 'pen', x: 55, y: 60 });
    expect(overlay).toHaveBeenLastCalledWith(null);
    void view;
  });

  it('does not send mouse hover moves to drawing tools', () => {
    const { canvas } = setup({}, 'draw');
    pointer(canvas, 'pointermove', { id: 1, type: 'mouse', x: 50, y: 60, buttons: 0 });
    expect(events).toEqual([]);
  });
});

describe('BOARD-911: long press then drag draws a selection box', () => {
  it('starts the box at the press point and opens no menu', () => {
    vi.useFakeTimers();
    try {
      const menus: unknown[] = [];
      const { board, canvas } = setup({ onContextMenu: (e) => menus.push(e) });
      const camera = board.camera.get();
      pointer(canvas, 'pointerdown', { id: 1, type: 'touch', x: 100, y: 100 });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      pointer(canvas, 'pointermove', { id: 1, type: 'touch', x: 200, y: 180 });
      pointer(canvas, 'pointerup', { id: 1, type: 'touch', x: 200, y: 180 });

      expect(types()).toEqual(['pointer-down', 'pointer-move', 'pointer-up']);
      const down = events[0] as ToolPointerEvent;
      expect(down.screen).toEqual({ x: 100, y: 100 });
      expect(down.button).toBe(0);
      expect(menus).toEqual([]);
      // The camera did not pan.
      expect(board.camera.get()).toEqual(camera);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pans as before when the drag starts before the long press', () => {
    vi.useFakeTimers();
    try {
      const { board, canvas } = setup();
      const x = board.camera.get().x;
      pointer(canvas, 'pointerdown', { id: 1, type: 'touch', x: 100, y: 100 });
      pointer(canvas, 'pointermove', { id: 1, type: 'touch', x: 150, y: 100 });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      pointer(canvas, 'pointermove', { id: 1, type: 'touch', x: 200, y: 100 });
      pointer(canvas, 'pointerup', { id: 1, type: 'touch', x: 200, y: 100 });
      expect(events).toEqual([]);
      expect(board.camera.get().x).toBeCloseTo(x - 100);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BOARD-911: pan inertia', () => {
  function flick(canvas: HTMLCanvasElement, restBeforeRelease = 0): void {
    pointer(canvas, 'pointerdown', { id: 1, type: 'touch', x: 100, y: 100, time: 0 });
    for (let i = 1; i <= 5; i++) {
      pointer(canvas, 'pointermove', {
        id: 1,
        type: 'touch',
        x: 100 + i * 20,
        y: 100,
        time: i * 16,
      });
    }
    pointer(canvas, 'pointerup', {
      id: 1,
      type: 'touch',
      x: 200,
      y: 100,
      time: 5 * 16 + restBeforeRelease,
    });
  }

  it('keeps gliding after a quick touch pan and slows down to a stop', () => {
    const { board, canvas } = setup();
    flick(canvas);
    const released = board.camera.get().x;
    runFrames(1);
    const afterOne = board.camera.get().x;
    expect(afterOne).toBeLessThan(released);
    runFrames(200);
    const stopped = board.camera.get().x;
    runFrames(5);
    expect(board.camera.get().x).toBe(stopped);
    // Glides on in the drag direction, but only a bounded distance.
    expect(released - stopped).toBeGreaterThan(20);
    expect(released - stopped).toBeLessThan(400);
  });

  it('glides after a two-finger pan', () => {
    const { board, canvas } = setup();
    pointer(canvas, 'pointerdown', { id: 1, type: 'touch', x: 100, y: 100, time: 0 });
    pointer(canvas, 'pointerdown', { id: 2, type: 'touch', x: 200, y: 100, time: 0 });
    for (let i = 1; i <= 5; i++) {
      pointer(canvas, 'pointermove', {
        id: 1,
        type: 'touch',
        x: 100,
        y: 100 + i * 20,
        time: i * 16,
      });
      pointer(canvas, 'pointermove', {
        id: 2,
        type: 'touch',
        x: 200,
        y: 100 + i * 20,
        time: i * 16,
      });
    }
    pointer(canvas, 'pointerup', { id: 1, type: 'touch', x: 100, y: 200, time: 90 });
    const released = board.camera.get().y;
    runFrames(5);
    expect(board.camera.get().y).toBeLessThan(released);
  });

  it('does not glide after resting, with reduced motion, or when switched off', () => {
    const { board, view, canvas } = setup();
    const glides = (): boolean => {
      const x = board.camera.get().x;
      runFrames(5);
      return board.camera.get().x !== x;
    };
    flick(canvas, 120);
    expect(glides()).toBe(false);

    view.reducedMotion = true;
    flick(canvas);
    expect(glides()).toBe(false);

    view.reducedMotion = false;
    view.setTouchOptions({ inertia: false });
    flick(canvas);
    expect(glides()).toBe(false);

    view.setTouchOptions({ inertia: true });
    flick(canvas);
    expect(glides()).toBe(true);
  });

  it('stops gliding on the next press', () => {
    const { board, canvas } = setup();
    flick(canvas);
    pointer(canvas, 'pointerdown', { id: 2, type: 'touch', x: 10, y: 10 });
    const x = board.camera.get().x;
    runFrames(5);
    expect(board.camera.get().x).toBe(x);
  });
});

describe('BOARD-911: editor above the virtual keyboard', () => {
  it('pans the camera so the editor stays above the visual viewport', () => {
    const vv = Object.assign(new EventTarget(), { height: 700, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
    try {
      const { board, view } = setup();
      const editor = document.createElement('div');
      let top = 450;
      vi.spyOn(editor, 'getBoundingClientRect').mockImplementation(
        () => ({ top, bottom: top + 100, left: 0, right: 100, height: 100, width: 100 }) as DOMRect,
      );
      const unmount = view.mountEditor(editor, { x: 0, y: 0, w: 100, h: 100 });
      board.camera.set({ zoom: 2 });
      const y = board.camera.get().y;

      // No keyboard yet: nothing moves.
      vv.dispatchEvent(new Event('resize'));
      expect(board.camera.get().y).toBe(y);

      // The keyboard covers the bottom 300 px: editor bottom 550 > 400 - 16.
      vv.height = 400;
      vv.dispatchEvent(new Event('resize'));
      expect(board.camera.get().y).toBeCloseTo(y + (550 - 384) / 2);

      unmount();
      const after = board.camera.get().y;
      top = 600;
      vv.dispatchEvent(new Event('resize'));
      expect(board.camera.get().y).toBe(after);
    } finally {
      delete (window as { visualViewport?: unknown }).visualViewport;
    }
  });
});

describe('BOARD-911: inertia with unreliable event times', () => {
  it('does not glide when the whole pan arrived at once (synthetic events fired in one go)', () => {
    const { board, canvas } = setup();
    pointer(canvas, 'pointerdown', { id: 1, type: 'touch', x: 100, y: 100, time: 0 });
    for (let i = 1; i <= 5; i++) {
      pointer(canvas, 'pointermove', {
        id: 1,
        type: 'touch',
        x: 100 + i * 20,
        y: 100,
        time: i * 0.01,
      });
    }
    pointer(canvas, 'pointerup', { id: 1, type: 'touch', x: 200, y: 100, time: 0.06 });
    const x = board.camera.get().x;
    runFrames(5);
    expect(board.camera.get().x).toBe(x);
  });
});
