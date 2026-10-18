/**
 * Theme definition, color tokens, and built-in light/dark themes (BOARD-1006).
 * Aligned with the official Tayang design system (DESIGN.md).
 */

/**
 * Built-in sticky color keys (BOARD-1006, DESIGN.md).
 *
 * @beta
 */
export const STICKY_COLORS = ['yellow', 'green', 'pink', 'blue', 'purple', 'gray'] as const;

/**
 * Sticky color key.
 *
 * @beta
 */
export type StickyColor = (typeof STICKY_COLORS)[number];

/**
 * Color keys for strokes, text, and geometric shapes (BOARD-1006).
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
  'purple',
] as const;

/**
 * Color key for strokes, text, and shapes.
 *
 * @beta
 */
export type ColorKey = (typeof COLOR_KEYS)[number];

/**
 * Theme mode: light or dark.
 *
 * @public
 */
export type ThemeMode = 'light' | 'dark';

/**
 * Canvas background and grid tokens.
 *
 * @public
 */
export interface ThemeCanvasTokens {
  /** Canvas background color. */
  readonly background: string;
  /** Grid dot color. */
  readonly gridDot: string;
  /** Grid dot spacing in board units (default 24px, DESIGN.md jam-grid). */
  readonly gridSpacing: number;
}

/**
 * Selection and interaction overlay tokens.
 *
 * @public
 */
export interface ThemeSelectionTokens {
  /** Selection box outline and handle border color. */
  readonly stroke: string;
  /** Selection outline width in screen pixels (default 2px). */
  readonly lineWidth: number;
  /** Area selection marquee fill color. */
  readonly brushFill: string;
  /** Area selection marquee stroke color. */
  readonly brushStroke: string;
  /** Hover outline color. */
  readonly hoverStroke: string;
  /**
   * Keyboard focus ring color (DESIGN.md `focus-ring`): a 2px ring 2px outside the focused element
   * (BOARD-1902, BOARD-1904). Falls back to `stroke` when omitted.
   *
   * @beta
   */
  readonly focusRing?: string;
}

/**
 * Typography tokens.
 *
 * @public
 */
export interface ThemeTypographyTokens {
  /** Default font family stack. */
  readonly fontFamily: string;
}

/**
 * Complete theme definition for the whiteboard canvas (BOARD-1006).
 *
 * @public
 */
export interface ThemeDefinition {
  /** Unique theme identifier. */
  readonly id: string;
  /** Color scheme mode. */
  readonly mode: ThemeMode;
  /** Canvas background and grid settings. */
  readonly canvas: ThemeCanvasTokens;
  /** Selection frame and handle settings. */
  readonly selection: ThemeSelectionTokens;
  /** Typography settings. */
  readonly typography: ThemeTypographyTokens;
  /** Sticky note background colors mapped by StickyColor key. */
  readonly sticky: Readonly<Record<StickyColor, string>>;
  /** Text color on sticky notes (constant in both light and dark modes per DESIGN.md). */
  readonly stickyText: string;
  /** Stroke, shape, and text colors mapped by ColorKey. */
  readonly colors: Readonly<Record<ColorKey, string>>;
  /** Presence cursor colors for collaborative peers (collab-1 to collab-5). */
  readonly collab: readonly string[];
}

/**
 * Default light theme (BOARD-1006, DESIGN.md).
 *
 * @public
 */
export const DEFAULT_LIGHT_THEME: Readonly<ThemeDefinition> = Object.freeze({
  id: 'light',
  mode: 'light',
  canvas: Object.freeze({
    background: '#F4F3EF',
    gridDot: '#CFCBC1',
    gridSpacing: 24,
  }),
  selection: Object.freeze({
    stroke: '#2F6FDB',
    lineWidth: 2,
    brushFill: 'rgba(47, 111, 219, 0.08)',
    brushStroke: 'rgba(47, 111, 219, 0.8)',
    hoverStroke: 'rgba(47, 111, 219, 0.5)',
    focusRing: '#2F6FDB',
  }),
  typography: Object.freeze({
    fontFamily: 'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif',
  }),
  sticky: Object.freeze({
    yellow: '#FBE7A1',
    green: '#CDE6D5',
    pink: '#F6D2C6',
    blue: '#D7E2F5',
    purple: '#E3DDEE',
    gray: '#ECEAE3',
  }),
  stickyText: '#17191E',
  colors: Object.freeze({
    black: '#17191E',
    grey: '#8F8B82',
    white: '#FFFFFF',
    red: '#D9381E',
    orange: '#C2410C',
    yellow: '#FBE7A1',
    green: '#16754C',
    blue: '#2F6FDB',
    violet: '#6B4FA0',
    purple: '#6B4FA0',
  }),
  collab: Object.freeze(['#2F6FDB', '#6B4FA0', '#16754C', '#C2410C', '#9B3D7F']),
});

