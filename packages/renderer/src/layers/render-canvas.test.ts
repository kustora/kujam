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
  type ElementRecord,
} from '@kujam/core';
import { mountRenderer, type BoardView } from '../index.js';
import {
  clampToBounds,
  comparePaintOrder,
  mergeOverlappingBounds,
  paintKey,
} from './render-canvas.js';

let boards: Board[] = [];
let views: BoardView[] = [];
const drawnLog: string[] = [];
const clearRectCalls: Array<{ x: number; y: number; w: number; h: number }> = [];
const clipCalls: number[] = [];
const strokeRectCalls: Array<{ x: number; y: number; w: number; h: number }> = [];
const fillTextCalls: string[] = [];
/** `lod.editingText` of each element's last draw. */
const editingTextLog = new Map<string, boolean | undefined>();

/** Controllable ResizeObserver stub */
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

const boxElement = defineElement({
  type: 'test-box',
  version: 1,
  props: schema({ label: string() }),
  geometry: (el) => rect(el.w, el.h),
  render: {
    canvas: (_ctx, el, _data, lod) => {
      drawnLog.push(el.id);
      editingTextLog.set(el.id, lod.editingText);
    },
  },
});

const frameElement = defineElement({
  type: 'test-frame',
  version: 1,
  props: schema({ name: string() }),
  geometry: (el) => rect(el.w, el.h),
  render: {
    canvas: (_ctx, el) => {
      drawnLog.push(el.id);
    },
  },
});

const testPlugin = definePlugin({
  id: 'test-elements',
  elements: [boxElement, frameElement],
});

function createMockContext() {
  return {
    setTransform: vi.fn(),
    clearRect: (x: number, y: number, w: number, h: number) => {
      clearRectCalls.push({ x, y, w, h });
    },
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: () => {
      clipCalls.push(1);
    },
    stroke: vi.fn(),
    fill: vi.fn(),
    strokeRect: (x: number, y: number, w: number, h: number) => {
      strokeRectCalls.push({ x, y, w, h });
    },
    fillRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    fillText: (text: string) => {
      fillTextCalls.push(text);
    },
    setLineDash: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    globalAlpha: 1,
  };
}

