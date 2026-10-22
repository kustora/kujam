import { describe, expect, it } from 'vitest';
import {
  boardToLocal,
  containedInBox,
  containedInPolygon,
  containsPoint,
  distanceToEdge,
  ellipse,
  geometryBounds,
  intersectsBox,
  intersectsPolygon,
  localToBoard,
  path,
  polygon,
  polyline,
  rect,
  resolveElementGeometry,
  rotatePoint,
  snapPoints,
  toBoardTolerance,
  type ElementTransform,
  type Point,
} from './geometry.js';

/** 100×50 element at (10, 20), rotated 90 degrees around its center (60, 45). */
const rotated: ElementTransform = { x: 10, y: 20, w: 100, h: 50, rotation: 90 };
const placed: ElementTransform = { x: 10, y: 20, w: 100, h: 50 };

function close(p: Point, x: number, y: number): void {
  expect(p.x).toBeCloseTo(x);
  expect(p.y).toBeCloseTo(y);
}

const triangle = polygon([
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 0, y: 100 },
]);

describe('BOARD-403: primitives', () => {
  it('builds rect, ellipse, polygon, and polyline', () => {
    expect(rect(10, 20)).toEqual({ kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    expect(ellipse(10, 20, 1, 2)).toEqual({ kind: 'ellipse', x: 1, y: 2, w: 10, h: 20 });
    expect(polygon([{ x: 1, y: 2 }])).toEqual({ kind: 'polygon', points: [{ x: 1, y: 2 }] });
    expect(polyline([])).toEqual({ kind: 'polyline', points: [], width: 0 });
  });

  it('builds a path from stroke tuples and point objects', () => {
    expect(path([[1, 2, 0.5], [3], [], { x: 7, y: 8 }], 4)).toEqual({
      kind: 'path',
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 0 },
        { x: 0, y: 0 },
        { x: 7, y: 8 },
      ],
      width: 4,
      closed: false,
    });
    expect(path([], undefined, true)).toEqual({ kind: 'path', points: [], width: 0, closed: true });
  });
});

describe('BOARD-403: resolveElementGeometry', () => {
  const box = rect(100, 50);

  it('uses the computed geometry when usable', () => {
    const g = ellipse(5, 5);
    expect(resolveElementGeometry(placed, () => g)).toBe(g);
    const line = polyline([{ x: 0, y: 0 }]);
    expect(resolveElementGeometry(placed, () => line)).toBe(line);
    const box = rect(1, 1);
    expect(resolveElementGeometry(placed, () => box)).toBe(box);
    expect(resolveElementGeometry(placed, () => triangle)).toBe(triangle);
    const stroke = path([[1, 1]]);
    expect(resolveElementGeometry(placed, () => stroke)).toBe(stroke);
  });

  it('falls back to the element box', () => {
    expect(resolveElementGeometry(placed)).toEqual(box);
    expect(resolveElementGeometry(placed, () => undefined)).toEqual(box);
    expect(resolveElementGeometry(placed, () => null)).toEqual(box);
    expect(resolveElementGeometry(placed, () => ({ kind: 'blob' }))).toEqual(box);
    expect(resolveElementGeometry(placed, () => polygon([]))).toEqual(box);
    expect(resolveElementGeometry(placed, () => ({ kind: 'path', points: 'x' }))).toEqual(box);
    expect(
      resolveElementGeometry(placed, () => {
        throw new Error('boom');
      }),
    ).toEqual(box);
  });
});

describe('BOARD-403: transforms', () => {
  it('rotates points clockwise around a center', () => {
    close(rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90), 0, 10);
    expect(rotatePoint({ x: 3, y: 4 }, { x: 0, y: 0 }, 0)).toEqual({ x: 3, y: 4 });
  });

  it('converts between local and board coordinates', () => {
    expect(localToBoard(placed, { x: 5, y: 5 })).toEqual({ x: 15, y: 25 });
    expect(boardToLocal(placed, { x: 15, y: 25 })).toEqual({ x: 5, y: 5 });

    // Local top-left (0, 0) is board (10, 20); rotated 90° around (60, 45) it lands on (85, -5).
    const corner = localToBoard(rotated, { x: 0, y: 0 });
    close(corner, 85, -5);
    close(boardToLocal(rotated, corner), 0, 0);
  });

  it('converts screen-pixel tolerance to board units', () => {
    expect(toBoardTolerance(8, 2)).toBe(4);
    expect(toBoardTolerance(8, 0.5)).toBe(16);
    expect(toBoardTolerance(-3, 1)).toBe(0);
    expect(() => toBoardTolerance(8, 0)).toThrow(RangeError);
    expect(() => toBoardTolerance(8, Number.NaN)).toThrow(RangeError);
    expect(() => toBoardTolerance(8, Infinity)).toThrow(RangeError);
  });
});

