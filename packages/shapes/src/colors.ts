/**
 * Built-in element color keys and theme tokens (BOARD-1006). Documents store keys, not hex,
 * so the theme can be swapped. Values follow the default kujam palette.
 */

import {
  COLOR_KEYS,
  createTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  STICKY_COLORS,
  type ColorKey,
  type CustomThemeOverrides,
  type StickyColor,
  type ThemeCanvasTokens,
  type ThemeDefinition,
  type ThemeMode,
  type ThemeSelectionTokens,
  type ThemeTypographyTokens,
} from '@kujam/core';
import type { Bilingual } from './i18n.js';

export {
  COLOR_KEYS,
  createTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  STICKY_COLORS,
  type ColorKey,
  type CustomThemeOverrides,
  type StickyColor,
  type ThemeCanvasTokens,
  type ThemeDefinition,
  type ThemeMode,
  type ThemeSelectionTokens,
  type ThemeTypographyTokens,
};

/**
 * Text color for sticky notes (sticky ink, #17191E).
 * Contrast ratio exceeds 12:1 against all 6 sticky pastel colors (BOARD-1907).
 *
 * @beta
 */
export const STICKY_TEXT_COLOR = '#17191E';

/**
 * Default color palette values for strokes, text, and geometric shapes.
 * Matches the default light theme values.
 *
 * @internal
 */
export const COLOR_VALUES: Readonly<Record<ColorKey, string>> = DEFAULT_LIGHT_THEME.colors;

/**
 * The six built-in sticky colors:
 * yellow, green, pink, blue, purple, gray.
 *
 * @internal
 */
export const STICKY_COLOR_VALUES: Readonly<Record<StickyColor, string>> = DEFAULT_LIGHT_THEME.sticky;

/**
 * Bilingual names for the six sticky colors (BOARD-1006).
 *
 * @internal
 */
export const STICKY_COLOR_NAMES: Readonly<Record<StickyColor, Bilingual>> = Object.freeze({
  yellow: { id: 'kuning', en: 'Yellow' },
  green: { id: 'hijau', en: 'Green' },
  pink: { id: 'merah muda', en: 'Pink' },
  blue: { id: 'biru', en: 'Blue' },
  purple: { id: 'ungu', en: 'Purple' },
  gray: { id: 'abu-abu', en: 'Gray' },
});