let mockCtx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  drawnLog.length = 0;
  clearRectCalls.length = 0;
  clipCalls.length = 0;
  strokeRectCalls.length = 0;
  fillTextCalls.length = 0;
  editingTextLog.clear();
  frames.clear();
  FakeResizeObserver.instances = [];

  mockCtx = createMockContext();

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
    mockCtx as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  for (const view of views) view.unmount();
  for (const board of boards) board.dispose();
  views = [];
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function setupView(options: { width?: number; height?: number; debug?: boolean } = {}) {
  const container = document.body.appendChild(document.createElement('div'));
  const width = options.width ?? 800;
  const height = options.height ?? 600;

  vi.spyOn(container, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(height);

  const board = createBoard({ plugins: [testPlugin] });
  boards.push(board);

  const view = mountRenderer(board, container, { debug: options.debug });
  views.push(view);

  // Trigger resize observer to initialize camera viewport
  const observer = FakeResizeObserver.instances.at(-1);
  if (observer) {
    observer.resize(width, height);
  }

  return { board, view, container, observer };
}

describe('BOARD-802: paintKey and comparePaintOrder', () => {
  it('builds paint keys through frame hierarchy and sorts siblings and ancestors correctly', () => {
    const board = createBoard({ plugins: [testPlugin] });
    boards.push(board);

    // Frame at index "a1"
    const frame = board.create({
      id: 'frame-1',
      type: 'test-frame',
      x: 0,
      y: 0,
      w: 500,
      h: 500,
      props: { name: 'Main Frame' },
    });
    // Child inside frame at index "a1"
    const child1 = board.create({
      id: 'child-1',
      type: 'test-box',
      parentId: frame.id,
      x: 10,
      y: 10,
      w: 50,
      h: 50,
      props: { label: 'Child 1' },
    });
    // Child inside frame at index "a2"
    const child2 = board.create({
      id: 'child-2',
      type: 'test-box',
      parentId: frame.id,
      x: 70,
      y: 10,
      w: 50,
      h: 50,
      props: { label: 'Child 2' },
    });
    // Sibling of frame at index "a2"
    const sibling = board.create({
      id: 'sibling-1',
      type: 'test-box',
      parentId: null,
      x: 600,
      y: 0,
      w: 100,
      h: 100,
      props: { label: 'Sibling' },
    });

    const doc = board.getDocument();
    expect(paintKey(doc, frame)).toEqual([frame.index]);
    expect(paintKey(doc, child1)).toEqual([frame.index, child1.index]);
    expect(paintKey(doc, child2)).toEqual([frame.index, child2.index]);
    expect(paintKey(doc, sibling)).toEqual([sibling.index]);

    // Parent frame precedes its own children
    expect(comparePaintOrder(doc, frame, child1)).toBeLessThan(0);
    // Sibling children ordered by index
    expect(comparePaintOrder(doc, child1, child2)).toBeLessThan(0);
    // Element after frame on canvas root is above frame's children
    expect(comparePaintOrder(doc, child2, sibling)).toBeLessThan(0);

    const elements: ElementRecord[] = [sibling, child2, frame, child1];
    elements.sort((a, b) => comparePaintOrder(doc, a, b));
    expect(elements.map((e) => e.id)).toEqual(['frame-1', 'child-1', 'child-2', 'sibling-1']);
  });
});

describe('BOARD-802: Viewport Culling', () => {
  it('culls elements outside camera viewport and renders only visible ones', () => {
    const { board } = setupView({ width: 800, height: 600 });

    // Element in viewport (0, 0 to 800, 600)
    board.create({
      id: 'visible-1',
      type: 'test-box',
      x: 100,
      y: 100,
      w: 50,
      h: 50,
      props: { label: 'In Viewport' },
    });
    // Element far outside viewport
    board.create({
      id: 'culled-1',
      type: 'test-box',
      x: 5000,
      y: 5000,
      w: 50,
      h: 50,
      props: { label: 'Far Away' },
    });

    drawnLog.length = 0;
    flushFrames();

    expect(drawnLog).toContain('visible-1');
    expect(drawnLog).not.toContain('culled-1');
  });

  it('pan and zoom perform full redraw with updated spatial culling', () => {
    const { board, view } = setupView({ width: 800, height: 600 });

    board.create({
      id: 'box-a',
      type: 'test-box',
      x: 100,
      y: 100,
      w: 50,
      h: 50,
      props: { label: 'A' },
    });
    board.create({
      id: 'box-b',
      type: 'test-box',
      x: 1200,
      y: 100,
      w: 50,
      h: 50,
      props: { label: 'B' },
    });

    flushFrames();
    expect(drawnLog).toEqual(['box-a']);

    // Pan camera to bring box-b into view and box-a out of view
    drawnLog.length = 0;
    board.setCamera({ x: 1000, y: 0 });
    flushFrames();

    expect(drawnLog).toEqual(['box-b']);
    expect(view.stats.fullRedraw).toBe(true);
    expect(view.stats.drawnElements).toBe(1);
  });
});

describe('BOARD-802: Dirty Rects and Partial Redraws', () => {
  it('marks old and new bounds dirty on element move and only redraws intersecting elements', () => {
    const { board, view } = setupView({ width: 800, height: 600 });

    const boxA = board.create({
      id: 'box-a',
      type: 'test-box',
      x: 50,
      y: 50,
      w: 60,
      h: 60,
      props: { label: 'A' },
    });
    board.create({
      id: 'box-b',
      type: 'test-box',
      x: 600,
      y: 400,
      w: 60,
      h: 60,
      props: { label: 'B' },
    });

    flushFrames();
    expect(drawnLog).toEqual(['box-a', 'box-b']);

    // Move boxA by 20px (still far from box-b)
    drawnLog.length = 0;
    clipCalls.length = 0;
    board.update(boxA.id, { x: 70, y: 70 });

    flushFrames();

    // Only box-a intersects the dirty region, box-b was not touched and not redrawn!
    expect(drawnLog).toEqual(['box-a']);
    expect(clipCalls.length).toBeGreaterThan(0);
    expect(view.stats.fullRedraw).toBe(false);
    expect(view.stats.dirtyRects.length).toBeGreaterThan(0);
  });

  it('marks bounds dirty on element removal', () => {
    const { board, view } = setupView({ width: 800, height: 600 });

    const boxA = board.create({
      id: 'box-a',
      type: 'test-box',
      x: 50,
      y: 50,
      w: 60,
      h: 60,
      props: { label: 'A' },
    });
    board.create({
      id: 'box-b',
      type: 'test-box',
      x: 600,
      y: 400,
      w: 60,
      h: 60,
      props: { label: 'B' },
    });

    flushFrames();

    // Delete box-a
    drawnLog.length = 0;
    board.delete(boxA.id);
    flushFrames();

    // box-a region was cleared and redrawn (empty), box-b was not redrawn
    expect(drawnLog).toEqual([]);
    expect(view.stats.fullRedraw).toBe(false);
  });
});

describe('BOARD-802: Render Coalescing and Idle Stability', () => {
  it('coalesces multiple requests into at most one render per frame and skips idle frames', () => {
    const { board, view } = setupView({ width: 800, height: 600 });
    flushFrames();

    const initialFrames = view.stats.frameCount;

    // Trigger multiple updates within the same animation frame
    board.create({ id: 'el-1', type: 'test-box', x: 10, y: 10, w: 20, h: 20, props: { label: '1' } });
    board.create({ id: 'el-2', type: 'test-box', x: 40, y: 10, w: 20, h: 20, props: { label: '2' } });
    view.requestRender();

    // Before flush, no frame executed
    expect(view.stats.frameCount).toBe(initialFrames);

    flushFrames();
    // Exactly 1 frame executed for the coalesced changes
    expect(view.stats.frameCount).toBe(initialFrames + 1);

    // If no changes occur, subsequent frames do not increment render frame count
    flushFrames();
    expect(view.stats.frameCount).toBe(initialFrames + 1);
  });
});

describe('BOARD-802: Debug Mode', () => {
  it('draws visual dirty rects and HUD element counts in debug mode', () => {
    const { board, view } = setupView({ width: 800, height: 600, debug: true });

    board.create({
      id: 'box-debug',
      type: 'test-box',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { label: 'Debug' },
    });

    flushFrames();

    // HUD displays drawn count
    expect(fillTextCalls.some((text) => text.includes('Drawn: 1 (full)'))).toBe(true);

    // Partial update in debug mode
    strokeRectCalls.length = 0;
    fillTextCalls.length = 0;
    board.update('box-debug', { x: 120 });
    flushFrames();

    expect(view.stats.fullRedraw).toBe(false);
    expect(strokeRectCalls.length).toBeGreaterThan(0);
    expect(fillTextCalls.some((text) => text.includes('Drawn: 1 (dirty)'))).toBe(true);
  });
});

describe('BOARD-802: Helper bounds functions', () => {
  it('clampToBounds returns null when disjoint and computes intersection when overlapping', () => {
    const viewport = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(clampToBounds({ minX: 200, minY: 200, maxX: 300, maxY: 300 }, viewport)).toBeNull();
    expect(clampToBounds({ minX: -20, minY: 10, maxX: 50, maxY: 60 }, viewport)).toEqual({
      minX: 0,
      minY: 10,
      maxX: 50,
      maxY: 60,
    });
  });

  it('mergeOverlappingBounds merges intersecting rectangles', () => {
    const a = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
    const b = { minX: 20, minY: 20, maxX: 80, maxY: 80 };
    const c = { minX: 200, minY: 200, maxX: 250, maxY: 250 };
    const merged = mergeOverlappingBounds([a, b, c]);

    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual({ minX: 0, minY: 0, maxX: 80, maxY: 80 });
    expect(merged).toContainEqual(c);
  });
});

describe('BOARD-810: Error Isolation in Canvas Renderer', () => {
  it('catches render.canvas error, renders error placeholder, and reports error once per element', () => {
    let shouldThrow = true;
    const explodingElement = defineElement({
      type: 'exploding-box',
      version: 1,
      props: schema({ label: string() }),
      geometry: (el) => rect(el.w, el.h),
      render: {
        canvas: () => {
          if (shouldThrow) throw new Error('Boom in canvas render!');
        },
      },
    });
    const plugin = definePlugin({ id: 'test-exploding', elements: [explodingElement, boxElement] });

    const container = document.body.appendChild(document.createElement('div'));
    vi.spyOn(container, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(600);

    const board = createBoard({ plugins: [plugin] });
    boards.push(board);
    const view = mountRenderer(board, container);
    views.push(view);

    const resizeObserver = FakeResizeObserver.instances.at(-1);
    if (resizeObserver) {
      resizeObserver.resize(800, 600);
    }

    const errors: { code: string; message: string; cause: unknown }[] = [];
    board.on('error', (e) => errors.push(e));

    // Create one normal box and one exploding box
    board.create({ id: 'good-1', type: 'test-box', x: 10, y: 10, w: 50, h: 50, props: { label: 'Good' } });
    board.create({ id: 'bad-1', type: 'exploding-box', x: 100, y: 100, w: 100, h: 100, props: { label: 'Bad' } });

    flushFrames();

    // 1. Good element was rendered successfully (does not abort the frame)
    expect(drawnLog).toContain('good-1');

    // 2. Error event was emitted with code 'render-error'
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('render-error');
    expect(errors[0].cause.elementId).toBe('bad-1');
    expect(errors[0].message).toContain('Boom in canvas render!');

    // 3. Error placeholder text was rendered
    expect(fillTextCalls.some((text) => text.includes('⚠️ exploding-box'))).toBe(true);

    // 4. In subsequent frame, error event is NOT emitted again (does not flood every frame)
    view.requestRender();
    flushFrames();
    expect(errors).toHaveLength(1);

    // 5. Updating the element resets error state and retries rendering
    shouldThrow = false;
    board.update('bad-1', { props: { label: 'Fixed' } });
    flushFrames();
    // After fixing, it renders without error
    expect(errors).toHaveLength(1);
  });
});

describe('Inline text editor: canvas skips the edited text', () => {
  it('passes lod.editingText to the edited element while its editor is mounted', () => {
    const { board, view } = setupView();
    for (const id of ['edited', 'other']) {
      board.create({ id, type: 'test-box', x: 100, y: 100, w: 50, h: 50, props: { label: id } });
    }
    flushFrames();
    expect(editingTextLog.get('edited')).toBeUndefined();

    const editor = document.createElement('div');
    const unmountEditor = view.mountEditor(editor, { x: 100, y: 100, w: 50, h: 50 }, 'edited');
    drawnLog.length = 0;
    flushFrames();
    expect(drawnLog).toEqual(expect.arrayContaining(['edited', 'other']));
    expect(editingTextLog.get('edited')).toBe(true);
    expect(editingTextLog.get('other')).toBeUndefined();

    unmountEditor();
    drawnLog.length = 0;
    flushFrames();
    expect(drawnLog).toContain('edited');
    expect(editingTextLog.get('edited')).toBeUndefined();
  });

  it('keeps drawing the element normally when the editor names no element', () => {
    const { board, view } = setupView();
    board.create({ id: 'a', type: 'test-box', x: 100, y: 100, w: 50, h: 50, props: { label: 'a' } });
    view.mountEditor(document.createElement('div'), { x: 100, y: 100, w: 50, h: 50 });
    flushFrames();
    expect(editingTextLog.get('a')).toBeUndefined();
  });
});
