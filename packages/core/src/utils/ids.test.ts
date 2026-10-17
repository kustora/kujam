import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ID_LENGTH,
  compareIndex,
  createBoard,
  createId,
  indexAbove,
  indexBelow,
  indexBetween,
  indicesBetween,
} from '../index.js';

describe('createId (BOARD-202)', () => {
  it('membuat ID nanoid 21 karakter beralfabet URL yang unik', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = createId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
    expect(DEFAULT_ID_LENGTH).toBe(21);
    expect(createId(8)).toHaveLength(8);
  });

  it('menolak panjang yang tidak valid', () => {
    expect(() => createId(0)).toThrow(RangeError);
    expect(() => createId(1.5)).toThrow(RangeError);
  });

  it('hanya memakai crypto.getRandomValues global (tersedia di Node, Worker, browser)', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    createId();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('melempar error jelas bila crypto global tidak ada', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(() => createId()).toThrow(/crypto.getRandomValues tidak tersedia/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('bisa diganti lewat opsi createBoard untuk tes deterministik', () => {
    let n = 0;
    const board = createBoard({ createId: () => `id:${++n}` });
    expect([board.createId(), board.createId()]).toEqual(['id:1', 'id:2']);
    expect(createBoard().createId()).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(() => createBoard({ createId: 'x' as unknown as () => string })).toThrow(TypeError);
    expect(() => createBoard({ createId: () => '' }).createId()).toThrow(TypeError);
  });
});

describe('fractional indexing (BOARD-202)', () => {
  it('membuat index di antara, di atas, dan di bawah', () => {
    expect(indexBetween(null, null)).toBe('a0');
    const mid = indexBetween('a0', 'a1');
    expect(compareIndex('a0', mid)).toBe(-1);
    expect(compareIndex(mid, 'a1')).toBe(-1);
    expect(compareIndex('a1', 'a1')).toBe(0);
    expect(indexBetween('a1', 'a0')).toBe(mid);
    expect(indexAbove('a0') > 'a0').toBe(true);
    expect(indexBelow('a0') < 'a0').toBe(true);
    expect(indexAbove(null)).toBe('a0');
    expect(indexBelow(null)).toBe('a0');
  });

  it('indicesBetween menghasilkan n index terurut di antara batas', () => {
    const keys = indicesBetween('a0', 'a1', 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort(compareIndex)).toEqual(keys);
    expect(keys[0]! > 'a0' && keys[4]! < 'a1').toBe(true);
    expect(indicesBetween('a1', 'a0', 5)).toEqual(keys);
    expect(indicesBetween(null, null, 3)).toEqual(['a0', 'a1', 'a2']);
    expect(indicesBetween('a0', 'a1', 0)).toEqual([]);
  });

  it('menolak masukan tidak valid dengan RangeError', () => {
    expect(() => indexBetween('a0', 'a0')).toThrow(RangeError);
    expect(() => indexAbove('zz')).toThrow(RangeError);
    expect(() => indexBelow('')).toThrow(RangeError);
    expect(() => indicesBetween('a0', 'a1', -1)).toThrow(RangeError);
    expect(() => indicesBetween('a0', 'a1', 1.5)).toThrow(RangeError);
    expect(() => indicesBetween('a0', 'a0', 2)).toThrow(RangeError);
  });

  it('10.000 sisipan di posisi acak tetap terurut, unik, dan panjangnya wajar', () => {
    // Deterministic PRNG (mulberry32) so the test is repeatable.
    let seed = 0x5eed;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const keys: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const pos = Math.floor(random() * (keys.length + 1));
      const key = indexBetween(keys[pos - 1] ?? null, keys[pos] ?? null);
      keys.splice(pos, 0, key);
    }

    for (let i = 1; i < keys.length; i++) {
      expect(compareIndex(keys[i - 1]!, keys[i]!)).toBe(-1);
    }
    expect(new Set(keys).size).toBe(keys.length);
    const maxLength = Math.max(...keys.map((k) => k.length));
    // Random inserts grow roughly logarithmically; 10,000 inserts stay well under 32 characters.
    expect(maxLength).toBeLessThanOrEqual(32);
  });

  it('sisipan berulang di depan dan di belakang tetap pendek', () => {
    let top = 'a0';
    let bottom = 'a0';
    for (let i = 0; i < 10_000; i++) {
      top = indexAbove(top);
      bottom = indexBelow(bottom);
    }
    expect(top.length).toBeLessThanOrEqual(6);
    expect(bottom.length).toBeLessThanOrEqual(6);
  });
});
