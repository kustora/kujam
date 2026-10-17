import { describe, expect, it, vi } from 'vitest';
import {
  createElementRegistry,
  defineElement,
  localToBoard,
  moveElements,
  object,
  resizeElements,
  RESIZE_HANDLES,
  rotateElements,
  ROTATION_SNAP_DEGREES,
  selectionFrame,
  string,
  transformHandles,
  type ElementRecord,
  type ResizeHandle,
  type TransformResult,
} from './index.js';

function el(id: string, x: number, y: number, w: number, h: number, rotation = 0, type = 'box') {
  return {
    id,
    kind: 'element',
    type,
    pageId: 'page:main',
    parentId: null,
    index: 'a0',
    x,
    y,
    w,
    h,
    rotation,
    opacity: 1,
    locked: false,
    props: {},
    meta: {},
  } as ElementRecord;
}

const box = (r: TransformResult) => ({ x: r.x, y: r.y, w: r.w, h: r.h });

const props = object({ text: string() });
const registry = createElementRegistry([
  defineElement({ type: 'ratio', version: 1, props, resize: 'fixed-ratio' }),
  defineElement({ type: 'frozen', version: 1, props, resize: 'none' }),
  defineElement({ type: 'big', version: 1, props, minSize: { w: 20, h: 30 } }),
  defineElement({
    type: 'wide-only',
    version: 1,
    props,
    resize: (e, proposed) => ({ w: proposed.w, h: e.h }),
  }),
]);

/** Local point of the edge/corner opposite `handle`, which must stay fixed while resizing. */
function opposite(handle: ResizeHandle, w: number, h: number) {
  const fx = handle.includes('w') ? 1 : handle.includes('e') ? 0 : 0.5;
  const fy = handle.includes('n') ? 1 : handle.includes('s') ? 0 : 0.5;
  return { x: fx * w, y: fy * h };
}

describe('BOARD-406: moveElements', () => {
  it('translates every element', () => {
    const [a, b] = moveElements([el('a', 0, 0, 10, 10), el('b', 5, 5, 1, 1, 30)], 3, -4);
    expect(box(a!)).toEqual({ x: 3, y: -4, w: 10, h: 10 });
    expect(b).toMatchObject({ x: 8, y: 1, rotation: 30 });
  });
});

