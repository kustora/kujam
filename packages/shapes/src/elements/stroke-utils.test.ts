import { describe, expect, it } from 'vitest';
import {
  chunkPoints,
  cutStrokePoints,
  segmentDistance,
  simplifyPoints,
} from './stroke-utils.js';

describe('BOARD-1002: Stroke Utilities', () => {
  describe('Ramer-Douglas-Peucker simplification (simplifyPoints)', () => {
    it('returns empty array when given empty points', () => {
      expect(simplifyPoints([])).toEqual([]);
    });

    it('returns 1 or 2 points unchanged', () => {
      expect(simplifyPoints([[10, 20, 0.5]])).toEqual([[10, 20, 0.5]]);
      expect(
        simplifyPoints([
          [0, 0, 0.3],
          [100, 100, 0.8],
        ]),
      ).toEqual([
        [0, 0, 0.3],
        [100, 100, 0.8],
      ]);
    });

    it('simplifies collinear points down to start and end point', () => {
      // 5 points on a straight horizontal line
      const points = [
        [0, 50, 0.5],
        [20, 50, 0.5],
        [50, 50, 0.6],
        [80, 50, 0.4],
        [100, 50, 0.5],
      ];
      const result = simplifyPoints(points, 0.5);
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        [0, 50, 0.5],
        [100, 50, 0.5],
      ]);
    });

    it('retains points with perpendicular deviation greater than epsilon', () => {
      const points = [
        [0, 0, 0.5],
        [50, 5.1, 0.5], // along (0,0)->(100,10) chord; deviation ~0.1 <= 0.5 -> discarded
        [100, 10, 0.7], // peak deviation 10 > 0.5 -> kept
        [150, 5.1, 0.5], // along (100,10)->(200,0) chord; deviation ~0.1 <= 0.5 -> discarded
        [200, 0, 0.5],
      ];
      const result = simplifyPoints(points, 0.5);
      expect(result).toHaveLength(3);
      expect(result).toEqual([
        [0, 0, 0.5],
        [100, 10, 0.7],
        [200, 0, 0.5],
      ]);
    });

    it('preserves pressure across retained points', () => {
      const points = [
        [0, 0, 0.2],
        [50, 25, 0.85],
        [100, 0, 0.4],
      ];
      const result = simplifyPoints(points, 0.5);
      expect(result).toEqual([
        [0, 0, 0.2],
        [50, 25, 0.85],
        [100, 0, 0.4],
      ]);
    });

    it('handles thousands of points iteratively without call stack limits', () => {
      const points: number[][] = [];
      for (let i = 0; i < 6000; i++) {
        // slight jitter below epsilon
        const y = (i % 2 === 0 ? 0.1 : -0.1);
        points.push([i, y, 0.5]);
      }
      const simplified = simplifyPoints(points, 0.5);
      expect(simplified.length).toBeLessThan(10);
      expect(simplified[0]).toEqual(points[0]);
      expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
    });
  });

  describe('Point chunking (chunkPoints)', () => {
    it('returns a single chunk when point count is <= maxPoints', () => {
      const points = [
        [0, 0, 0.5],
        [10, 10, 0.5],
        [20, 20, 0.5],
      ];
      const chunks = chunkPoints(points, 5000);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(points);
    });

    it('splits strokes exceeding maxPoints with 1-point overlap', () => {
      // 7 points with maxPoints = 4
      const points = [
        [0, 0, 0.5],
        [1, 1, 0.5],
        [2, 2, 0.5],
        [3, 3, 0.5],
        [4, 4, 0.5],
        [5, 5, 0.5],
        [6, 6, 0.5],
      ];

      const chunks = chunkPoints(points, 4);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(4);
      expect(chunks[1]).toHaveLength(4);

      // Verify overlap at point index 3: [3, 3, 0.5]
      expect(chunks[0]![3]).toEqual([3, 3, 0.5]);
      expect(chunks[1]![0]).toEqual([3, 3, 0.5]);

      // Verify end points
      expect(chunks[0]![0]).toEqual([0, 0, 0.5]);
      expect(chunks[1]![3]).toEqual([6, 6, 0.5]);
    });

    it('splits strokes exceeding 5,000 points into valid chunks', () => {
      const points: number[][] = [];
      for (let i = 0; i < 11_000; i++) {
        points.push([i, i, 0.5]);
      }

      const chunks = chunkPoints(points, 5000);
      expect(chunks.length).toBe(3);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(5000);
      }
      expect(chunks[0]![0]).toEqual(points[0]);
      expect(chunks[chunks.length - 1]!.at(-1)).toEqual(points[points.length - 1]);
    });
  });

  describe('BOARD-1005: segmentDistance and cutStrokePoints', () => {
    describe('segmentDistance', () => {
      it('returns 0 when segments intersect', () => {
        const d = segmentDistance([0, 10], [20, 10], [10, 0], [10, 20]);
        expect(d).toBe(0);
      });

      it('returns Euclidean distance for parallel or non-intersecting segments', () => {
        const d = segmentDistance([0, 0], [10, 0], [0, 5], [10, 5]);
        expect(d).toBeCloseTo(5);

        const dEnd = segmentDistance([0, 0], [10, 0], [15, 0], [20, 0]);
        expect(dEnd).toBeCloseTo(5);
      });
    });

    describe('cutStrokePoints', () => {
      it('returns empty array when given empty stroke', () => {
        expect(cutStrokePoints([], { x: 0, y: 0 }, { x: 10, y: 10 }, 5)).toEqual([]);
      });

      it('returns stroke unchanged when eraser is far away', () => {
        const points = [
          [0, 100, 0.5],
          [200, 100, 0.5],
        ];
        const res = cutStrokePoints(points, { x: 50, y: 500 }, { x: 100, y: 500 }, 10);
        expect(res).toHaveLength(1);
        expect(res[0]).toEqual(points);
      });

      it('returns empty array when entire stroke is inside eraser', () => {
        const points = [
          [50, 50, 0.5],
          [60, 50, 0.5],
        ];
        const res = cutStrokePoints(points, { x: 55, y: 50 }, { x: 55, y: 50 }, 20);
        expect(res).toEqual([]);
      });

      it('cuts stroke into two pieces when eraser touches middle', () => {
        const points = [
          [0, 100, 0.5],
          [200, 100, 0.5],
        ];
        // Eraser at (100, 100) with radius 10
        const res = cutStrokePoints(points, { x: 100, y: 100 }, { x: 100, y: 100 }, 10);
        expect(res).toHaveLength(2);

        // First piece starts at 0 and ends near 90
        expect(res[0]![0]![0]).toBeCloseTo(0);
        expect(res[0]!.at(-1)![0]).toBeCloseTo(90, 0);

        // Second piece starts near 110 and ends at 200
        expect(res[1]![0]![0]).toBeCloseTo(110, 0);
        expect(res[1]!.at(-1)![0]).toBeCloseTo(200);
      });

      it('trims start of stroke when eraser touches start', () => {
        const points = [
          [0, 100, 0.5],
          [200, 100, 0.5],
        ];
        // Eraser at (0, 100) with radius 20
        const res = cutStrokePoints(points, { x: 0, y: 100 }, { x: 0, y: 100 }, 20);
        expect(res).toHaveLength(1);
        expect(res[0]![0]![0]).toBeCloseTo(20, 0);
        expect(res[0]!.at(-1)![0]).toBeCloseTo(200);
      });

      it('trims end of stroke when eraser touches end', () => {
        const points = [
          [0, 100, 0.5],
          [200, 100, 0.5],
        ];
        // Eraser at (200, 100) with radius 20
        const res = cutStrokePoints(points, { x: 200, y: 100 }, { x: 200, y: 100 }, 20);
        expect(res).toHaveLength(1);
        expect(res[0]![0]![0]).toBeCloseTo(0);
        expect(res[0]!.at(-1)![0]).toBeCloseTo(180, 0);
      });

      it('cuts stroke using swept capsule between two points', () => {
        // Vertical line
        const points = [
          [100, 0, 0.5],
          [100, 200, 0.5],
        ];
        // Horizontal eraser sweep crossing at y = 100 with radius 5
        const res = cutStrokePoints(points, { x: 80, y: 100 }, { x: 120, y: 100 }, 5);
        expect(res).toHaveLength(2);
        expect(res[0]!.at(-1)![1]).toBeCloseTo(95, 0);
        expect(res[1]![0]![1]).toBeCloseTo(105, 0);
      });
    });
  });
});
