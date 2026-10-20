// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachSync,
  createBoard,
  createMemorySyncAdapter,
  createMemorySyncBus,
  defineTool,
  definePlugin,
  type Board,
  type BoardInputEvent,
} from '@kujam/core';
import { mountRenderer, type BoardView } from '../index.js';
import { MIN_PEN_PRESSURE } from './input.js';

let boards: Board[] = [];
let views: BoardView[] = [];
let dispatchedEvents: BoardInputEvent[] = [];

const selectToolDef = defineTool({
  id: 'select',
  initial: 'idle',
  states: {
    idle: {},
  },
});

const testToolsPlugin = definePlugin({
  id: 'test-tools',
  tools: [selectToolDef],
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

beforeEach(() => {
  dispatchedEvents = [];
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

  const board = createBoard({ plugins: [testToolsPlugin] });
  board.setTool('select');
  boards.push(board);

  const originalDispatch = board.dispatch.bind(board);
  vi.spyOn(board, 'dispatch').mockImplementation((event: BoardInputEvent) => {
    dispatchedEvents.push(event);
    return originalDispatch(event);
  });

  const view = mountRenderer(board, container);
  views.push(view);

  const observer = FakeResizeObserver.instances.at(-1);
  if (observer) observer.resize(width, height);

  return { board, view, container, observer };
}

describe('BOARD-806: Surface Properties', () => {
  it('sets touch-action: none, user-select: none, and tabIndex = 0 on board surfaces', () => {
    const { view } = setup();
    const { root, canvas } = view.layers;

    expect(root.style.touchAction).toBe('none');
    expect(root.style.userSelect).toBe('none');
    expect(root.tabIndex).toBe(0);
    expect(canvas.style.touchAction).toBe('none');
  });
});

describe('BOARD-806: Pointer Events & Drag Thresholds', () => {
  it('dispatches normalized pointer events with simulated mouse pressure and capture', () => {
    const { view } = setup();
    const canvas = view.layers.canvas;
    const captureSpy = vi.spyOn(canvas, 'setPointerCapture');
    const releaseSpy = vi.spyOn(canvas, 'releasePointerCapture');

    const down = new PointerEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 50,
      clientY: 50,
      button: 0,
      buttons: 1,
      detail: 1,
    });
    canvas.dispatchEvent(down);

    expect(captureSpy).toHaveBeenCalledWith(1);
    expect(dispatchedEvents).toHaveLength(1);
    const first = dispatchedEvents[0]!;
    expect(first.type).toBe('pointer-down');
    if (first.type === 'pointer-down') {
      expect(first.pointerType).toBe('mouse');
      expect(first.screen).toEqual({ x: 50, y: 50 });
      expect(first.pressure).toBe(0.5); // Simulated mouse pressure
      expect(first.button).toBe(0);
      expect(first.clickCount).toBe(1);
    }

    const up = new PointerEvent('pointerup', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 50,
      clientY: 50,
      button: 0,
      buttons: 0,
    });
    canvas.dispatchEvent(up);

    expect(releaseSpy).toHaveBeenCalledWith(1);
    expect(dispatchedEvents).toHaveLength(2);
    expect(dispatchedEvents[1]?.type).toBe('pointer-up');
  });

  it('clamps 0 pen pressure on first event to minimum and maps eraser button (buttons & 32)', () => {
    const { view } = setup();
    const canvas = view.layers.canvas;

    const penDown = new PointerEvent('pointerdown', {
      pointerId: 2,
      pointerType: 'pen',
      clientX: 100,
      clientY: 100,
      pressure: 0,
      buttons: 33, // 1 (primary) + 32 (stylus eraser)
      button: 0,
      tiltX: 15,
      tiltY: -20,
    });
    canvas.dispatchEvent(penDown);

    expect(dispatchedEvents).toHaveLength(1);
    const event = dispatchedEvents[0]!;
    expect(event.type).toBe('pointer-down');
    if (event.type === 'pointer-down') {
      expect(event.pointerType).toBe('pen');
      expect(event.pressure).toBe(MIN_PEN_PRESSURE); // Clamped from 0 to 0.05
      expect(event.button).toBe(5); // Stylus eraser button mapped to 5
      expect(event.tiltX).toBe(15);
      expect(event.tiltY).toBe(-20);
    }
  });

  it('handles coalesced events on pointermove for smooth strokes', () => {
    const { view } = setup();
    const canvas = view.layers.canvas;

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 3,
        pointerType: 'pen',
        clientX: 10,
        clientY: 10,
        buttons: 1,
      }),
    );
    dispatchedEvents.length = 0;

    const moveEvent = new PointerEvent('pointermove', {
      pointerId: 3,
      pointerType: 'pen',
      clientX: 40,
      clientY: 40,
      buttons: 1,
    });

    const c1 = new PointerEvent('pointermove', {
      pointerId: 3,
      pointerType: 'pen',
      clientX: 20,
      clientY: 20,
      buttons: 1,
    });
    const c2 = new PointerEvent('pointermove', {
      pointerId: 3,
      pointerType: 'pen',
      clientX: 30,
      clientY: 30,
      buttons: 1,
    });
    const c3 = new PointerEvent('pointermove', {
      pointerId: 3,
      pointerType: 'pen',
      clientX: 40,
      clientY: 40,
      buttons: 1,
    });

    // Mock getCoalescedEvents
    Object.assign(moveEvent, {
      getCoalescedEvents: () => [c1, c2, c3],
    });

    canvas.dispatchEvent(moveEvent);

    // All 3 coalesced events were dispatched sequentially
    expect(dispatchedEvents).toHaveLength(3);
    expect(dispatchedEvents.map((e) => (e as { screen: { x: number } }).screen.x)).toEqual([
      20, 30, 40,
    ]);
  });

  it('one-finger touch on empty space pans camera with select tool (ADR-004)', () => {
    const { board, view } = setup();
    const canvas = view.layers.canvas;

    expect(board.tool).toBe('select');
    expect(board.camera.get().x).toBe(0);
    expect(board.camera.get().y).toBe(0);

    // Touch down on empty space
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 10,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
        buttons: 1,
      }),
    );

    // Move past DRAG_THRESHOLD_TOUCH (8px)
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 10,
        pointerType: 'touch',
        clientX: 150, // dx = 50px
        clientY: 120, // dy = 20px
        buttons: 1,
      }),
    );

    // Camera panned by (-50, -20)
    expect(board.camera.get().x).toBe(-50);
    expect(board.camera.get().y).toBe(-20);

    // Lifting touch finishes pan without selecting
    canvas.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 10,
        pointerType: 'touch',
        clientX: 150,
        clientY: 120,
      }),
    );
  });
});

