import { describe, expect, it, vi } from 'vitest';
import type { ElementCanvasContext } from '@kujam/core';
import type { RichText } from './model.js';
import {
  drawRichText,
  formatFont,
  layoutRichText,
  layoutStickyText,
} from './layout.js';

describe('Canvas rich text layout and renderer (BOARD-1003a, BOARD-1001)', () => {
  it('formatFont builds proper CSS font strings', () => {
    expect(formatFont(16, 'Inter', false, false)).toBe('16px Inter');
    expect(formatFont(16, 'Inter', true, false)).toBe('bold 16px Inter');
    expect(formatFont(16, 'Inter', false, true)).toBe('italic 16px Inter');
    expect(formatFont(16, 'Inter', true, true)).toBe('italic bold 16px Inter');
  });

  it('lays out simple single-line text', () => {
    const delta: RichText = [{ insert: 'Halo dunia\n' }];
    const layout = layoutRichText(delta, { fontSize: 16 });

    expect(layout.lines.length).toBe(1);
    expect(layout.lines[0]?.runs.length).toBe(1);
    expect(layout.lines[0]?.runs[0]?.text).toBe('Halo dunia');
    expect(layout.lines[0]?.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThanOrEqual(16);
  });

  it('wraps long lines when maxWidth is specified', () => {
    const delta: RichText = [
      { insert: 'Ini adalah kalimat yang sangat panjang sehingga harus dipotong menjadi beberapa baris visual.\n' },
    ];
    const unconstrained = layoutRichText(delta, { fontSize: 16 });
    expect(unconstrained.lines.length).toBe(1);

    const wrapped = layoutRichText(delta, { maxWidth: 150, fontSize: 16 });
    expect(wrapped.lines.length).toBeGreaterThan(1);
    for (const line of wrapped.lines) {
      expect(line.width).toBeLessThanOrEqual(160);
    }
  });

  it('preserves formatting across runs: bold, italic, link', () => {
    const delta: RichText = [
      { insert: 'Teks ' },
      { insert: 'tebal', attributes: { bold: true } },
      { insert: ' dan ' },
      { insert: 'miring', attributes: { italic: true } },
      { insert: ' serta ' },
      { insert: 'tautan', attributes: { link: 'https://kustora.id' } },
      { insert: '\n' },
    ];
    const layout = layoutRichText(delta, { fontSize: 16 });
    expect(layout.lines.length).toBe(1);
    const runs = layout.lines[0]?.runs;
    expect(runs?.length).toBe(6);
    expect(runs?.[1]?.bold).toBe(true);
    expect(runs?.[3]?.italic).toBe(true);
    expect(runs?.[5]?.link).toBe('https://kustora.id');
  });

  it('formats bullet and ordered lists with correct markers and indent offsets', () => {
    const delta: RichText = [
      { insert: 'Butir satu' },
      { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'Butir dua' },
      { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'Sub 1' },
      { insert: '\n', attributes: { list: 'ordered', indent: 2 } },
      { insert: 'Sub 2' },
      { insert: '\n', attributes: { list: 'ordered', indent: 2 } },
    ];
    const layout = layoutRichText(delta, { fontSize: 16, listIndentPx: 20 });
    expect(layout.lines.length).toBe(4);

    expect(layout.lines[0]?.marker?.text).toBe('•');
    expect(layout.lines[0]?.marker?.x).toBe(0);

    expect(layout.lines[1]?.marker?.text).toBe('•');
    expect(layout.lines[1]?.marker?.x).toBe(0);

    expect(layout.lines[2]?.marker?.text).toBe('1.');
    expect(layout.lines[2]?.marker?.x).toBe(20);

    expect(layout.lines[3]?.marker?.text).toBe('2.');
    expect(layout.lines[3]?.marker?.x).toBe(20);
  });

  it('aligns lines according to start, center, and end alignment', () => {
    const delta: RichText = [{ insert: 'Teks\n' }];
    const maxWidth = 200;

    const startLayout = layoutRichText(delta, { maxWidth, fontSize: 16, align: 'start' });
    expect(startLayout.lines[0]?.x).toBe(0);

    const centerLayout = layoutRichText(delta, { maxWidth, fontSize: 16, align: 'center' });
    expect(centerLayout.lines[0]?.x).toBeGreaterThan(0);
    expect(centerLayout.lines[0]?.x).toBeCloseTo((maxWidth - (centerLayout.lines[0]?.width ?? 0)) / 2, 0);

    const endLayout = layoutRichText(delta, { maxWidth, fontSize: 16, align: 'end' });
    expect(endLayout.lines[0]?.x).toBeGreaterThan(centerLayout.lines[0]?.x ?? 0);
  });

  describe('layoutStickyText auto-font scaling (BOARD-1001)', () => {
    it('uses base font size for short text that fits easily', () => {
      const delta: RichText = [{ insert: 'Catatan singkat\n' }];
      const layout = layoutStickyText(delta, {
        boxW: 192,
        boxH: 144,
        baseFontSize: 24,
        minFontSize: 12,
      });

      expect(layout.fontSize).toBe(24);
      expect(layout.truncated).toBeFalsy();
      expect(layout.height).toBeLessThanOrEqual(144 - 32);
    });

    it('shrinks font size when text would otherwise overflow', () => {
      const delta: RichText = [
        { insert: 'Ini adalah catatan tempel dengan isi beberapa baris kalimat yang cukup panjang sehingga ukuran font harus mengecil agar muat di dalam sticky note.\n' },
      ];
      const layout = layoutStickyText(delta, {
        boxW: 192,
        boxH: 144,
        baseFontSize: 24,
        minFontSize: 12,
      });

      expect(layout.fontSize).toBeLessThan(24);
      expect(layout.fontSize).toBeGreaterThanOrEqual(12);
      expect(layout.height).toBeLessThanOrEqual(144 - 32);
    });

    it('truncates with ellipsis when even minFontSize overflows the box', () => {
      const delta: RichText = [
        {
          insert:
            'Teks yang teramat sangat luar biasa panjang sekali berulang kali '.repeat(10) + '\n',
        },
      ];
      const layout = layoutStickyText(delta, {
        boxW: 192,
        boxH: 144,
        baseFontSize: 24,
        minFontSize: 12,
      });

      expect(layout.fontSize).toBe(12);
      expect(layout.truncated).toBe(true);
      expect(layout.height).toBeLessThanOrEqual(144);
      const lastLine = layout.lines[layout.lines.length - 1];
      const runs = lastLine?.runs ?? [];
      const lastText = runs[runs.length - 1]?.text ?? '';
      expect(lastText).toContain('…');
    });
  });

  describe('drawRichText canvas rendering', () => {
    it('invokes canvas fillText and fillRect for links', () => {
      const fillText = vi.fn();
      const fillRect = vi.fn();
      const save = vi.fn();
      const restore = vi.fn();

      const mockCtx: Partial<ElementCanvasContext> = {
        save,
        restore,
        fillText,
        fillRect,
        textBaseline: 'top',
        textAlign: 'left',
        fillStyle: '',
        font: '',
      };

      const delta: RichText = [
        { insert: 'Buka ' },
        { insert: 'kustora', attributes: { bold: true, link: 'https://kustora.id' } },
        { insert: '\n' },
      ];
      const layout = layoutRichText(delta, { fontSize: 16 });

      drawRichText(mockCtx as ElementCanvasContext, layout, {
        x: 10,
        y: 20,
        color: '#17191E',
        linkColor: '#2F6FDB',
      });

      expect(save).toHaveBeenCalledTimes(1);
      expect(restore).toHaveBeenCalledTimes(1);
      expect(fillText).toHaveBeenCalledWith('Buka ', expect.any(Number), expect.any(Number));
      expect(fillText).toHaveBeenCalledWith('kustora', expect.any(Number), expect.any(Number));
      expect(fillRect).toHaveBeenCalledTimes(1); // link underline
    });
  });
});
