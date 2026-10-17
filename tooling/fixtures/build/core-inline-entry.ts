// BOARD-102: build fixture. Uses all three libraries that must be inlined into @kujam/core.
import RBush from 'rbush';
import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';

export function probe(): [number, string, number] {
  const tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number }>();
  tree.insert({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  return [tree.all().length, generateKeyBetween(null, null), nanoid(8).length];
}