describe('BOARD-806: Multi-Pointer & Two-Finger Gestures (ADR-004)', () => {
  it('second finger cancels first finger action and begins 2-finger pinch and pan gesture', () => {
    const { view } = setup();
    const canvas = view.layers.canvas;

    // Pointer 1 down (e.g. pen stroke starting)
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: 100,
        clientY: 100,
        buttons: 1,
      }),
    );

    expect(dispatchedEvents).toHaveLength(1);
    expect(dispatchedEvents[0]?.type).toBe('pointer-down');

    // Finger 2 touches down
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 200,
        clientY: 100,
        buttons: 1,
      }),
    );

    // Action of finger 1 was cancelled (rollback)
    const cancelEvent = dispatchedEvents.find((e) => e.type === 'pointer-cancel');
    expect(cancelEvent).toBeDefined();

    // Pinch start was dispatched
    const pinchStart = dispatchedEvents.find((e) => e.type === 'pinch' && e.phase === 'start');
    expect(pinchStart).toBeDefined();

    // Move fingers apart (zoom in) and right (pan)
    dispatchedEvents.length = 0;
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 300, // Distance increased from 100 to 200 -> scale = 2
        clientY: 100,
        buttons: 1,
      }),
    );

    const pinchUpdate = dispatchedEvents.find((e) => e.type === 'pinch' && e.phase === 'update');
    expect(pinchUpdate).toBeDefined();
    if (pinchUpdate?.type === 'pinch') {
      expect(pinchUpdate.scale).toBe(2);
      expect(pinchUpdate.deltaX).toBe(50); // Center moved from 150 to 200
    }

    // Finger up ends pinch
    canvas.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 300,
        clientY: 100,
      }),
    );

    const pinchEnd = dispatchedEvents.find((e) => e.type === 'pinch' && e.phase === 'end');
    expect(pinchEnd).toBeDefined();
  });

  it('ignores 3rd finger and beyond', () => {
    const { view } = setup();
    const canvas = view.layers.canvas;

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 10,
        clientY: 10,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 50,
        clientY: 10,
      }),
    );
    dispatchedEvents.length = 0;

    // 3rd finger
    const p3 = new PointerEvent('pointerdown', {
      pointerId: 3,
      pointerType: 'touch',
      clientX: 90,
      clientY: 10,
    });
    const preventDefaultSpy = vi.spyOn(p3, 'preventDefault');
    canvas.dispatchEvent(p3);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(dispatchedEvents).toHaveLength(0);
  });

  it('pointercancel cancels active interaction safely', () => {
    const { view } = setup();
    const canvas = view.layers.canvas;

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 5,
        pointerType: 'mouse',
        clientX: 40,
        clientY: 40,
        buttons: 1,
      }),
    );
    dispatchedEvents.length = 0;

    canvas.dispatchEvent(
      new PointerEvent('pointercancel', {
        pointerId: 5,
        pointerType: 'mouse',
      }),
    );

    expect(dispatchedEvents).toHaveLength(1);
    expect(dispatchedEvents[0]?.type).toBe('pointer-cancel');
  });
});

