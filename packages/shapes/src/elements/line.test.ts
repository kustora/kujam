// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  type Board,
  type ElementCanvasContext,
  type ElementRecord,
  type Point,
  validate,
} from '@kujam/core';
import {
  defaultElements,
  defaultTools,
  lineElement,
  linePropsSchema,
  MAX_LINE_POINTS,
} from '../index.js';
import {
  insertLinePoint,
  lineWorldPoints,
  moveLinePoint,
  normalizeLinePoints,
  removeLinePoint,
  type LineProps,
} from './line.js';

function setup(): Board {
  const board = createBoard({ plugins: [defaultElements, defaultTools], snap: { grid: null } });
  board.camera.setViewport({ width: 1200, height: 900 });
  return board;
}

function line(points: Point[], extra: Partial<ElementRecord<LineProps>> = {}) {
  const box = normalizeLinePoints(points);
  return {
    id: 'l',
    kind: 'element',
    type: 'line',
    pageId: 'page:main',
    parentId: null,
    index: 'a0',
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rotation: 0,
    locked: false,
    opacity: 1,
    typeVersion: 1,
    meta: {},
    props: { ...lineElement.defaults, points: box.points } as LineProps,
    ...extra,
  } as ElementRecord<LineProps>;
}

function mockContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push({ name, args });
  const g = {
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    fill: record('fill'),
    arc: record('arc'),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  return { g: g as unknown as ElementCanvasContext & typeof g, calls };
}

describe('line element (BOARD-1106)', () => {
  it('is registered by defaultElements with connector-like style defaults', () => {
    const board = setup();
    expect(board.elements.has('line')).toBe(true);
    const el = board.create({ type: 'line', x: 10, y: 20 });
    expect(el.props).toMatchObject({
      points: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
      color: 'black',
      dash: 'solid',
      startArrow: 'none',
      endArrow: 'none',
    });
  });

  it('accepts the connector arrowheads and dashes, and limits the point count', () => {
    const board = setup();
    const el = board.create({
      type: 'line',
      props: { startArrow: 'diamond', endArrow: 'triangle', dash: 'dotted' },
    });
    expect(el.props.endArrow).toBe('triangle');
    const valid = { ...lineElement.defaults };
    expect(validate(linePropsSchema, valid).ok).toBe(true);
    expect(validate(linePropsSchema, { ...valid, startArrow: 'bogus' }).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_LINE_POINTS + 1 }, (_, i) => ({ x: i, y: 0 }));
    expect(validate(linePropsSchema, { ...valid, points: tooMany }).ok).toBe(false);
  });

  it('hit-tests along the segments, not inside the bounding box', () => {
    const board = setup();
    const el = line([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
    ]);
    board.transact((tx) => tx.put(el));
    expect(board.hitTest({ x: 100, y: 1 })?.id).toBe('l');
    expect(board.hitTest({ x: 199, y: 100 })?.id).toBe('l');
    expect(board.hitTest({ x: 50, y: 150 })).toBeUndefined();
  });

  it('draws straight segments with the connector dash and arrowheads', () => {
    const el = line([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    const styled = {
      ...el,
      props: { ...el.props, dash: 'dashed', endArrow: 'triangle', strokeWidth: 2 },
    } as ElementRecord<LineProps>;
    const { g, calls } = mockContext();
    lineElement.render!.canvas!(g, styled, undefined, undefined as never);
    expect(
      calls
        .filter((c) => c.name === 'lineTo')
        .slice(0, 2)
        .map((c) => c.args),
    ).toEqual([
      [100, 0],
      [100, 100],
    ]);
    expect(g.setLineDash).toHaveBeenCalledWith([8, 8]);
    // The triangle arrowhead is filled at the last point.
    expect(calls.some((c) => c.name === 'fill')).toBe(true);

    const plain = mockContext();
    lineElement.render!.canvas!(plain.g, el, undefined, undefined as never);
    expect(plain.calls.some((c) => c.name === 'fill')).toBe(false);
  });

  it('draws nothing with fewer than 2 points', () => {
    const { g, calls } = mockContext();
    lineElement.render!.canvas!(g, line([{ x: 5, y: 5 }]), undefined, undefined as never);
    expect(calls).toEqual([]);
  });

  it('offers color, thickness, dash, and arrowhead actions, remembered for the line tool', () => {
    const board = setup();
    const el = board.create({ type: 'line' });
    board.select([el.id]);
    const ids = board.getActions().map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'style.color.red',
        'style.thickness.l',
        'style.dash.dashed',
        'style.startArrow.arrow',
        'style.endArrow.diamond',
      ]),
    );
    expect(ids.some((id) => id.startsWith('style.connectorStyle'))).toBe(false);
    board
      .getActions()
      .find((a) => a.id === 'style.endArrow.arrow')!
      .run();
    expect(board.getElement(el.id)!.props.endArrow).toBe('arrow');
    expect(board.toolStyles.get('line')).toMatchObject({ endArrow: 'arrow' });
  });
});

describe('line point editing helpers (BOARD-1106)', () => {
  const base = line([
    { x: 10, y: 10 },
    { x: 110, y: 10 },
    { x: 110, y: 60 },
  ]);

  it('moves a point and re-normalizes the box', () => {
    const next = moveLinePoint(base, 0, { x: -40, y: 100 });
    expect({ x: next.x, y: next.y, w: next.w, h: next.h }).toEqual({
      x: -40,
      y: 10,
      w: 150,
      h: 90,
    });
    expect(lineWorldPoints(next)).toEqual([
      { x: -40, y: 100 },
      { x: 110, y: 10 },
      { x: 110, y: 60 },
    ]);
  });

  it('inserts a point before an index and removes points down to 2', () => {
    const inserted = insertLinePoint(base, 1, { x: 60, y: 0 });
    expect(lineWorldPoints(inserted)).toEqual([
      { x: 10, y: 10 },
      { x: 60, y: 0 },
      { x: 110, y: 10 },
      { x: 110, y: 60 },
    ]);
    const removed = removeLinePoint(base, 1)!;
    expect(lineWorldPoints(removed)).toEqual([
      { x: 10, y: 10 },
      { x: 110, y: 60 },
    ]);
    expect(removeLinePoint(removed, 0)).toBeNull();
  });

  it('bakes the rotation into the points when editing a rotated line', () => {
    const rotated = { ...base, rotation: 90 } as ElementRecord<LineProps>;
    const before = lineWorldPoints(rotated);
    const next = moveLinePoint(rotated, 2, before[2]!);
    expect(next.rotation).toBe(0);
    lineWorldPoints(next).forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i]!.x);
      expect(p.y).toBeCloseTo(before[i]!.y);
    });
  });
});