describe('BOARD-403: geometryBounds', () => {
  it('computes local bounds for every primitive', () => {
    expect(geometryBounds(rect(-10, 20, 5, 5))).toEqual({ minX: -5, minY: 5, maxX: 5, maxY: 25 });
    expect(geometryBounds(ellipse(40, 20, 5, 5))).toEqual({ minX: 5, minY: 5, maxX: 45, maxY: 25 });
    expect(geometryBounds(triangle)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(
      geometryBounds(
        polyline(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          4,
        ),
      ),
    ).toEqual({
      minX: -2,
      minY: -2,
      maxX: 12,
      maxY: 2,
    });
    expect(geometryBounds(path([[0, 0]], -6))).toEqual({ minX: -3, minY: -3, maxX: 3, maxY: 3 });
  });

  it('returns zero-size bounds at the origin for empty point lists', () => {
    expect(geometryBounds(polyline([], 10))).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(geometryBounds(polygon([]), placed)).toEqual({ minX: 10, minY: 20, maxX: 10, maxY: 20 });
  });

  it('applies the element transform, including rotation', () => {
    expect(geometryBounds(rect(100, 50), placed)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 70,
    });
    const b = geometryBounds(rect(100, 50), rotated);
    expect(b.minX).toBeCloseTo(35);
    expect(b.maxX).toBeCloseTo(85);
    expect(b.minY).toBeCloseTo(-5);
    expect(b.maxY).toBeCloseTo(95);
  });

  it('is exact for rotated ellipses', () => {
    const b = geometryBounds(ellipse(100, 50), rotated);
    expect(b.minX).toBeCloseTo(35);
    expect(b.maxX).toBeCloseTo(85);
    expect(b.minY).toBeCloseTo(-5);
    expect(b.maxY).toBeCloseTo(95);

    // 45°: half extents are sqrt((50² + 25²) / 2) on both axes.
    const e = Math.sqrt((50 * 50 + 25 * 25) / 2);
    const d = geometryBounds(ellipse(100, 50), { ...placed, rotation: 45 });
    expect(d.maxX - d.minX).toBeCloseTo(2 * e);
    expect(d.maxY - d.minY).toBeCloseTo(2 * e);

    // A full turn behaves like no rotation.
    expect(geometryBounds(ellipse(100, 50), { ...placed, rotation: 360 })).toEqual({
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 70,
    });
  });
});

describe('BOARD-403: distanceToEdge', () => {
  it('measures the distance to the outline', () => {
    expect(distanceToEdge(rect(100, 50), { x: 50, y: 10 })).toBe(10);
    expect(distanceToEdge(rect(100, 50), { x: 130, y: 90 })).toBe(50);
    expect(
      distanceToEdge(
        polyline(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          8,
        ),
        { x: 5, y: 3 },
      ),
    ).toBe(3);
    expect(distanceToEdge(path([[2, 2]]), { x: 5, y: 6 })).toBe(5);
    // Ellipse edges use the 64-segment approximation: within 0.13% of the radius.
    expect(Math.abs(distanceToEdge(ellipse(100, 100), { x: 50, y: 50 }) - 50)).toBeLessThan(0.07);
  });

  it('works in board coordinates and returns Infinity without points', () => {
    expect(distanceToEdge(rect(100, 50), { x: 60, y: 25 }, placed)).toBe(5);
    expect(distanceToEdge(polygon([]), { x: 0, y: 0 })).toBe(Infinity);
  });
});

