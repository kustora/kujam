/**
 * Primitif geometri minimal untuk kontrak `defineElement` (BOARD-601).
 *
 * Hanya bentuk data dan konstruktornya. Operasi (bounds, hit-test, jarak, irisan, titik snap) dan
 * transformasi rotasi milik pustaka geometri BOARD-403, yang akan memperluas modul ini.
 *
 * Semua koordinat bersifat lokal terhadap elemen: titik `(0, 0)` adalah sudut kiri atas elemen
 * sebelum rotasi, satuan papan.
 */

/**
 * Titik dua dimensi dalam satuan papan.
 *
 * @beta
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Kotak sejajar sumbu, koordinat lokal elemen.
 *
 * @beta
 */
export interface RectGeometry {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Elips yang mengisi kotak `x, y, w, h`, koordinat lokal elemen.
 *
 * @beta
 */
export interface EllipseGeometry {
  readonly kind: 'ellipse';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Poligon tertutup (titik terakhir tersambung ke titik pertama), koordinat lokal elemen.
 *
 * @beta
 */
export interface PolygonGeometry {
  readonly kind: 'polygon';
  readonly points: readonly Point[];
}

/**
 * Garis berantai terbuka, misalnya coretan atau garis. `width` adalah tebal garis untuk hit-test.
 *
 * @beta
 */
export interface PolylineGeometry {
  readonly kind: 'polyline';
  readonly points: readonly Point[];
  readonly width: number;
}

/**
 * Geometri elemen untuk hit-test, snap, dan seleksi. Dikembalikan oleh `geometry` di
 * `defineElement`. Daftar bentuk akan diperluas BOARD-403 (misalnya `path`).
 *
 * @beta
 */
export type Geometry = RectGeometry | EllipseGeometry | PolygonGeometry | PolylineGeometry;

/**
 * Kotak dari sudut kiri atas elemen, atau dari titik `(x, y)` bila diberikan.
 *
 * @example
 * ```ts
 * geometry: (el) => rect(el.w, el.h),
 * ```
 *
 * @beta
 */
export function rect(w: number, h: number, x = 0, y = 0): RectGeometry {
  return { kind: 'rect', x, y, w, h };
}

/**
 * Elips yang mengisi kotak `w × h` dari sudut kiri atas elemen, atau dari titik `(x, y)`.
 *
 * @beta
 */
export function ellipse(w: number, h: number, x = 0, y = 0): EllipseGeometry {
  return { kind: 'ellipse', x, y, w, h };
}

/**
 * Poligon tertutup dari daftar titik.
 *
 * @beta
 */
export function polygon(points: readonly Point[]): PolygonGeometry {
  return { kind: 'polygon', points };
}

/**
 * Garis berantai terbuka dari daftar titik, dengan tebal garis untuk hit-test (bawaan 0).
 *
 * @beta
 */
export function polyline(points: readonly Point[], width = 0): PolylineGeometry {
  return { kind: 'polyline', points, width };
}
