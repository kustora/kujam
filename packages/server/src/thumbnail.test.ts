// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, createBoard, defineElement, definePlugin, object } from '@kujam/core';
import { documentToUpdate } from '@kujam/sync-yjs';
import { renderThumbnail, type CanvasFactory } from './thumbnail.js';

const box = defineElement({
  type: 'box',
  version: 1,
  props: object({}),
  defaults: {},
  render: {
    canvas(g, el) {
      g.ctx.fillRect(0, 0, el.w, el.h);
    },
  },
});
const plugin = definePlugin({ id: 'box-plugin', elements: [box] });

/** Fake canvas whose 2D context records calls and accepts any method or property. */
function fakeFactory(calls: string[], size: { w: number; h: number }[] = []): CanvasFactory {
  return (width, height) => {
    size.push({ w: width, h: height });
    const ctx: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, prop: string) => (...args: unknown[]) => {
          calls.push(prop);
          void args;
        },
        set: () => true,
      },
    );
    const canvas = { width, height, toBuffer: () => Buffer.from('PNG') };
    return { canvas, ctx };
  };
}

function docWithBox() {
  const board = createBoard({ plugins: [plugin] });
  board.create({ id: 'a', type: 'box', x: 0, y: 0, w: 200, h: 100 });
  const doc = board.getDocument();
  board.dispose();
  return doc;
}

describe('BOARD-1804: renderThumbnail', () => {
  it('renders a JSON document through a custom canvas factory and returns encoded bytes', async () => {
    const calls: string[] = [];
    const sizes: { w: number; h: number }[] = [];
    const out = await renderThumbnail(docWithBox(), {
      width: 300,
      plugins: [plugin],
      canvasFactory: fakeFactory(calls, sizes),
    });
    expect(Buffer.from(out).toString()).toBe('PNG');
    expect(sizes[0]?.w).toBe(300);
    // 200x100 content keeps a 2:1 aspect ratio.
    expect(sizes[0]?.h).toBe(150);
    expect(calls).toContain('fillRect');
  });

  it('accepts a binary Yjs update', async () => {
    const sizes: { w: number; h: number }[] = [];
    const update = documentToUpdate(docWithBox());
    await renderThumbnail(update, {
      width: 200,
      plugins: [plugin],
      canvasFactory: fakeFactory([], sizes),
    });
    expect(sizes[0]?.w).toBe(200);
  });

  it('renders an empty document without throwing', async () => {
    const out = await renderThumbnail(createEmptyDocument(), {
      canvasFactory: fakeFactory([]),
    });
    expect(out).toBeDefined();
  });

  it('throws a clear error when @napi-rs/canvas is not installed', async () => {
    await expect(renderThumbnail(createEmptyDocument(), {})).rejects.toThrow(
      /@napi-rs\/canvas/,
    );
  });
});
