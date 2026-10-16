/**
 * Modul indeks spasial R-tree (rbush) untuk pencarian area elemen (BOARD-404, BOARD-206).
 *
 * @packageDocumentation
 */

import RBush from 'rbush';
import type { Geometry } from './geometry.js';
import type { ElementRecord } from './types.js';

/**
 * Batas kotak sejajar sumbu dalam format koordinat min/max.
 *
 * @public
 */
export interface BoxBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Batas kotak sejajar sumbu dalam format posisi dan ukuran (x, y, w, h).
 *
 * @public
 */
export interface RectBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Representasi batas kotak pencarian spasial; mendukung format BoxBounds atau RectBounds.
 *
 * @public
 */
export type Bounds = BoxBounds | RectBounds;

/**
 * Entri internal dalam indeks R-tree.
 *
 * @internal
 */
export interface SpatialItem extends BoxBounds {
  readonly id: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Memeriksa apakah suatu objek berformat {@link BoxBounds}.
 *
 * @public
 */
export function isBoxBounds(bounds: unknown): bounds is BoxBounds {
  if (typeof bounds !== 'object' || bounds === null) return false;
  const b = bounds as Record<string, unknown>;
  return (
    isFiniteNumber(b.minX) &&
    isFiniteNumber(b.minY) &&
    isFiniteNumber(b.maxX) &&
    isFiniteNumber(b.maxY)
  );
}

/**
 * Memeriksa apakah suatu objek berformat {@link RectBounds}.
 *
 * @public
 */
export function isRectBounds(bounds: unknown): bounds is RectBounds {
  if (typeof bounds !== 'object' || bounds === null) return false;
  const b = bounds as Record<string, unknown>;
  return isFiniteNumber(b.x) && isFiniteNumber(b.y) && isFiniteNumber(b.w) && isFiniteNumber(b.h);
}

/**
 * Menormalkan {@link Bounds} masukan menjadi {@link BoxBounds} yang valid (`minX <= maxX` dan `minY <= maxY`).
 *
 * @throws `TypeError` bila argumen tidak berformat `BoxBounds` atau `RectBounds`.
 * @public
 */
export function normalizeBounds(bounds: Bounds): BoxBounds {
  if (isBoxBounds(bounds)) {
    return {
      minX: Math.min(bounds.minX, bounds.maxX),
      minY: Math.min(bounds.minY, bounds.maxY),
      maxX: Math.max(bounds.minX, bounds.maxX),
      maxY: Math.max(bounds.minY, bounds.maxY),
    };
  }
  if (isRectBounds(bounds)) {
    return {
      minX: Math.min(bounds.x, bounds.x + bounds.w),
      minY: Math.min(bounds.y, bounds.y + bounds.h),
      maxX: Math.max(bounds.x, bounds.x + bounds.w),
      maxY: Math.max(bounds.y, bounds.y + bounds.h),
    };
  }
  throw new TypeError(
    'Bounds harus berupa objek { minX, minY, maxX, maxY } atau { x, y, w, h } dengan angka berhingga.',
  );
}

/**
 * Menghitung AABB (Axis-Aligned Bounding Box) suatu elemen di koordinat global papan,
 * memperhitungkan ukuran dasar, geometri lokal (bila ada), dan rotasi elemen (BOARD-404).
 *
 * @public
 */
export function computeElementAABB(
  element: ElementRecord,
  getGeometry?: (el: ElementRecord) => Geometry | undefined,
): BoxBounds {
  let lx1 = 0;
  let ly1 = 0;
  let lx2 = element.w;
  let ly2 = element.h;

  let customPoints: { x: number; y: number }[] | null = null;
  let strokePadding = 0;

  if (getGeometry) {
    try {
      const geom = getGeometry(element);
      if (geom) {
        switch (geom.kind) {
          case 'rect':
          case 'ellipse':
            lx1 = geom.x;
            ly1 = geom.y;
            lx2 = geom.x + geom.w;
            ly2 = geom.y + geom.h;
            break;
          case 'polygon':
            if (geom.points.length > 0) {
              customPoints = geom.points.map((p) => ({ x: p.x, y: p.y }));
              lx1 = Math.min(...geom.points.map((p) => p.x));
              ly1 = Math.min(...geom.points.map((p) => p.y));
              lx2 = Math.max(...geom.points.map((p) => p.x));
              ly2 = Math.max(...geom.points.map((p) => p.y));
            }
            break;
          case 'polyline':
            if (geom.points.length > 0) {
              customPoints = geom.points.map((p) => ({ x: p.x, y: p.y }));
              strokePadding = (geom.width ?? 0) / 2;
              lx1 = Math.min(...geom.points.map((p) => p.x)) - strokePadding;
              ly1 = Math.min(...geom.points.map((p) => p.y)) - strokePadding;
              lx2 = Math.max(...geom.points.map((p) => p.x)) + strokePadding;
              ly2 = Math.max(...geom.points.map((p) => p.y)) + strokePadding;
            }
            break;
        }
      }
    } catch {
      // Abaikan error fungsi geometri dan gunakan ukuran bawaan elemen
    }
  }

  // Jika tanpa rotasi
  if (!element.rotation || element.rotation % 360 === 0) {
    return {
      minX: element.x + lx1,
      minY: element.y + ly1,
      maxX: element.x + lx2,
      maxY: element.y + ly2,
    };
  }

  // Jika ada rotasi: pusat rotasi berada di tengah elemen (element.x + element.w / 2, element.y + element.h / 2)
  const cx = element.x + element.w / 2;
  const cy = element.y + element.h / 2;
  const rad = (element.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const localCorners = customPoints
    ? customPoints
    : [
        { x: lx1, y: ly1 },
        { x: lx2, y: ly1 },
        { x: lx2, y: ly2 },
        { x: lx1, y: ly2 },
      ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of localCorners) {
    const wx = element.x + pt.x;
    const wy = element.y + pt.y;
    const dx = wx - cx;
    const dy = wy - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;

    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }

  return {
    minX: minX - strokePadding,
    minY: minY - strokePadding,
    maxX: maxX + strokePadding,
    maxY: maxY + strokePadding,
  };
}

/**
 * Antarmuka indeks spasial papan tulis untuk pencarian cepat elemen (BOARD-404, BOARD-206).
 *
 * @public
 */
export interface SpatialIndex {
  /** Memasukkan elemen ke dalam indeks spasial. */
  insert(element: ElementRecord): void;
  /** Memperbarui elemen di dalam indeks spasial bila posisinya/bounds berubah. */
  update(element: ElementRecord): void;
  /** Menghapus elemen dari indeks spasial berdasarkan ID. */
  remove(id: string): void;
  /** Mencari seluruh ID elemen yang bersinggungan dengan batas koordinat `bounds`. */
  search(bounds: Bounds): readonly string[];
  /** Mengosongkan seluruh indeks spasial. */
  clear(): void;
  /** Memuat sekumpulan elemen ke dalam indeks sekaligus (bulk load). */
  load(elements: Iterable<ElementRecord>): void;
  /** Jumlah elemen yang terdaftar di dalam indeks. */
  size(): number;
  /** Mengambil batas koordinat AABB elemen berdasarkan ID, atau `undefined` bila tidak ada. */
  getBounds(id: string): BoxBounds | undefined;
}

/**
 * Membuat instance {@link SpatialIndex} baru menggunakan R-tree (`rbush`).
 *
 * @param getGeometry - Callback opsional untuk mengekstrak geometri kustom per elemen.
 * @public
 */
export function createSpatialIndex(
  getGeometry?: (el: ElementRecord) => Geometry | undefined,
): SpatialIndex {
  const tree = new RBush<SpatialItem>();
  const itemsById = new Map<string, SpatialItem>();

  function makeItem(el: ElementRecord): SpatialItem {
    const aabb = computeElementAABB(el, getGeometry);
    return { ...aabb, id: el.id };
  }

  return {
    insert(element: ElementRecord): void {
      if (itemsById.has(element.id)) {
        this.update(element);
        return;
      }
      const item = makeItem(element);
      itemsById.set(element.id, item);
      tree.insert(item);
    },
    update(element: ElementRecord): void {
      const oldItem = itemsById.get(element.id);
      const newItem = makeItem(element);

      if (
        oldItem &&
        oldItem.minX === newItem.minX &&
        oldItem.minY === newItem.minY &&
        oldItem.maxX === newItem.maxX &&
        oldItem.maxY === newItem.maxY
      ) {
        return;
      }

      if (oldItem) {
        tree.remove(oldItem);
      }
      itemsById.set(element.id, newItem);
      tree.insert(newItem);
    },
    remove(id: string): void {
      const item = itemsById.get(id);
      if (item) {
        tree.remove(item);
        itemsById.delete(id);
      }
    },
    search(bounds: Bounds): readonly string[] {
      const norm = normalizeBounds(bounds);
      const hits = tree.search(norm);
      return hits.map((h) => h.id);
    },
    clear(): void {
      tree.clear();
      itemsById.clear();
    },
    load(elements: Iterable<ElementRecord>): void {
      const items: SpatialItem[] = [];
      for (const el of elements) {
        if (el.kind === 'element') {
          const item = makeItem(el);
          itemsById.set(el.id, item);
          items.push(item);
        }
      }
      tree.load(items);
    },
    size(): number {
      return itemsById.size;
    },
    getBounds(id: string): BoxBounds | undefined {
      const item = itemsById.get(id);
      if (!item) return undefined;
      return {
        minX: item.minX,
        minY: item.minY,
        maxX: item.maxX,
        maxY: item.maxY,
      };
    },
  };
}
