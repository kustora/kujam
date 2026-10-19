/**
 * UI theme as CSS custom properties (BOARD-1401).
 *
 * Every component styles itself only through `--kujam-ui-*` properties, set with `:host` for light
 * and dark mode from the DESIGN.md tokens. Page styles that target the element itself win over
 * `:host` rules, so apps restyle the UI with, for example,
 * `kujam-toolbar { --kujam-ui-surface: #fafafa; }`. Setting the properties on an ancestor has no
 * effect, because the host sets its own values.
 */

/** Light and dark token values, in DESIGN.md order. */
const TOKENS = {
  light: {
    surface: '#FFFFFF',
    'surface-hover': '#ECEAE3',
    'surface-inverse': '#17191E',
    'on-inverse': '#F2F1EC',
    ink: '#17191E',
    'ink-muted': '#4A4F59',
    'ink-disabled': '#8A8F99',
    border: '#E3E1DA',
    'border-strong': '#D5D2C9',
    'focus-ring': '#2F6FDB',
    'shadow-float': '0 8px 16px rgba(23, 25, 30, 0.12)',
    'shadow-pop': '0 12px 24px rgba(23, 25, 30, 0.18)',
  },
  dark: {
    surface: '#1A1C21',
    'surface-hover': '#2A2D34',
    'surface-inverse': '#F2F1EC',
    'on-inverse': '#17191E',
    ink: '#F2F1EC',
    'ink-muted': '#B4B8C0',
    'ink-disabled': '#5E636D',
    border: '#2E3138',
    'border-strong': '#3D414A',
    'focus-ring': '#6EA0F0',
    'shadow-float': '0 8px 16px rgba(0, 0, 0, 0.5)',
    'shadow-pop': '0 12px 24px rgba(0, 0, 0, 0.6)',
  },
} as const;

/**
 * Name of a theme token; the CSS property is `--kujam-ui-<name>`.
 *
 * @public
 */
export type UiTokenName = keyof (typeof TOKENS)['light'];

function declarations(mode: keyof typeof TOKENS): string {
  return Object.entries(TOKENS[mode])
    .map(([name, value]) => `--kujam-ui-${name}: ${value};`)
    .join('\n    ');
}

/**
 * Shared stylesheet text for every UI component: tokens per theme, the focus ring, and reduced
 * motion.
 *
 * @internal
 */
export const BASE_CSS = `
  :host {
    ${declarations('light')}
    --kujam-ui-radius-md: 8px;
    --kujam-ui-radius-lg: 12px;
    --kujam-ui-radius-xl: 16px;
    --kujam-ui-font: 500 12px/16px Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
    --kujam-ui-motion: 120ms ease-out;
    color: var(--kujam-ui-ink);
    font: var(--kujam-ui-font);
    -webkit-font-smoothing: antialiased;
  }
  :host([data-theme='dark']) {
    ${declarations('dark')}
  }
  :host([hidden]) {
    display: none !important;
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  button {
    font: inherit;
    color: inherit;
  }
  :focus {
    outline: none;
  }
  :focus-visible {
    outline: 2px solid var(--kujam-ui-focus-ring);
    outline-offset: 2px;
  }
  :host([data-reduced-motion='true']),
  :host-context([data-reduced-motion='true']) {
    --kujam-ui-motion: 0s;
  }
  @media (prefers-reduced-motion: reduce) {
    :host(:not([data-reduced-motion='false'])) {
      --kujam-ui-motion: 0s;
    }
  }
`;

/**
 * Value of a theme token for a mode, for code that draws outside the components.
 *
 * @public
 */
export function uiToken(mode: 'light' | 'dark', name: UiTokenName): string {
  return TOKENS[mode][name];
}
