// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  defineTool,
  number,
  object,
  string,
  type Board,
  type BoardOptions,
} from '@kujam/core';
import { defineUiElements, MINIMAP_SIZE, UI_TAGS } from './index.js';
import type { MinimapElement } from './minimap.js';

const boxElement = defineElement({
  type: 'box',
  version: 1,
  props: object({ color: string(), w: number(), h: number() }),
  defaults: { color: 'blue', w: 100, h: 100 },
});

const circleElement = defineElement({
  type: 'circle',
  version: 1,
  props: object({ color: string(), r: number() }),
  defaults: { color: 'red', r: 50 },
});

const shapePlugin = definePlugin({
  id: 'shape-plugin',
  elements: [boxElement, circleElement],
  tools: [
    defineTool({ id: 'select', initial: 'idle', states: { idle: {} } }),
  ],
});

let boards: Board[] = [];
let mockCtx: {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  ellipse: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
};

beforeEach(() => {
  mockCtx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };

  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    mockCtx as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  for (const board of boards) if (!board.disposed) board.dispose();
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function newBoard(options: BoardOptions = {}): Board {
  const board = createBoard({ plugins: [shapePlugin], ...options });
  board.camera.setViewport({ width: 800, height: 600 });
  boards.push(board);
  return board;
}

function mountMinimap(board: Board): MinimapElement {
  defineUiElements();
  const el = document.createElement(UI_TAGS.minimap) as MinimapElement;
  el.board = board;
  document.body.append(el);
  return el;
}

describe('BOARD-1406: minimap', () => {
  it('renders canvas with default size and draws elements and background', () => {
    const board = newBoard();
    board.create({ type: 'box', x: 100, y: 100, w: 200, h: 150 });
    board.create({ type: 'circle', x: 400, y: 300, w: 100, h: 100 });

    const el = mountMinimap(board);
    const root = el.shadowRoot!;
    const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;

    expect(canvas).not.toBeNull();
    expect(canvas.width).toBe(MINIMAP_SIZE.width);
    expect(canvas.height).toBe(MINIMAP_SIZE.height);

    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, MINIMAP_SIZE.width, MINIMAP_SIZE.height);
    expect(mockCtx.fillRect).toHaveBeenCalled();
    expect(mockCtx.ellipse).toHaveBeenCalled();
  });

  it('draws viewport rectangle matching camera bounds', () => {
    const board = newBoard();
    board.camera.set({ x: 0, y: 0, zoom: 1 });
    board.create({ type: 'box', x: 0, y: 0, w: 1000, h: 800 });

    const el = mountMinimap(board);
    expect(el.board).toBe(board);

    // Viewport box overlay has border strokeRect
    expect(mockCtx.strokeRect).toHaveBeenCalled();
    const calls = mockCtx.strokeRect.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toBeDefined();
    const [_vx, _vy, vw, vh] = lastCall!;
    expect(vw).toBeGreaterThan(0);
    expect(vh).toBeGreaterThan(0);
  });

  it('clicking on minimap updates camera position', () => {
    const board = newBoard();
    board.create({ type: 'box', x: 0, y: 0, w: 2000, h: 2000 });
    board.camera.set({ x: 0, y: 0, zoom: 1 });

    const el = mountMinimap(board);
    const root = el.shadowRoot!;
    const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;

    // Mock getBoundingClientRect for canvas
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 180,
      height: 120,
      right: 180,
      bottom: 120,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const initialPos = board.camera.get();

    // Click near bottom-right on minimap
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 150,
        clientY: 100,
        bubbles: true,
      }),
    );

    const updatedPos = board.camera.get();
    expect(updatedPos.x).not.toBe(initialPos.x);
    expect(updatedPos.y).not.toBe(initialPos.y);
  });

  it('dragging viewport rectangle pans camera', () => {
    const board = newBoard();
    board.create({ type: 'box', x: 0, y: 0, w: 2000, h: 2000 });
    board.camera.set({ x: 0, y: 0, zoom: 1 });

    const el = mountMinimap(board);
    const root = el.shadowRoot!;
    const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;

    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 180,
      height: 120,
      right: 180,
      bottom: 120,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Start drag
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    const afterClick = board.camera.get();

    // Move pointer on window
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: 70,
        clientY: 70,
        bubbles: true,
      }),
    );

    const afterMove = board.camera.get();
    expect(afterMove.x).not.toBe(afterClick.x);
    expect(afterMove.y).not.toBe(afterClick.y);

    // End drag
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    // Moving after pointer up should not change camera
    const finalPos = board.camera.get();
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: 90,
        clientY: 90,
        bubbles: true,
      }),
    );
    expect(board.camera.get()).toEqual(finalPos);
  });

  it('throttles rapid camera updates to avoid excessive redraws', () => {
    vi.useFakeTimers();

    const board = newBoard();
    board.create({ type: 'box', x: 0, y: 0, w: 500, h: 500 });

    const el = mountMinimap(board);
    const initialRenders = el.renderCount;
    expect(initialRenders).toBe(1);

    // Emit 10 camera updates rapidly in succession
    for (let i = 0; i < 10; i++) {
      board.camera.set({ x: i * 10, y: i * 10 });
    }

    // Because of throttling (~100ms interval), it should not have rendered 10 more times
    expect(el.renderCount).toBeLessThan(4);

    // Fast-forward past throttle timer
    vi.advanceTimersByTime(120);

    // It should now have processed the deferred render
    expect(el.renderCount).toBe(2);
  });

  it('collapses and expands with toggle button', () => {
    const board = newBoard();
    const el = mountMinimap(board);
    const root = el.shadowRoot!;
    const container = root.querySelector<HTMLElement>('.container')!;
    const toggleBtn = root.querySelector<HTMLButtonElement>('.toggle-btn')!;

    expect(container.classList.contains('collapsed')).toBe(false);

    toggleBtn.click();
    expect(container.classList.contains('collapsed')).toBe(true);

    toggleBtn.click();
    expect(container.classList.contains('collapsed')).toBe(false);
  });
});
