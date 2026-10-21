// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createBoard } from '@kujam/core';
import {
  Board,
  useBoardEvent,
  useCamera,
  useHistory,
  useResolved,
  useSelection,
  useTool,
} from './index.js';

describe('BOARD-1308: Vue SSR safety', () => {
  it('runs in a pure node environment without window or document globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders Board component to a safe container div string without errors', async () => {
    const board = createBoard();
    const html = await renderToString(h(Board, { board }));

    expect(html).toContain('style="width:100%;height:100%;position:relative;"');
    expect(html).toMatch(/^<div[^>]*><\/div>$/);
    board.dispose();
  });

  it('passes class and custom style to container div during SSR', async () => {
    const board = createBoard();
    const html = await renderToString(
      h(Board, {
        board,
        class: 'custom-board-class',
        style: 'height: 500px; background-color: rgb(240, 240, 240);',
      }),
    );

    expect(html).toContain('class="custom-board-class"');
    expect(html).toContain('height:500px');
    expect(html).toContain('background-color:rgb(240, 240, 240)');
    board.dispose();
  });

  it('does not mount @kujam/renderer or emit mount events during SSR', async () => {
    const board = createBoard();
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    const onClipboardError = vi.fn();

    const html = await renderToString(
      h(Board, {
        board,
        onMount,
        onUnmount,
        onClipboardError,
      }),
    );

    expect(html).toBeTruthy();
    expect(onMount).not.toHaveBeenCalled();
    expect(onUnmount).not.toHaveBeenCalled();
    expect(onClipboardError).not.toHaveBeenCalled();
    board.dispose();
  });

  it('safely renders with custom elements dictionary without executing client teleports', async () => {
    const customBox = defineComponent({
      setup() {
        return () => h('span', null, 'custom element content');
      },
    });
    const board = createBoard();

    const html = await renderToString(
      h(Board, {
        board,
        elements: {
          'custom-box': customBox,
        },
      }),
    );

    expect(html).toBeTruthy();
    // Teleport elements are not rendered on the server since they mount on client side
    expect(html).not.toContain('custom element content');
    board.dispose();
  });

  it('allows composables to be evaluated in components during SSR', async () => {
    const board = createBoard();

    const Dashboard = defineComponent({
      setup() {
        const selection = useSelection(board);
        const camera = useCamera(board);
        const history = useHistory(board);
        const tool = useTool(board);

        return () =>
          h('div', { class: 'dashboard' }, [
            h('span', { class: 'sel-count' }, `selected: ${selection.value.length}`),
            h('span', { class: 'zoom' }, `zoom: ${camera.value.zoom}`),
            h('span', { class: 'undo' }, `canUndo: ${history.canUndo.value}`),
            h('span', { class: 'tool' }, `tool: ${tool.value ?? 'none'}`),
            h(Board, { board }),
          ]);
      },
    });

    const html = await renderToString(h(Dashboard));
    expect(html).toContain('selected: 0');
    expect(html).toContain('zoom: 1');
    expect(html).toContain('canUndo: false');
    expect(html).toContain('tool: none');
    expect(html).toContain('style="width:100%;height:100%;position:relative;"');

    board.dispose();
  });
});
