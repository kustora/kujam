/**
 * `@kujam/shapes` — Elemen dan tool bawaan untuk papan `@kujam/core`.
 *
 * Semua elemen dan tool bawaan didefinisikan dengan `defineElement`, `defineTool`, dan
 * `definePlugin` dari `@kujam/core` — API publik yang sama dengan plugin kustom, tanpa jalur
 * pintas internal (BOARD-601, BOARD-602).
 *
 * @packageDocumentation
 */

import { definePlugin } from '@kujam/core';
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
 * Plugin elemen bawaan rilis 0.1 (`sticky`, `draw`, `text`, `geo`), siap dipasang lewat
 * `createBoard({ plugins: [defaultElements, defaultTools] })` atau `createElementRegistry(defaultElements)`.
 * Konektor, frame, gambar, dan grup menyusul di 0.2 (BOARD-1101, BOARD-1105, BOARD-1103, BOARD-1104).
 *
 * @public
 */
export const defaultElements = definePlugin({
  id: 'default-elements',
  elements: Object.freeze([stickyElement, drawElement, textElement, geoElement] as const),
});

/**
 * Plugin tool bawaan, siap dipasang lewat `createBoard({ plugins: [defaultElements, defaultTools] })`.
 * Implementasi state machine tool bawaan diisi oleh BOARD-502 (`select`, `hand`) dan BOARD-E10.
 *
 * @public
 */
export const defaultTools = definePlugin({
  id: 'default-tools',
  tools: Object.freeze([] as const),
});

/**
 * Daftar jenis elemen bawaan yang disediakan oleh `@kujam/shapes`, sama urutannya dengan
 * `defaultElements.elements`.
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
