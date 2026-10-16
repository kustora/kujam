/**
 * `@kujam/shapes` — Elemen dan tool bawaan untuk papan `@kujam/core`.
 *
 * Semua elemen bawaan didefinisikan dengan `defineElement` dari `@kujam/core`, API yang sama
 * dengan elemen kustom, tanpa jalur pintas internal (BOARD-601).
 *
 * @packageDocumentation
 */

import { drawElement } from './elements/draw.js';
import { geoElement } from './elements/geo.js';
import { stickyElement } from './elements/sticky.js';
import { textElement } from './elements/text.js';

export { stickyElement } from './elements/sticky.js';
export { drawElement, MAX_DRAW_POINTS } from './elements/draw.js';
export { textElement } from './elements/text.js';
export { geoElement, geoGeometry, GEO_KINDS, type GeoKind } from './elements/geo.js';
export { COLOR_KEYS, STICKY_COLORS, type ColorKey, type StickyColor } from './colors.js';
export {
  EMPTY_RICH_TEXT,
  MAX_LINK_LENGTH,
  MAX_LIST_INDENT,
  MAX_RICH_TEXT_LENGTH,
  richTextSchema,
  richTextToPlainText,
  type RichText,
} from './richtext.js';

/**
 * Definisi elemen bawaan rilis 0.1, siap didaftarkan ke registri
 * (`createElementRegistry(defaultElements)`). Konektor, frame, gambar, dan grup menyusul di 0.2
 * (BOARD-1101, BOARD-1105, BOARD-1103, BOARD-1104). Menjadi plugin biasa di BOARD-602.
 *
 * @beta
 */
export const defaultElements = [stickyElement, drawElement, textElement, geoElement] as const;

/**
 * Daftar jenis elemen bawaan yang disediakan oleh `@kujam/shapes`, sama urutannya dengan
 * {@link defaultElements}.
 *
 * @public
 */
export const DEFAULT_ELEMENT_TYPES = ['sticky', 'draw', 'text', 'geo'] as const;

/**
 * Tipe string untuk elemen bawaan.
 *
 * @public
 */
export type DefaultElementType = (typeof DEFAULT_ELEMENT_TYPES)[number];

/**
 * Daftar ID tool bawaan.
 *
 * @public
 */
export const DEFAULT_TOOL_IDS = [
  'select',
  'hand',
  'sticky',
  'draw',
  'geo',
  'connector',
  'text',
  'frame',
] as const;

/**
 * Tipe string untuk ID tool bawaan.
 *
 * @public
 */
export type DefaultToolId = (typeof DEFAULT_TOOL_IDS)[number];