describe('BOARD-406: resizeElements, one element', () => {
  const base = el('a', 0, 0, 100, 50);

  it('moves only the dragged edges', () => {
    const p = { x: 0, y: 0 };
    expect(box(resizeElements([base], 'se', p, { x: 10, y: 20 })[0]!)).toEqual({
      x: 0,
      y: 0,
      w: 110,
      h: 70,
    });
    expect(box(resizeElements([base], 'nw', p, { x: 10, y: 20 })[0]!)).toEqual({
      x: 10,
      y: 20,
      w: 90,
      h: 30,
    });
    expect(box(resizeElements([base], 'e', p, { x: 10, y: 20 })[0]!)).toEqual({
      x: 0,
      y: 0,
      w: 110,
      h: 50,
    });
    expect(box(resizeElements([base], 'n', p, { x: 10, y: 20 })[0]!)).toEqual({
      x: 0,
      y: 20,
      w: 100,
      h: 30,
    });
  });

  it('keeps the opposite handle fixed for every handle and rotation', () => {
    for (const rotation of [0, 30, 90, 135, 270]) {
      const e = el('a', 10, 20, 100, 50, rotation);
      for (const handle of RESIZE_HANDLES) {
        const [r] = resizeElements([e], handle, { x: 0, y: 0 }, { x: 7, y: -3 });
        const before = localToBoard(e, opposite(handle, e.w, e.h));
        const after = localToBoard(r!, opposite(handle, r!.w, r!.h));
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
        expect(r!.rotation).toBe(rotation);
      }
    }
  });

  it('resizes a rotated element along its own axes', () => {
    // Rotated 90 degrees, the local x axis points down the board.
    const [r] = resizeElements([el('a', 0, 0, 100, 50, 90)], 'e', { x: 0, y: 0 }, { x: 0, y: 20 });
    expect(r!.w).toBeCloseTo(120);
    expect(r!.h).toBeCloseTo(50);
  });

  it('keeps the ratio with Shift: corners use the larger factor, edges scale around the center', () => {
    const p = { x: 0, y: 0 };
    const corner = resizeElements([base], 'se', p, { x: 50, y: 10 }, { keepRatio: true })[0]!;
    expect(box(corner)).toEqual({ x: 0, y: 0, w: 150, h: 75 });
    const edge = resizeElements([base], 'e', p, { x: 50, y: 0 }, { keepRatio: true })[0]!;
    expect(box(edge)).toEqual({ x: 0, y: -12.5, w: 150, h: 75 });
  });

  it('follows the resize mode of the element type', () => {
    const p = { x: 0, y: 0 };
    const ratio = resizeElements(
      [el('a', 0, 0, 100, 50, 0, 'ratio')],
      'se',
      p,
      { x: 50, y: 0 },
      { registry },
    );
    expect(box(ratio[0]!)).toEqual({ x: 0, y: 0, w: 150, h: 75 });

    const frozen = el('b', 0, 0, 100, 50, 0, 'frozen');
    expect(box(resizeElements([frozen], 'se', p, { x: 50, y: 50 }, { registry })[0]!)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });

    const custom = resizeElements(
      [el('c', 0, 0, 100, 50, 0, 'wide-only')],
      'se',
      p,
      { x: 50, y: 50 },
      { registry },
    );
    expect(box(custom[0]!)).toEqual({ x: 0, y: 0, w: 150, h: 50 });
  });

  it('passes the element and the proposed absolute size to a custom resize function', () => {
    const resize = vi.fn((_e: ElementRecord, proposed: { w: number; h: number }) => proposed);
    const reg = createElementRegistry([defineElement({ type: 'spy', version: 1, props, resize })]);
    const e = el('a', 0, 0, 100, 50, 0, 'spy');
    resizeElements([e], 'e', { x: 0, y: 0 }, { x: -150, y: 0 }, { registry: reg });
    expect(resize).toHaveBeenCalledWith(e, { w: 50, h: 50 });
  });

  it('flips when dragged past the opposite edge', () => {
    const [r] = resizeElements([base], 'e', { x: 0, y: 0 }, { x: -150, y: 0 });
    expect(box(r!)).toEqual({ x: -50, y: 0, w: 50, h: 50 });
    expect(r).toMatchObject({ flipX: true, flipY: false });

    const [both] = resizeElements([base], 'nw', { x: 0, y: 0 }, { x: 130, y: 80 });
    expect(box(both!)).toEqual({ x: 100, y: 50, w: 30, h: 30 });
    expect(both).toMatchObject({ flipX: true, flipY: true });
  });

  it('enforces the minimum size of the type, defaulting to 1 × 1', () => {
    const [r] = resizeElements([base], 'se', { x: 0, y: 0 }, { x: -99.5, y: -49.9 });
    expect(r).toMatchObject({ w: 1, h: 1, x: 0, y: 0 });

    const big = el('b', 0, 0, 100, 100, 0, 'big');
    const [m] = resizeElements([big], 'nw', { x: 0, y: 0 }, { x: 95, y: 95 }, { registry });
    expect(box(m!)).toEqual({ x: 80, y: 70, w: 20, h: 30 });
  });

  it('rejects unknown handles', () => {
    expect(() =>
      resizeElements([base], 'up' as ResizeHandle, { x: 0, y: 0 }, { x: 1, y: 1 }),
    ).toThrow(TypeError);
  });
});