describe('BOARD-403: containsPoint', () => {
  it('tests closed shapes by area', () => {
    expect(containsPoint(rect(100, 50), { x: 50, y: 25 })).toBe(true);
    expect(containsPoint(rect(100, 50), { x: 101, y: 25 })).toBe(false);
    expect(containsPoint(triangle, { x: 10, y: 10 })).toBe(true);
    expect(containsPoint(triangle, { x: 60, y: 60 })).toBe(false);
  });

  it('is exact for ellipses, including degenerate ones', () => {
    const e = ellipse(100, 50);
    expect(containsPoint(e, { x: 50, y: 25 })).toBe(true);
    // (5, 3) is inside the ellipse's box but outside the ellipse itself.
    expect(containsPoint(e, { x: 5, y: 3 })).toBe(false);
    expect(containsPoint(ellipse(0, 50), { x: 0, y: 25 })).toBe(true); // on the degenerate edge
    expect(containsPoint(ellipse(0, 50), { x: 1, y: 25 })).toBe(false);
  });

  it('tests lines and open paths by stroke thickness', () => {
    const line = polyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
    );
    expect(containsPoint(line, { x: 50, y: 5 })).toBe(true);
    expect(containsPoint(line, { x: 50, y: 6 })).toBe(false);
    expect(
      containsPoint(
        path(
          [
            [0, 0],
            [100, 0],
          ],
          2,
        ),
        { x: 50, y: 0.5 },
      ),
    ).toBe(true);
  });

  it('counts the enclosed area of a closed path', () => {
    const loop = path(
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      2,
      true,
    );
    expect(containsPoint(loop, { x: 50, y: 50 })).toBe(true);
    const open = path(
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      2,
    );
    expect(containsPoint(open, { x: 50, y: 50 })).toBe(false);
  });

  it('applies tolerance and ignores negative tolerance', () => {
    expect(containsPoint(rect(100, 50), { x: 104, y: 25 }, { tolerance: 5 })).toBe(true);
    expect(containsPoint(rect(100, 50), { x: 106, y: 25 }, { tolerance: 5 })).toBe(false);
    expect(containsPoint(rect(100, 50), { x: 100.5, y: 25 }, { tolerance: -5 })).toBe(false);
  });

  it('works in board coordinates with rotation', () => {
    // Rotated, the element covers x 35..85 and y -5..95.
    expect(containsPoint(rect(100, 50), { x: 60, y: 90 }, { element: rotated })).toBe(true);
    expect(containsPoint(rect(100, 50), { x: 100, y: 45 }, { element: rotated })).toBe(false);
    expect(containsPoint(rect(100, 50), { x: 100, y: 45 }, { element: placed })).toBe(true);
  });

  it('never hits a geometry without points', () => {
    expect(containsPoint(polyline([], 100), { x: 0, y: 0 }, { tolerance: 100 })).toBe(false);
  });
});