describe('BOARD-806: Wheel and Safari Gesture Events', () => {
  it('dispatches wheel event with delta and modifiers', () => {
    const { view } = setup();
    const root = view.layers.root;

    const wheel = new WheelEvent('wheel', {
      deltaX: 15,
      deltaY: -30,
      ctrlKey: true,
    });
    Object.assign(wheel, { clientX: 120, clientY: 100, ctrlKey: true });
    root.dispatchEvent(wheel);

    expect(dispatchedEvents).toHaveLength(1);
    const event = dispatchedEvents[0]!;
    expect(event.type).toBe('wheel');
    if (event.type === 'wheel') {
      expect(event.deltaX).toBe(15);
      expect(event.deltaY).toBe(-30);
      expect(event.modifiers.ctrl).toBe(true);
      expect(event.screen).toEqual({ x: 120, y: 100 });
    }
  });

  it('translates Safari macOS GestureEvents to ToolPinchEvents', () => {
    const { view } = setup();
    const root = view.layers.root;

    // gesturestart
    const gStart = new CustomEvent('gesturestart') as unknown as UIEvent;
    Object.assign(gStart, { scale: 1, clientX: 200, clientY: 200 });
    root.dispatchEvent(gStart);

    expect(dispatchedEvents).toHaveLength(1);
    expect(dispatchedEvents[0]?.type).toBe('pinch');
    expect((dispatchedEvents[0] as { phase: string }).phase).toBe('start');

    // gesturechange with scale 1.25
    dispatchedEvents.length = 0;
    const gChange = new CustomEvent('gesturechange') as unknown as UIEvent;
    Object.assign(gChange, { scale: 1.25, clientX: 200, clientY: 200 });
    root.dispatchEvent(gChange);

    expect(dispatchedEvents).toHaveLength(1);
    expect((dispatchedEvents[0] as { phase: string }).phase).toBe('update');
    expect((dispatchedEvents[0] as { scale: number }).scale).toBe(1.25);

    // gestureend
    dispatchedEvents.length = 0;
    const gEnd = new CustomEvent('gestureend') as unknown as UIEvent;
    Object.assign(gEnd, { scale: 1.25, clientX: 200, clientY: 200 });
    root.dispatchEvent(gEnd);

    expect(dispatchedEvents).toHaveLength(1);
    expect((dispatchedEvents[0] as { phase: string }).phase).toBe('end');
  });
});

