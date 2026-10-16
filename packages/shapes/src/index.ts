/**
 * `@kujam/shapes` — Elemen dan tool bawaan untuk papan `@kujam/core`.
 *
 * @packageDocumentation
 */

/**
 * Daftar jenis elemen bawaan yang disediakan oleh `@kujam/shapes`.
 *
 * @public
 */
export const DEFAULT_ELEMENT_TYPES = [
  'sticky',
  'draw',
  'text',
  'geo',
  'connector',
  'frame',
  'image',
  'group',
] as const;

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
