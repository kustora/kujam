import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  STICKY_COLORS,
  COLOR_KEYS,
  type ThemeDefinition,
} from '../index.js';

describe('Theme system (BOARD-1006)', () => {
  it('default light and dark themes have all required tokens per DESIGN.md', () => {
    for (const theme of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      expect(theme.canvas.background).toBeDefined();
      expect(theme.canvas.gridDot).toBeDefined();
      expect(theme.canvas.gridSpacing).toBe(24);
      expect(theme.selection.stroke).toBe('#2F6FDB');
      expect(theme.selection.lineWidth).toBe(2);
      expect(theme.typography.fontFamily).toContain('Plus Jakarta Sans');
      expect(theme.stickyText).toBe('#17191E');
      expect(theme.collab.length).toBe(5);

      for (const color of STICKY_COLORS) {
        expect(theme.sticky[color]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
      for (const key of COLOR_KEYS) {
        expect(theme.colors[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }

    // Specific tokens
    expect(DEFAULT_LIGHT_THEME.canvas.background).toBe('#F4F3EF');
    expect(DEFAULT_LIGHT_THEME.canvas.gridDot).toBe('#CFCBC1');
    expect(DEFAULT_DARK_THEME.canvas.background).toBe('#121317');
    expect(DEFAULT_DARK_THEME.canvas.gridDot).toBe('#353943');

    // Sticky colors are identical in both light and dark modes per DESIGN.md
    for (const color of STICKY_COLORS) {
      expect(DEFAULT_LIGHT_THEME.sticky[color]).toBe(DEFAULT_DARK_THEME.sticky[color]);
    }
  });

  it('createTheme creates a customized theme with overrides', () => {
    const custom = createTheme('light', {
      id: 'custom-accent',
      canvas: { background: '#FAF9F5' },
      selection: { stroke: '#FF0000', lineWidth: 3 },
    });

    expect(custom.id).toBe('custom-accent');
    expect(custom.canvas.background).toBe('#FAF9F5');
    expect(custom.canvas.gridSpacing).toBe(24); // Inherited
    expect(custom.selection.stroke).toBe('#FF0000');
    expect(custom.selection.lineWidth).toBe(3);
    expect(custom.sticky.yellow).toBe(DEFAULT_LIGHT_THEME.sticky.yellow); // Inherited
  });

  it('createBoard defaults to light theme and allows dark or custom theme via options', () => {
    const defaultBoard = createBoard();
    expect(defaultBoard.theme.mode).toBe('light');
    expect(defaultBoard.elementContext.theme.mode).toBe('light');
    defaultBoard.dispose();

    const darkBoard = createBoard({ theme: 'dark' });
    expect(darkBoard.theme.mode).toBe('dark');
    expect(darkBoard.elementContext.theme.mode).toBe('dark');
    expect(darkBoard.theme.canvas.background).toBe('#121317');
    darkBoard.dispose();

    const customTheme: ThemeDefinition = createTheme('light', { id: 'test-custom' });
    const customBoard = createBoard({ theme: customTheme });
    expect(customBoard.theme.id).toBe('test-custom');
    expect(customBoard.elementContext.theme.id).toBe('test-custom');
    customBoard.dispose();
  });

  it('board.setTheme switches the theme dynamically and emits "theme" event', () => {
    const board = createBoard({ theme: 'light' });
    const events: ThemeDefinition[] = [];
    board.on('theme', (t) => events.push(t));

    expect(board.theme.mode).toBe('light');
    expect(board.elementContext.theme.mode).toBe('light');

    board.setTheme('dark');
    expect(board.theme.mode).toBe('dark');
    expect(board.elementContext.theme.mode).toBe('dark');
    expect(events.length).toBe(1);
    expect(events[0]?.mode).toBe('dark');

    // Setting same theme does not re-emit
    board.setTheme('dark');
    expect(events.length).toBe(1);

    const custom = createTheme('dark', { id: 'special' });
    board.setTheme(custom);
    expect(board.theme.id).toBe('special');
    expect(events.length).toBe(2);

    board.dispose();
  });
});
