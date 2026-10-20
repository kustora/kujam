// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createBoard,
  type Board,
  type ElementCanvasContext,
  type ElementLodState,
  type ElementRecord,
  type PartialElement,
} from '@kujam/core';
import { defaultElements } from '../index.js';

function setup(): Board {
  return createBoard({ plugins: [defaultElements] });
}

function recorder(): { g: ElementCanvasContext; calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const g = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
      return (...args: unknown[]) => calls.push(`${key}(${args.join(',')})`);
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as ElementCanvasContext;
  return { g, calls };
}

function draw(board: Board, el: ElementRecord, lod: ElementLodState): string[] {
  const { g, calls } = recorder();
  board.elements.get(el.type)!.render!.canvas!(g, el, undefined, lod, board.elementContext);
  return calls;
}

const label = [{ insert: 'Halo\n' }];
const ELEMENTS: Record<string, { element: PartialElement; shape: string }> = {
  text: { element: { type: 'text', w: 200, h: 40, props: { text: label } }, shape: '' },
  sticky: { element: { type: 'sticky', w: 200, h: 200, props: { text: label } }, shape: 'fill()' },
  geo: { element: { type: 'geo', w: 200, h: 120, props: { label } }, shape: 'stroke()' },
  connector: {
    element: {
      type: 'connector',
      w: 200,
      h: 0,
      props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, label },
    },
    shape: 'stroke()',
  },
  frame: { element: { type: 'frame', w: 300, h: 200, props: { name: 'Halo' } }, shape: 'stroke()' },
};

describe('Inline text editor: built-in elements skip their text while edited', () => {
  for (const [type, { element, shape }] of Object.entries(ELEMENTS)) {
    it(`${type} draws its shape but not its text when lod.editingText is set`, () => {
      const board = setup();
      const el = board.create({ x: 0, y: 0, ...element })!;
      const texts = (calls: string[]) => calls.filter((c) => c.startsWith('fillText(Halo'));

      const normal = draw(board, el, { zoom: 1, compact: false });
      expect(texts(normal)).not.toHaveLength(0);

      const editing = draw(board, el, { zoom: 1, compact: false, editingText: true });
      expect(texts(editing)).toHaveLength(0);
      if (shape) expect(editing).toContain(shape);
      board.dispose();
    });
  }
});