/**
 * Default dark theme (BOARD-1006, DESIGN.md).
 *
 * @public
 */
export const DEFAULT_DARK_THEME: Readonly<ThemeDefinition> = Object.freeze({
  id: 'dark',
  mode: 'dark',
  canvas: Object.freeze({
    background: '#121317',
    gridDot: '#353943',
    gridSpacing: 24,
  }),
  selection: Object.freeze({
    stroke: '#2F6FDB',
    lineWidth: 2,
    brushFill: 'rgba(47, 111, 219, 0.12)',
    brushStroke: 'rgba(47, 111, 219, 0.8)',
    hoverStroke: 'rgba(47, 111, 219, 0.5)',
    focusRing: '#6EA0F0',
  }),
  typography: Object.freeze({
    fontFamily: 'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif',
  }),
  sticky: Object.freeze({
    yellow: '#FBE7A1',
    green: '#CDE6D5',
    pink: '#F6D2C6',
    blue: '#D7E2F5',
    purple: '#E3DDEE',
    gray: '#ECEAE3',
  }),
  stickyText: '#17191E',
  colors: Object.freeze({
    black: '#F2F1EC',
    grey: '#757A84',
    white: '#1A1C21',
    red: '#D9381E',
    orange: '#C2410C',
    yellow: '#F5C66B',
    green: '#7FD3A6',
    blue: '#6EA0F0',
    violet: '#6B4FA0',
    purple: '#6B4FA0',
  }),
  collab: Object.freeze(['#2F6FDB', '#6B4FA0', '#16754C', '#C2410C', '#9B3D7F']),
});

/**
 * Overrides for creating a custom theme (BOARD-1006).
 *
 * @public
 */
export interface CustomThemeOverrides {
  readonly id?: string;
  readonly mode?: ThemeMode;
  readonly canvas?: Partial<ThemeCanvasTokens>;
  readonly selection?: Partial<ThemeSelectionTokens>;
  readonly typography?: Partial<ThemeTypographyTokens>;
  readonly sticky?: Partial<Record<StickyColor, string>>;
  readonly stickyText?: string;
  readonly colors?: Partial<Record<ColorKey, string>>;
  readonly collab?: readonly string[];
}

/**
 * Creates or customizes a theme definition (BOARD-1006).
 *
 * @param base - Base theme mode ('light' | 'dark') or existing ThemeDefinition.
 * @param overrides - Optional overrides for custom tokens.
 *
 * @public
 */
export function createTheme(
  base: ThemeMode | ThemeDefinition = 'light',
  overrides?: CustomThemeOverrides,
): Readonly<ThemeDefinition> {
  const baseTheme =
    typeof base === 'string'
      ? base === 'dark'
        ? DEFAULT_DARK_THEME
        : DEFAULT_LIGHT_THEME
      : base;

  if (!overrides) return baseTheme;

  return Object.freeze({
    id: overrides.id ?? (typeof base === 'string' ? `custom-${base}` : `${baseTheme.id}-custom`),
    mode: overrides.mode ?? baseTheme.mode,
    canvas: Object.freeze({
      ...baseTheme.canvas,
      ...overrides.canvas,
    }),
    selection: Object.freeze({
      ...baseTheme.selection,
      ...overrides.selection,
    }),
    typography: Object.freeze({
      ...baseTheme.typography,
      ...overrides.typography,
    }),
    sticky: Object.freeze({
      ...baseTheme.sticky,
      ...overrides.sticky,
    }),
    stickyText: overrides.stickyText ?? baseTheme.stickyText,
    colors: Object.freeze({
      ...baseTheme.colors,
      ...overrides.colors,
    }),
    collab: Object.freeze(overrides.collab ?? baseTheme.collab),
  });
}

/**
 * Resolves a theme input into a concrete {@link ThemeDefinition}.
 *
 * @internal
 */
export function resolveTheme(input?: ThemeMode | ThemeDefinition): Readonly<ThemeDefinition> {
  if (!input) return DEFAULT_LIGHT_THEME;
  if (typeof input === 'string') {
    return input === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
  }
  return input;
}
