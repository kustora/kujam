/**
 * Built-in element color keys. Documents store keys, not hex, so the theme can be swapped
 * (BOARD-1006). The hex values here are temporary until the BOARD-1006 theme object exists.
 */
import type { Bilingual } from './i18n.js';

/**
 * Color keys for strokes, text, and shapes.
 *
 * @beta
 */
export const COLOR_KEYS = [
  'black',
  'grey',
  'white',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'violet',
] as const;

/**
 * Color keys for strokes, text, and shapes.
 *
 * @beta
 */
export type ColorKey = (typeof COLOR_KEYS)[number];

/**
 * The six built-in sticky colors (PRD); actual values come from the theme (BOARD-1006).
 *
 * @beta
 */
export const STICKY_COLORS = ['yellow', 'orange', 'pink', 'green', 'blue', 'violet'] as const;

/**
 * Sticky color key.
 *
 * @beta
 */
export type StickyColor = (typeof STICKY_COLORS)[number];

// TODO(BOARD-1006): replace with light/dark theme tokens.
/** @internal */
export const COLOR_VALUES: Readonly<Record<ColorKey, string>> = {
  black: '#1d1d1f',
  grey: '#8e8e93',
  white: '#ffffff',
  red: '#e03131',
  orange: '#f76707',
  yellow: '#f5c400',
  green: '#2f9e44',
  blue: '#1971c2',
  violet: '#7048e8',
};

// TODO(BOARD-1006, BOARD-1907): sticky palette from the theme, passing 4.5:1 text contrast.
/** @internal */
export const STICKY_COLOR_VALUES: Readonly<Record<StickyColor, string>> = {
  yellow: '#fff3a3',
  orange: '#ffd8a8',
  pink: '#ffc9de',
  green: '#c3f0c8',
  blue: '#c5e3ff',
  violet: '#e0d4ff',
};

/** @internal */
export const STICKY_COLOR_NAMES: Readonly<Record<StickyColor, Bilingual>> = {
  yellow: { id: 'kuning', en: 'Yellow' },
  orange: { id: 'oranye', en: 'Orange' },
  pink: { id: 'merah muda', en: 'Pink' },
  green: { id: 'hijau', en: 'Green' },
  blue: { id: 'biru', en: 'Blue' },
  violet: { id: 'ungu', en: 'Violet' },
};
