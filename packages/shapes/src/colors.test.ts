import { describe, expect, it } from 'vitest';
import {
  COLOR_KEYS,
  COLOR_VALUES,
  STICKY_COLOR_NAMES,
  STICKY_COLOR_VALUES,
  STICKY_COLORS,
  STICKY_TEXT_COLOR,
  DEFAULT_LIGHT_THEME,
  DEFAULT_DARK_THEME,
} from './colors.js';

/**
 * Parses a 6-digit hex color into [r, g, b] in the range 0..1.
 */
function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}

/**
 * Computes WCAG 2.1 relative luminance from RGB components (0..1).
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
function relativeLuminance(r: number, g: number, b: number): number {
  const transform = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  const lr = transform(r);
  const lg = transform(g);
  const lb = transform(b);

  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * Computes the WCAG 2.1 contrast ratio between two hex colors.
 * Always returns a ratio >= 1.0 (e.g. 4.5 for 4.5:1).
 */
function contrastRatio(hex1: string, hex2: string): number {
  const [r1, g1, b1] = parseHex(hex1);
  const [r2, g2, b2] = parseHex(hex2);

  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

describe('BOARD-1006: Theme and Color Tokens (DESIGN.md)', () => {
  it('defines the 6 official sticky colors per DESIGN.md', () => {
    expect(STICKY_COLORS).toEqual(['yellow', 'green', 'pink', 'blue', 'purple', 'gray']);
  });

  it('matches exact hex values from DESIGN.md', () => {
    expect(STICKY_COLOR_VALUES.yellow).toBe('#FBE7A1');
    expect(STICKY_COLOR_VALUES.green).toBe('#CDE6D5');
    expect(STICKY_COLOR_VALUES.pink).toBe('#F6D2C6');
    expect(STICKY_COLOR_VALUES.blue).toBe('#D7E2F5');
    expect(STICKY_COLOR_VALUES.purple).toBe('#E3DDEE');
    expect(STICKY_COLOR_VALUES.gray).toBe('#ECEAE3');
    expect(STICKY_TEXT_COLOR).toBe('#17191E');
  });

  it('provides bilingual Indonesian and English names for all sticky colors', () => {
    for (const color of STICKY_COLORS) {
      const names = STICKY_COLOR_NAMES[color];
      expect(names.id).toBeDefined();
      expect(names.en).toBeDefined();
    }
    expect(STICKY_COLOR_NAMES.purple).toEqual({ id: 'ungu', en: 'Purple' });
    expect(STICKY_COLOR_NAMES.gray).toEqual({ id: 'abu-abu', en: 'Gray' });
  });

  it('stroke and shape color keys contain purple and standard palette', () => {
    expect(COLOR_KEYS).toContain('purple');
    expect(COLOR_KEYS).toContain('violet');
    expect(COLOR_VALUES.black).toBe('#17191E');
    expect(COLOR_VALUES.red).toBe('#D9381E');
    expect(COLOR_VALUES.blue).toBe('#2F6FDB');
  });
});

describe('BOARD-1907: Automated WCAG Text Contrast Audit', () => {
  it('all 6 sticky colors pass the 4.5:1 WCAG AA text contrast requirement in light theme', () => {
    for (const color of STICKY_COLORS) {
      const bgHex = DEFAULT_LIGHT_THEME.sticky[color];
      const textHex = DEFAULT_LIGHT_THEME.stickyText;
      const ratio = contrastRatio(bgHex, textHex);

      // DESIGN.md states contrast is above 12:1
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(12);
    }
  });

  it('all 6 sticky colors pass the 4.5:1 WCAG AA text contrast requirement in dark theme', () => {
    for (const color of STICKY_COLORS) {
      const bgHex = DEFAULT_DARK_THEME.sticky[color];
      const textHex = DEFAULT_DARK_THEME.stickyText;
      const ratio = contrastRatio(bgHex, textHex);

      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(12);
    }
  });

  it('ink text achieves > 12:1 contrast against light canvas and light surface', () => {
    const ink = DEFAULT_LIGHT_THEME.colors.black; // #17191E
    const canvas = DEFAULT_LIGHT_THEME.canvas.background; // #F4F3EF
    const surface = DEFAULT_LIGHT_THEME.colors.white; // #FFFFFF

    expect(contrastRatio(canvas, ink)).toBeGreaterThan(12);
    expect(contrastRatio(surface, ink)).toBeGreaterThan(12);
  });
});
