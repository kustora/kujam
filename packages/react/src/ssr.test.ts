// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createBoard, defineElement, object } from '@kujam/core';
import {
  Board,
  useBoardEvent,
  useCamera,
  useHistory,
  useResolved,
  useSelection,
  useTool,
} from './index.js';

describe('BOARD-1308: React SSR safety', () => {
  it('runs in a pure node environment without window or document globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders <Board> to a safe container div string without errors', () => {
    const board = createBoard();
    const html = renderToString(createElement(Board, { board }));

    expect(html).toContain('style="width:100%;height:100%;position:relative"');
    expect(html).toMatch(/^<div[^>]*><\/div>$/);
    board.dispose();
  });

  it('passes className and custom style to container div during SSR', () => {
    const board = createBoard();
    const html = renderToString(
      createElement(Board, {
        board,
        className: 'custom-board-class',
        style: { height: '500px', backgroundColor: 'rgb(240, 240, 240)' },
      }),
    );

    expect(html).toContain('class="custom-board-class"');
    expect(html).toContain('height:500px');
    expect(html).toContain('background-color:rgb(240, 240, 240)');
    board.dispose();
  });

  it('does not mount @kujam/renderer or invoke onMount during SSR', () => {
    const board = createBoard();
    const onMount = vi.fn();
    const onClipboardError = vi.fn();

    const html = renderToString(
      createElement(Board, {
        board,
        onMount,
        onClipboardError,
      }),
    );

    expect(html).toBeTruthy();
    expect(onMount).not.toHaveBeenCalled();
    expect(onClipboardError).not.toHaveBeenCalled();
    board.dispose();
  });

  it('safely renders with custom elements dictionary without executing client portals', () => {
    const customBox = () => createElement('span', null, 'custom element content');
    const board = createBoard();

    const html = renderToString(
      createElement(Board, {
        board,
        elements: {
          'custom-box': customBox,
        },
      }),
    );

    expect(html).toBeTruthy();
    // Portal elements are not rendered on the server since they attach to DOM nodes on client mount
    expect(html).not.toContain('custom element content');
    board.dispose();
  });

  it('allows hooks to be evaluated in components during SSR', () => {
    const board = createBoard();

    function Dashboard() {
      const selection = useSelection(board);
      const camera = useCamera(board);
      const history = useHistory(board);
      const tool = useTool(board);

      return createElement(
        'div',
        { className: 'dashboard' },
        createElement('span', { className: 'sel-count' }, `selected: ${selection.length}`),
        createElement('span', { className: 'zoom' }, `zoom: ${camera.zoom}`),
        createElement('span', { className: 'undo' }, `canUndo: ${history.canUndo}`),
        createElement('span', { className: 'tool' }, `tool: ${tool ?? 'none'}`),
        createElement(Board, { board }),
      );
    }

    const html = renderToString(createElement(Dashboard));
    expect(html).toContain('selected: 0');
    expect(html).toContain('zoom: 1');
    expect(html).toContain('canUndo: false');
    expect(html).toContain('tool: none');
    expect(html).toContain('style="width:100%;height:100%;position:relative"');

    board.dispose();
  });
});
