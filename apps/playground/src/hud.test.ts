// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoard, defineElement, definePlugin, object, string, type Board } from '@kujam/core';
import { createPerformanceHud } from './hud.js';

const note = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});

const plugin = definePlugin({
  id: 'test-plugin',
  elements: [note],
});

describe('BOARD-2406: Performance HUD & Debug Overlays', () => {
  let board: Board;
  let stage: HTMLElement;

  beforeEach(() => {
    board = createBoard({ plugins: [plugin] });
    stage = document.createElement('div');
    stage.style.width = '800px';
    stage.style.height = '600px';
    document.body.appendChild(stage);
  });

  afterEach(() => {
    board.dispose();
    stage.remove();
    document.body.innerHTML = '';
  });

  it('creates and mounts the HUD overlay and debug canvas in stage', () => {
    const hud = createPerformanceHud(board, stage);
    expect(hud.element).toBeDefined();
    expect(hud.element.classList.contains('kujam-performance-hud')).toBe(true);
    expect(stage.contains(hud.element)).toBe(true);

    const canvas = stage.querySelector('canvas.kujam-hud-debug-overlay');
    expect(canvas).not.toBeNull();

    hud.dispose();
    expect(stage.contains(hud.element)).toBe(false);
    expect(stage.querySelector('canvas.kujam-hud-debug-overlay')).toBeNull();
  });

  it('renders FPS, frame time, element count, and HTML DOM nodes', () => {
    // Add dummy html layer
    const htmlLayer = document.createElement('div');
    htmlLayer.className = 'kujam-html-layer';
    htmlLayer.appendChild(document.createElement('div'));
    htmlLayer.appendChild(document.createElement('span'));
    stage.appendChild(htmlLayer);

    // Create some elements
    board.camera.setViewport({ width: 800, height: 600 });
    board.create({ id: 'n1', type: 'note', x: 50, y: 50, w: 100, h: 100, props: { text: 'A' } });
    board.create({ id: 'n2', type: 'note', x: 200, y: 200, w: 100, h: 100, props: { text: 'B' } });
    board.create({ id: 'n3', type: 'note', x: 5000, y: 5000, w: 100, h: 100, props: { text: 'Far' } });

    const hud = createPerformanceHud(board, stage);

    // Check text contents
    const text = hud.element.textContent ?? '';
    expect(text).toContain('HUD Performa');
    expect(text).toContain('FPS:');
    expect(text).toContain('Waktu Frame:');
    expect(text).toContain('Elemen:');
    expect(text).toContain('Node DOM HTML: 2 node');
    expect(text).toContain('Memori Heap:');

    // Check elements drawn vs culled
    // 2 in viewport (n1, n2), 1 culled (n3)
    expect(text).toContain('2 dirender');
    expect(text).toContain('1 dicull');
    expect(text).toContain('3 total');

    hud.dispose();
  });

  it('provides interactive toggles for bounding boxes, snap points, and dirty rects', () => {
    const hud = createPerformanceHud(board, stage);

    const checkboxes = hud.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.length).toBe(3);

    const [bboxToggle, snapToggle, dirtyToggle] = checkboxes;
    expect(bboxToggle?.checked).toBe(false);
    expect(snapToggle?.checked).toBe(false);
    expect(dirtyToggle?.checked).toBe(false);

    // Toggle on and off
    bboxToggle!.click();
    expect(bboxToggle?.checked).toBe(true);

    snapToggle!.click();
    expect(snapToggle?.checked).toBe(true);

    dirtyToggle!.click();
    expect(dirtyToggle?.checked).toBe(true);

    hud.dispose();
  });

  it('allows collapsing and expanding the HUD body', () => {
    const hud = createPerformanceHud(board, stage);
    const collapseBtn = hud.element.querySelector<HTMLButtonElement>('button[aria-label="Perkecil HUD"]')!;
    expect(collapseBtn).not.toBeNull();

    // Click to collapse
    collapseBtn.click();
    expect(collapseBtn.textContent).toBe('+');
    expect(collapseBtn.getAttribute('aria-label')).toBe('Perbesar HUD');

    // Click to expand
    collapseBtn.click();
    expect(collapseBtn.textContent).toBe('−');
    expect(collapseBtn.getAttribute('aria-label')).toBe('Perkecil HUD');

    hud.dispose();
  });
});