describe('BOARD-806: Keyboard & Focus', () => {
  it('captures keyboard events when the board is focused', () => {
    const { view } = setup();
    const root = view.layers.root;

    // Focus the board root
    root.focus();

    const keyDown = new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      bubbles: true,
    });
    root.dispatchEvent(keyDown);

    expect(dispatchedEvents).toHaveLength(1);
    const event = dispatchedEvents[0]!;
    expect(event.type).toBe('key-down');
    if (event.type === 'key-down') {
      expect(event.key).toBe('v');
      expect(event.code).toBe('KeyV');
      expect(event.inTextInput).toBe(false);
    }
  });

  it('sets inTextInput: true when typing inside input or textarea', () => {
    const { view } = setup();
    const root = view.layers.root;

    const input = document.createElement('input');
    root.appendChild(input);
    input.focus();

    const keyDown = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      bubbles: true,
    });
    input.dispatchEvent(keyDown);

    expect(dispatchedEvents).toHaveLength(1);
    const event = dispatchedEvents[0]!;
    expect(event.type).toBe('key-down');
    if (event.type === 'key-down') {
      expect(event.inTextInput).toBe(true);
    }
  });

  it('ignores keyboard events when the board is not focused', () => {
    setup();

    const outsideButton = document.body.appendChild(document.createElement('button'));
    outsideButton.focus();

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'h',
        code: 'KeyH',
      }),
    );

    expect(dispatchedEvents).toHaveLength(0);
  });
});

describe('BOARD-1504: local cursor presence', () => {
  it('publishes the hover and drag position in board coordinates and clears it on leave', () => {
    const { board, view } = setup();
    attachSync(board, createMemorySyncAdapter({ bus: createMemorySyncBus(), channel: 'cursor' }));
    board.camera.set({ x: 100, y: 50, zoom: 2 });
    const spy = vi.spyOn(board.presence!, 'setLocalState');
    const canvas = view.layers.canvas;

    // Hover (no button) is not dispatched to tools but still moves the cursor.
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 20, buttons: 0 }));
    expect(spy).toHaveBeenLastCalledWith({ cursor: { x: 120, y: 60 } });
    expect(dispatchedEvents.some((e) => e.type === 'pointer-move')).toBe(false);

    canvas.dispatchEvent(new PointerEvent('pointerleave'));
    expect(spy).toHaveBeenLastCalledWith({ cursor: null });
  });

  it('does nothing without presence', () => {
    const { view } = setup();
    expect(() =>
      view.layers.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 1 })),
    ).not.toThrow();
  });
});

describe('Multi-click counting without PointerEvent.detail', () => {
  /** A press as Chromium and Firefox send it: `detail` 0. */
  function press(canvas: HTMLCanvasElement, x: number, y: number, time: number): void {
    for (const type of ['pointerdown', 'pointerup'] as const) {
      const event = new PointerEvent(type, {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
        detail: 0,
      });
      Object.defineProperty(event, 'timeStamp', { value: time });
      canvas.dispatchEvent(event);
    }
  }

  const downCounts = () =>
    dispatchedEvents.flatMap((e) => (e.type === 'pointer-down' ? [e.clickCount] : []));

  it('counts quick presses at the same spot as a double and triple click', () => {
    const { view } = setup();
    press(view.layers.canvas, 50, 50, 1000);
    press(view.layers.canvas, 51, 50, 1200);
    press(view.layers.canvas, 50, 51, 1400);
    expect(downCounts()).toEqual([1, 2, 3]);
    const up = dispatchedEvents.filter((e) => e.type === 'pointer-up').at(-1);
    expect(up?.type === 'pointer-up' && up.clickCount).toBe(3);
  });

  it('starts a new series after a pause or away from the last press', () => {
    const { view } = setup();
    press(view.layers.canvas, 50, 50, 1000);
    press(view.layers.canvas, 50, 50, 1700);
    press(view.layers.canvas, 200, 50, 1800);
    expect(downCounts()).toEqual([1, 1, 1]);
  });

  it('uses detail when the browser reports it', () => {
    const { view } = setup();
    const event = new PointerEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 50,
      clientY: 50,
      button: 0,
      buttons: 1,
      detail: 2,
    });
    view.layers.canvas.dispatchEvent(event);
    expect(downCounts()).toEqual([2]);
  });
});
