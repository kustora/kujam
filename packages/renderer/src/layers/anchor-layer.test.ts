// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard, type Board, type ElementRecord } from '@kujam/core';
import { mountRenderer, type BoardView } from '../index.js';

function element(id: string, overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'box',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 100,
    y: 100,
    rotation: 0,
    w: 200,
    h: 100,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...overrides,
  };
}

const fakeContext = new Proxy({}, { get: () => () => {} });

let board: Board;
let view: BoardView;

beforeEach(() => {
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeContext as unknown as CanvasRenderingContext2D,
  );
  board = createBoard();
  board.transact((tx) => tx.put(element('el:a')));
  view = mountRenderer(board, document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  view.unmount();
  board.dispose();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('BOARD-1211: anchors slot layer', () => {
  it('provides a pass-through layer on top of the view', () => {
    const { anchors, root } = view.layers;
    expect(root.lastElementChild).toBe(anchors);
    expect(anchors.dataset.kujamLayer).toBe('anchors');
    expect(anchors.style.pointerEvents).toBe('none');
  });

  it('places a pin at the anchor screen position and follows the camera', () => {
    const pin = document.createElement('button');
    const handle = view.mountAnchor(pin, {
      kind: 'element',
      elementId: 'el:a',
      offset: { x: 10, y: 20 },
    });
    expect(handle.host.parentElement).toBe(view.layers.anchors);
    expect(handle.host.firstElementChild).toBe(pin);
    expect(handle.host.style.pointerEvents).toBe('auto');
    expect(handle.visible).toBe(true);
    expect(handle.host.style.transform).toBe('translate(110px, 120px)');

    board.setCamera({ x: 50, y: 0, zoom: 2 });
    const expected = board.camera.boardToScreen({ x: 110, y: 120 });
    expect(handle.host.style.transform).toBe(`translate(${expected.x}px, ${expected.y}px)`);
  });

  it('follows element moves and hides while the element is deleted', () => {
    const handle = view.mountAnchor(document.createElement('span'), {
      kind: 'element',
      elementId: 'el:a',
      offset: { x: 0, y: 0 },
    });
    board.transact((tx) => tx.put(element('el:a', { x: 300 })));
    expect(handle.host.style.transform).toBe('translate(300px, 100px)');

    board.transact((tx) => tx.remove('el:a'));
    expect(handle.visible).toBe(false);
    expect(handle.host.hidden).toBe(true);

    board.undo();
    expect(handle.visible).toBe(true);
    expect(handle.host.hidden).toBe(false);
  });

  it('hides pins of other pages, updates and removes pins', () => {
    const handle = view.mountAnchor(document.createElement('span'), {
      kind: 'point',
      x: 5,
      y: 5,
      pageId: 'page:other',
    });
    expect(handle.visible).toBe(false);

    handle.update({ kind: 'point', x: 5, y: 6 });
    expect(handle.visible).toBe(true);
    expect(handle.host.dataset.kujamAnchor).toBe('point');
    expect(handle.host.style.transform).toBe('translate(5px, 6px)');

    handle.remove();
    handle.remove();
    expect(view.layers.anchors.children).toHaveLength(0);
    expect(() => view.mountAnchor(document.createElement('span'), { kind: 'x' } as never)).toThrow(
      TypeError,
    );
  });

  it('removes pins on unmount', () => {
    const handle = view.mountAnchor(document.createElement('span'), { kind: 'point', x: 0, y: 0 });
    view.unmount();
    expect(handle.host.isConnected).toBe(false);
    expect(() =>
      view.mountAnchor(document.createElement('span'), { kind: 'point', x: 0, y: 0 }),
    ).toThrow();
  });
});