describe('BOARD-403: intersectsBox and intersectsPolygon', () => {
  it('detects overlap, touching, and separation with boxes', () => {
    const r = rect(100, 50);
    expect(intersectsBox(r, { minX: 90, minY: 40, maxX: 200, maxY: 200 })).toBe(true);
    expect(intersectsBox(r, { minX: 100, minY: 50, maxX: 200, maxY: 200 })).toBe(true); // corner touch
    expect(intersectsBox(r, { minX: 101, minY: 0, maxX: 200, maxY: 200 })).toBe(false);
    // Reversed min/max is normalized.
    expect(intersectsBox(r, { minX: 200, minY: 200, maxX: 90, maxY: 40 })).toBe(true);
  });

  it('detects containment in either direction', () => {
    expect(intersectsBox(rect(10, 10, 45, 20), { minX: 0, minY: 0, maxX: 100, maxY: 50 })).toBe(
      true,
    );
    expect(intersectsBox(rect(100, 50), { minX: 40, minY: 20, maxX: 60, maxY: 30 })).toBe(true);
    expect(intersectsBox(ellipse(100, 50), { minX: 45, minY: 20, maxX: 55, maxY: 30 })).toBe(true);
  });

  it('does not hit the empty corner of an ellipse box', () => {
    expect(intersectsBox(ellipse(100, 50), { minX: 0, minY: 0, maxX: 8, maxY: 5 })).toBe(false);
  });

  it('includes stroke thickness for lines', () => {
    const line = polyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
    );
    expect(intersectsBox(line, { minX: 40, minY: 4, maxX: 60, maxY: 20 })).toBe(true);
    expect(intersectsBox(line, { minX: 40, minY: 6, maxX: 60, maxY: 20 })).toBe(false);
  });

  it('uses board coordinates with rotation', () => {
    // Rotated, the element covers x 35..85, y -5..95: a box at x 90..100 misses it.
    expect(intersectsBox(rect(100, 50), { minX: 90, minY: 40, maxX: 100, maxY: 50 }, rotated)).toBe(
      false,
    );
    expect(intersectsBox(rect(100, 50), { minX: 90, minY: 40, maxX: 100, maxY: 50 }, placed)).toBe(
      true,
    );
  });

  it('intersects lasso polygons', () => {
    const lasso = [
      { x: 50, y: -10 },
      { x: 150, y: 50 },
      { x: 50, y: 110 },
    ];
    expect(intersectsPolygon(rect(60, 100), lasso)).toBe(true);
    expect(intersectsPolygon(rect(40, 100), lasso)).toBe(false);
    expect(
      intersectsPolygon(triangle, [
        { x: 60, y: 60 },
        { x: 90, y: 60 },
        { x: 90, y: 90 },
      ]),
    ).toBe(false);
  });

  it('handles degenerate inputs', () => {
    expect(intersectsPolygon(polygon([]), [{ x: 0, y: 0 }])).toBe(false);
    expect(intersectsPolygon(rect(10, 10), [])).toBe(false);
    // A two-point area behaves like a line crossing the shape.
    expect(
      intersectsPolygon(rect(10, 10), [
        { x: -5, y: 5 },
        { x: 15, y: 5 },
      ]),
    ).toBe(true);
    // A single-point area inside the shape.
    expect(intersectsPolygon(rect(10, 10), [{ x: 5, y: 5 }])).toBe(true);
    expect(intersectsPolygon(rect(10, 10), [{ x: 50, y: 5 }])).toBe(false);
  });

  it('handles collinear and touching segments', () => {
    const line = polyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    // Area edge overlapping the line.
    expect(
      intersectsPolygon(line, [
        { x: 5, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toBe(true);
    expect(
      intersectsPolygon(line, [
        { x: -10, y: 0 },
        { x: 5, y: 0 },
      ]),
    ).toBe(true);
    // Line end touching the area edge.
    expect(
      intersectsPolygon(line, [
        { x: 10, y: -5 },
        { x: 10, y: 5 },
      ]),
    ).toBe(true);
    expect(
      intersectsPolygon(line, [
        { x: 0, y: -5 },
        { x: 0, y: 5 },
      ]),
    ).toBe(true);
    // Collinear but disjoint.
    expect(
      intersectsPolygon(line, [
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ]),
    ).toBe(false);
    // Area edge ending on the line from either side.
    expect(
      intersectsPolygon(line, [
        { x: 5, y: 0 },
        { x: 5, y: 9 },
      ]),
    ).toBe(true);
    expect(
      intersectsPolygon(line, [
        { x: 5, y: 9 },
        { x: 5, y: 0 },
      ]),
    ).toBe(true);
  });
});

describe('BOARD-403: containedInBox', () => {
  it('checks full containment, including stroke thickness', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(containedInBox(rect(50, 50, 10, 10), box)).toBe(true);
    expect(containedInBox(rect(50, 50, 60, 10), box)).toBe(false);
    expect(
      containedInBox(
        polyline(
          [
            { x: 1, y: 50 },
            { x: 99, y: 50 },
          ],
          4,
        ),
        box,
      ),
    ).toBe(false);
    expect(
      containedInBox(
        polyline(
          [
            { x: 2, y: 50 },
            { x: 98, y: 50 },
          ],
          4,
        ),
        box,
      ),
    ).toBe(true);
    expect(containedInBox(path([]), box)).toBe(false);
    expect(containedInBox(ellipse(100, 100), box)).toBe(true);
  });

  it('uses rotated board bounds', () => {
    const box = { minX: 30, minY: -10, maxX: 90, maxY: 100 };
    expect(containedInBox(rect(100, 50), box, rotated)).toBe(true);
    expect(containedInBox(rect(100, 50), box, placed)).toBe(false);
  });
});

describe('BOARD-403: snapPoints', () => {
  it('returns corners, edge midpoints, and center for rects', () => {
    expect(snapPoints(rect(100, 50))).toEqual([
      { kind: 'corner', x: 0, y: 0 },
      { kind: 'corner', x: 100, y: 0 },
      { kind: 'corner', x: 100, y: 50 },
      { kind: 'corner', x: 0, y: 50 },
      { kind: 'edge', x: 50, y: 0 },
      { kind: 'edge', x: 100, y: 25 },
      { kind: 'edge', x: 50, y: 50 },
      { kind: 'edge', x: 0, y: 25 },
      { kind: 'center', x: 50, y: 25 },
    ]);
  });

  it('returns the extreme points and center for ellipses', () => {
    expect(snapPoints(ellipse(100, 50))).toEqual([
      { kind: 'edge', x: 50, y: 0 },
      { kind: 'edge', x: 100, y: 25 },
      { kind: 'edge', x: 50, y: 50 },
      { kind: 'edge', x: 0, y: 25 },
      { kind: 'center', x: 50, y: 25 },
    ]);
  });

  it('returns vertices and segment midpoints for polygons and polylines', () => {
    expect(snapPoints(triangle).map((s) => s.kind)).toEqual([
      'corner',
      'corner',
      'corner',
      'edge',
      'edge',
      'edge',
      'center',
    ]);
    const line = polyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      4,
    );
    expect(snapPoints(line)).toEqual([
      { kind: 'corner', x: 0, y: 0 },
      { kind: 'corner', x: 10, y: 0 },
      { kind: 'edge', x: 5, y: 0 },
      { kind: 'center', x: 5, y: 0 },
    ]);
    expect(snapPoints(polyline([{ x: 3, y: 4 }]))).toEqual([
      { kind: 'corner', x: 3, y: 4 },
      { kind: 'center', x: 3, y: 4 },
    ]);
  });

  it('only uses endpoints and center for paths', () => {
    expect(
      snapPoints(
        path([
          [0, 0],
          [5, 9],
          [10, 0],
        ]),
      ),
    ).toEqual([
      { kind: 'corner', x: 0, y: 0 },
      { kind: 'corner', x: 10, y: 0 },
      { kind: 'center', x: 5, y: 4.5 },
    ]);
    expect(snapPoints(path([[2, 2]]))).toEqual([
      { kind: 'corner', x: 2, y: 2 },
      { kind: 'center', x: 2, y: 2 },
    ]);
  });

  it('returns nothing for geometries without points', () => {
    expect(snapPoints(path([]))).toEqual([]);
    expect(snapPoints(polygon([]))).toEqual([]);
  });

  it('maps snap points to board coordinates', () => {
    const points = snapPoints(rect(100, 50), rotated);
    close(points[0]!, 85, -5);
    expect(points[0]!.kind).toBe('corner');
    close(points[8]!, 60, 45);
    expect(points[8]!.kind).toBe('center');
  });
});

describe('BOARD-910: containedInPolygon', () => {
  /** Concave "C" shaped lasso opening to the right, around (0..100, 0..100). */
  const cShape: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 30 },
    { x: 30, y: 30 },
    { x: 30, y: 70 },
    { x: 100, y: 70 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('contains a shape that lies fully inside a concave area', () => {
    expect(containedInPolygon(rect(20, 20, 5, 5), cShape)).toBe(true);
    expect(containedInPolygon(rect(20, 10, 60, 5), cShape)).toBe(true);
  });

  it('rejects a shape in the notch of a concave area even though its bounds fit', () => {
    expect(containedInPolygon(rect(20, 20, 50, 40), cShape)).toBe(false);
    expect(containedInPolygon(rect(60, 80, 10, 10), cShape)).toBe(false);
  });

  it('rejects a shape that sticks out, and areas with fewer than three points', () => {
    expect(containedInPolygon(rect(50, 50, 90, 10), cShape)).toBe(false);
    expect(
      containedInPolygon(rect(1, 1), [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(false);
    expect(containedInPolygon(polyline([]), cShape)).toBe(false);
  });

  it('accounts for the stroke thickness of lines', () => {
    const line = polyline(
      [
        { x: 5, y: 50 },
        { x: 25, y: 50 },
      ],
      0,
    );
    expect(containedInPolygon(line, cShape)).toBe(true);
    const thick = polyline(
      [
        { x: 5, y: 50 },
        { x: 25, y: 50 },
      ],
      12,
    );
    // The 6-unit half thickness reaches past the notch edge at x = 30.
    expect(containedInPolygon(thick, cShape)).toBe(false);
  });

  it('rejects a shape inside a hole of a self-intersecting area (even-odd)', () => {
    // Outer square and an inner square drawn as one ring, joined by a seam at the top.
    const ring: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
      { x: 40, y: 40 },
      { x: 40, y: 60 },
      { x: 60, y: 60 },
      { x: 60, y: 40 },
      { x: 40, y: 40 },
    ];
    expect(containedInPolygon(rect(4, 4, 45, 45), ring)).toBe(false);
    expect(containedInPolygon(rect(70, 70, 15, 15), ring)).toBe(false);
    expect(containedInPolygon(rect(80, 10, 10, 75), ring)).toBe(true);
  });

  it('tests ellipses with their outline and applies the element transform', () => {
    const diamond: Point[] = [
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ];
    // A circle inscribed in the diamond's bounding box pokes out of the diamond.
    expect(containedInPolygon(ellipse(100, 100), diamond)).toBe(false);
    expect(containedInPolygon(ellipse(60, 60, 20, 20), diamond)).toBe(true);
    // The 100x50 element rotated by 90 degrees spans x 35..85 and y -5..95 on the board.
    const tall: Point[] = [
      { x: 30, y: -10 },
      { x: 90, y: -10 },
      { x: 90, y: 100 },
      { x: 30, y: 100 },
    ];
    expect(containedInPolygon(rect(100, 50), tall, rotated)).toBe(true);
    expect(containedInPolygon(rect(100, 50), tall, placed)).toBe(false);
  });
});
