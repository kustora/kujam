import { describe, expect, it } from 'vitest';
import {
  computeElementAABB,
  createSpatialIndex,
  ellipse,
  isBoxBounds,
  isRectBounds,
  normalizeBounds,
  polygon,
  polyline,
  rect,
  type ElementRecord,
} from './index.js';

function makeElement(overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id: 'el-1',
    kind: 'element',
    type: 'note',
    pageId: 'page:main',
    parentId: null,
    index: 'a0',
    x: 100,
    y: 200,
    rotation: 0,
    w: 50,
    h: 80,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...overrides,
  };
}

describe('BOARD-404 / BOARD-206: spatial bounds normalization', () => {
  it('mendeteksi format BoxBounds dan RectBounds', () => {
    expect(isBoxBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBe(true);
    expect(isBoxBounds({ x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    expect(isBoxBounds(null)).toBe(false);
    expect(isBoxBounds({ minX: '0', minY: 0, maxX: 10, maxY: 10 })).toBe(false);

    expect(isRectBounds({ x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(isRectBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBe(false);
    expect(isRectBounds(undefined)).toBe(false);
    expect(isRectBounds({ x: 0, y: 0, w: '10', h: 10 })).toBe(false);
  });

  it('menormalkan BoxBounds dan RectBounds', () => {
    expect(normalizeBounds({ minX: 10, minY: 20, maxX: 100, maxY: 200 })).toEqual({
      minX: 10,
      minY: 20,
      maxX: 100,
      maxY: 200,
    });

    // Handles min > max
    expect(normalizeBounds({ minX: 100, minY: 200, maxX: 10, maxY: 20 })).toEqual({
      minX: 10,
      minY: 20,
      maxX: 100,
      maxY: 200,
    });

    // Rect format
    expect(normalizeBounds({ x: 10, y: 20, w: 90, h: 180 })).toEqual({
      minX: 10,
      minY: 20,
      maxX: 100,
      maxY: 200,
    });

    // Rect format with negative w/h
    expect(normalizeBounds({ x: 100, y: 200, w: -90, h: -180 })).toEqual({
      minX: 10,
      minY: 20,
      maxX: 100,
      maxY: 200,
    });
  });

  it('melempar TypeError untuk bounds tidak valid', () => {
    expect(() => normalizeBounds({} as never)).toThrow(TypeError);
    expect(() => normalizeBounds(null as never)).toThrow(TypeError);
    expect(() => normalizeBounds({ minX: NaN, minY: 0, maxX: 10, maxY: 10 } as never)).toThrow(
      TypeError,
    );
  });
});

describe('BOARD-404: computeElementAABB', () => {
  it('menghitung AABB elemen tanpa rotasi', () => {
    const el = makeElement({ x: 50, y: 60, w: 100, h: 200, rotation: 0 });
    const aabb = computeElementAABB(el);
    expect(aabb).toEqual({ minX: 50, minY: 60, maxX: 150, maxY: 260 });
  });

  it('menghitung AABB elemen dengan rotasi 90 derajat', () => {
    // A 100x200 box at (0, 0), center (50, 100).
    // After a 90-degree rotation, the dimensions swap to 200x100 with the same center (50, 100).
    // minX = 50 - 100 = -50, maxX = 50 + 100 = 150
    // minY = 100 - 50 = 50, maxY = 100 + 50 = 150
    const el = makeElement({ x: 0, y: 0, w: 100, h: 200, rotation: 90 });
    const aabb = computeElementAABB(el);
    expect(Math.round(aabb.minX)).toBe(-50);
    expect(Math.round(aabb.minY)).toBe(50);
    expect(Math.round(aabb.maxX)).toBe(150);
    expect(Math.round(aabb.maxY)).toBe(150);
  });

  it('menghitung AABB dengan geometri rect dan ellipse lokal', () => {
    const el = makeElement({ x: 10, y: 20, w: 100, h: 100 });
    const aabbRect = computeElementAABB(el, () => rect(60, 40, 10, 15));
    expect(aabbRect).toEqual({ minX: 20, minY: 35, maxX: 80, maxY: 75 });

    const aabbEllipse = computeElementAABB(el, () => ellipse(60, 40, 10, 15));
    expect(aabbEllipse).toEqual({ minX: 20, minY: 35, maxX: 80, maxY: 75 });
  });

  it('menghitung AABB dengan geometri polygon dan polyline', () => {
    const el = makeElement({ x: 10, y: 10, w: 100, h: 100 });
    const aabbPoly = computeElementAABB(el, () =>
      polygon([
        { x: 0, y: 0 },
        { x: 50, y: 20 },
        { x: 10, y: 80 },
      ]),
    );
    expect(aabbPoly).toEqual({ minX: 10, minY: 10, maxX: 60, maxY: 90 });

    const aabbLine = computeElementAABB(el, () =>
      polyline(
        [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
        4,
      ),
    );
    expect(aabbLine).toEqual({ minX: 8, minY: 8, maxX: 62, maxY: 62 });
  });

  it('menghitung AABB polygon dan polyline dengan rotasi', () => {
    const el = makeElement({ x: 0, y: 0, w: 100, h: 100, rotation: 90 });
    const aabb = computeElementAABB(el, () =>
      polygon([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ]),
    );
    expect(aabb.minX).toBeDefined();
    expect(aabb.maxX).toBeDefined();
  });

  it('tetap aman bila fungsi geometri melempar error', () => {
    const el = makeElement({ x: 10, y: 20, w: 100, h: 80 });
    const aabb = computeElementAABB(el, () => {
      throw new Error('Boom');
    });
    expect(aabb).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 100 });
  });
});

describe('BOARD-404: createSpatialIndex', () => {
  it('insert, search, update, dan remove', () => {
    const index = createSpatialIndex();
    const el1 = makeElement({ id: 'el-1', x: 0, y: 0, w: 50, h: 50 });
    const el2 = makeElement({ id: 'el-2', x: 200, y: 200, w: 50, h: 50 });

    index.insert(el1);
    index.insert(el2);
    expect(index.size()).toBe(2);
    expect(index.getBounds('el-1')).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
    expect(index.getBounds('non-existent')).toBeUndefined();

    // Query an area covering only el1
    expect(index.search({ x: -10, y: -10, w: 70, h: 70 })).toEqual(['el-1']);

    // Query an area covering both
    expect(index.search({ minX: -10, minY: -10, maxX: 300, maxY: 300 })).toContain('el-1');
    expect(index.search({ minX: -10, minY: -10, maxX: 300, maxY: 300 })).toContain('el-2');

    // Update el1 to move near el2
    const el1Moved = makeElement({ id: 'el-1', x: 190, y: 190, w: 50, h: 50 });
    index.update(el1Moved);
    expect(index.search({ x: -10, y: -10, w: 70, h: 70 })).toEqual([]);
    expect(index.search({ x: 180, y: 180, w: 100, h: 100 }).sort()).toEqual(['el-1', 'el-2']);

    // Updating with the same bounds is a no-op
    index.update(el1Moved);
    expect(index.size()).toBe(2);

    // Re-inserting the same id triggers an update
    index.insert(el1Moved);
    expect(index.size()).toBe(2);

    // Remove
    index.remove('el-1');
    expect(index.size()).toBe(1);
    expect(index.search({ x: 180, y: 180, w: 100, h: 100 })).toEqual(['el-2']);

    // Removing a missing ID is safe
    index.remove('el-not-found');
    expect(index.size()).toBe(1);

    // Clear
    index.clear();
    expect(index.size()).toBe(0);
    expect(index.search({ minX: -100, minY: -100, maxX: 1000, maxY: 1000 })).toEqual([]);
  });

  it('load memuat banyak elemen sekaligus', () => {
    const index = createSpatialIndex();
    const elements: ElementRecord[] = [
      makeElement({ id: 'el-1', x: 10, y: 10, w: 10, h: 10 }),
      makeElement({ id: 'el-2', x: 50, y: 50, w: 10, h: 10 }),
    ];
    index.load(elements);
    expect(index.size()).toBe(2);
    expect(index.search({ x: 0, y: 0, w: 30, h: 30 })).toEqual(['el-1']);
  });

  it('benchmark: pencarian viewport pada 5.000 elemen di bawah 1 ms (BOARD-404)', () => {
    const index = createSpatialIndex();
    const elements: ElementRecord[] = [];
    for (let i = 0; i < 5000; i++) {
      elements.push(
        makeElement({
          id: `el-${i}`,
          x: (i % 100) * 100,
          y: Math.floor(i / 100) * 100,
          w: 80,
          h: 80,
        }),
      );
    }

    index.load(elements);
    expect(index.size()).toBe(5000);

    const viewport = { minX: 1000, minY: 1000, maxX: 3000, maxY: 3000 };

    // Warm up JIT
    for (let i = 0; i < 50; i++) {
      index.search(viewport);
    }

    const iterations = 100;
    const start = performance.now();
    let hitsCount = 0;
    for (let i = 0; i < iterations; i++) {
      hitsCount += index.search(viewport).length;
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;

    expect(hitsCount).toBeGreaterThan(0);
    expect(avgMs).toBeLessThan(1.0); // Under 1 ms per query
  });
});