describe('BOARD-406: resizeElements, several elements', () => {
  const a = el('a', 0, 0, 10, 10);
  const b = el('b', 90, 90, 10, 10);

  it('scales positions and sizes through the selection bounds', () => {
    const [ra, rb] = resizeElements([a, b], 'se', { x: 100, y: 100 }, { x: 200, y: 200 });
    expect(box(ra!)).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(box(rb!)).toEqual({ x: 180, y: 180, w: 20, h: 20 });
  });

  it('keeps the ratio of the whole selection with Shift', () => {
    const [, rb] = resizeElements(
      [a, b],
      'se',
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { keepRatio: true },
    );
    expect(box(rb!)).toEqual({ x: 180, y: 180, w: 20, h: 20 });
  });

  it('mirrors elements and negates rotation when flipped along one axis', () => {
    const tilted = el('t', 90, 90, 10, 10, 30);
    const frame = selectionFrame([a, tilted])!;
    // Dragging the right edge two widths to the left mirrors the selection around its left edge.
    const [ra, rt] = resizeElements([a, tilted], 'e', { x: 0, y: 0 }, { x: -2 * frame.w, y: 0 });
    expect(ra!.x + ra!.w / 2).toBeCloseTo(2 * frame.x - 5);
    expect(rt!.x + rt!.w / 2).toBeCloseTo(2 * frame.x - 95);
    expect(rt).toMatchObject({ rotation: 330, flipX: true, flipY: false });
  });

  it('honours per-element modes and swaps axes for quarter turns', () => {
    const frozen = el('f', 90, 90, 10, 10, 0, 'frozen');
    const turned = el('q', 0, 0, 20, 10, 90);
    const frame = selectionFrame([turned, frozen], { registry })!;
    const results = resizeElements(
      [turned, frozen],
      'e',
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { registry },
    );
    const f = results.find((r) => r.id === 'f')!;
    const q = results.find((r) => r.id === 'q')!;
    expect(f).toMatchObject({ w: 10, h: 10, flipX: false });
    expect(f.x + f.w / 2).toBeGreaterThan(95 + 50);
    // The horizontal factor lands on the element's local height after a quarter turn.
    expect(q.w).toBeCloseTo(20);
    expect(q.h).toBeCloseTo((10 * (frame.w + 100)) / frame.w);
  });

  it('returns an empty list for an empty selection', () => {
    expect(resizeElements([], 'se', { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([]);
  });
});

describe('BOARD-406: rotateElements', () => {
  const sq = el('a', 0, 0, 100, 100);

  it('rotates by the swept angle around the frame center', () => {
    const [r] = rotateElements([sq], { x: 100, y: 50 }, { x: 50, y: 100 });
    expect(r!.rotation).toBeCloseTo(90);
    expect(r!.x).toBeCloseTo(0);
    expect(r!.y).toBeCloseTo(0);
  });

  it('snaps the absolute rotation of one element to 15 degrees with Shift', () => {
    const tilted = el('a', 0, 0, 100, 100, 10);
    const angle = (47 * Math.PI) / 180;
    const current = { x: 50 + Math.cos(angle) * 50, y: 50 + Math.sin(angle) * 50 };
    const [r] = rotateElements([tilted], { x: 100, y: 50 }, current, {
      snap: ROTATION_SNAP_DEGREES,
    });
    expect(r!.rotation).toBeCloseTo(60);
  });

  it('orbits several elements around the selection center and snaps the delta', () => {
    const a = el('a', 0, 0, 10, 10, 5);
    const b = el('b', 90, 0, 10, 10, 0);
    const angle = (95 * Math.PI) / 180;
    const current = { x: 50 + Math.cos(angle), y: 5 + Math.sin(angle) };
    const center = { x: 50, y: 5 };
    const [ra, rb] = rotateElements([a, b], { x: 60, y: 5 }, current, { snap: 15, center });
    expect(ra!.rotation).toBeCloseTo(95);
    expect(rb!.rotation).toBeCloseTo(90);
    // b's center (95, 5) orbits 90 degrees around (50, 5) to (50, 50).
    expect(rb!.x + 5).toBeCloseTo(50);
    expect(rb!.y + 5).toBeCloseTo(50);
  });

  it('normalizes the rotation to [0, 360)', () => {
    const [r] = rotateElements([sq], { x: 100, y: 50 }, { x: 50, y: 0 });
    expect(r!.rotation).toBeCloseTo(270);
  });
});

describe('BOARD-406: frames and handles', () => {
  it('uses the element itself for one element and the bounds for several', () => {
    expect(selectionFrame([el('a', 1, 2, 3, 4, 45)])).toEqual({
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      rotation: 45,
    });
    // A 100 × 100 square rotated 45 degrees reaches out to its half diagonal.
    const frame = selectionFrame([el('a', 0, 0, 100, 100, 45), el('b', 200, 0, 10, 10)])!;
    expect(frame.x).toBeCloseTo(50 - 50 * Math.SQRT2);
    expect(frame.w).toBeCloseTo(210 - frame.x);
    expect(selectionFrame([])).toBeNull();
  });

  it('places the 8 handles and the rotate handle on the frame', () => {
    const handles = transformHandles({ x: 0, y: 0, w: 100, h: 50 }, 20);
    const at = (h: string) => handles.find((p) => p.handle === h)!;
    expect(at('nw')).toMatchObject({ x: 0, y: 0 });
    expect(at('e')).toMatchObject({ x: 100, y: 25 });
    expect(at('se')).toMatchObject({ x: 100, y: 50 });
    expect(at('rotate')).toMatchObject({ x: 50, y: -20 });
    expect(handles).toHaveLength(9);
  });

  it('validates minSize in element definitions', () => {
    expect(() =>
      defineElement({ type: 'bad', version: 1, props, minSize: { w: -1, h: 0 } }),
    ).toThrow(/minSize/);
  });
});
