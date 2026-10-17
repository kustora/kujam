import { describe, expect, it } from 'vitest';
import {
  EMPTY_RICH_TEXT,
  isRichTextEmpty,
  MAX_RICH_TEXT_LENGTH,
  normalizeRichText,
  richTextToPlainText,
  sanitizeLink,
  validateRichText,
  type RichText,
} from './model.js';

const canonicalSamples: Record<string, RichText> = {
  empty: [{ insert: '\n' }],
  plain: [{ insert: 'Halo dunia\n' }],
  boldInMiddle: [
    { insert: 'Ini ' },
    { insert: 'penting', attributes: { bold: true } },
    { insert: ' sekali\n' },
  ],
  boldItalicLink: [
    { insert: 'baca ' },
    { insert: 'dokumen', attributes: { bold: true, italic: true, link: 'https://kustora.id/doc' } },
    { insert: '\n' },
  ],
  lists: [
    { insert: 'Rencana\nide satu' },
    { insert: '\n', attributes: { list: 'bullet' } },
    { insert: 'ide dua' },
    { insert: '\n', attributes: { list: 'bullet' } },
    { insert: 'sub' },
    { insert: '\n', attributes: { list: 'ordered', indent: 1 } },
    { insert: 'penutup\n' },
  ],
  consecutiveNewlines: [{ insert: 'a\n\n\nb\n' }],
  emojiAndCJK: [
    { insert: '👩‍💻 日本語のテキスト 한국어 ' },
    { insert: '中文', attributes: { italic: true } },
    { insert: '\n' },
  ],
};

describe('RichText model and normalization (BOARD-1003a, ADR-008)', () => {
  for (const [name, delta] of Object.entries(canonicalSamples)) {
    it(`canonical sample '${name}' passes validation and normalizeRichText is idempotent`, () => {
      expect(validateRichText(delta).ok).toBe(true);
      expect(normalizeRichText(delta)).toEqual(delta);
    });
  }

  it('guarantees document ends with newline', () => {
    const raw = [{ insert: 'Tanpa baris baru' }];
    const normalized = normalizeRichText(raw);
    expect(normalized).toEqual([{ insert: 'Tanpa baris baru\n' }]);
  });

  it('converts CRLF and CR to LF and strips non-tab control characters', () => {
    const raw = [{ insert: 'Baris 1\r\nBaris 2\rBaris 3\x00\x07\t' }];
    const normalized = normalizeRichText(raw);
    expect(normalized).toEqual([{ insert: 'Baris 1\nBaris 2\nBaris 3\t\n' }]);
  });

  it('separates inline attributes from block attributes across newlines', () => {
    // If a raw input puts bold on a newline or list on text, normalization must fix it
    const raw = [
      { insert: 'Poin 1\n', attributes: { bold: true, list: 'bullet' } },
      { insert: 'Poin 2\n', attributes: { italic: true, list: 'ordered', indent: 2 } },
    ];
    const normalized = normalizeRichText(raw);
    expect(normalized).toEqual([
      { insert: 'Poin 1', attributes: { bold: true } },
      { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'Poin 2', attributes: { italic: true } },
      { insert: '\n', attributes: { list: 'ordered', indent: 2 } },
    ]);
  });

  it('merges adjacent ops with identical attributes', () => {
    const raw = [
      { insert: 'Halo ' },
      { insert: 'semua ' },
      { insert: 'orang', attributes: { bold: true } },
      { insert: ' di sini', attributes: { bold: true } },
      { insert: '\n' },
    ];
    const normalized = normalizeRichText(raw);
    expect(normalized).toEqual([
      { insert: 'Halo semua ' },
      { insert: 'orang di sini', attributes: { bold: true } },
      { insert: '\n' },
    ]);
  });

  it('strips non-string inserts (embeds) and unsupported attributes', () => {
    const raw = [
      { insert: { image: 'test.png' } },
      { insert: 'Teks aman', attributes: { bold: true, customStyle: 'color:red', strike: true } },
      { insert: '\n' },
    ];
    const normalized = normalizeRichText(raw);
    expect(normalized).toEqual([
      { insert: 'Teks aman', attributes: { bold: true } },
      { insert: '\n' },
    ]);
  });

  it('clamps indent to MAX_LIST_INDENT and ignores non-positive indent', () => {
    const raw = [
      { insert: 'L1\n', attributes: { list: 'bullet', indent: 99 } },
      { insert: 'L2\n', attributes: { list: 'bullet', indent: 0 } },
    ];
    const normalized = normalizeRichText(raw);
    expect(normalized[1]?.attributes?.indent).toBe(3);
    expect(normalized[3]?.attributes?.indent).toBeUndefined();
  });

  it('enforces MAX_RICH_TEXT_LENGTH limit', () => {
    const longString = 'a'.repeat(MAX_RICH_TEXT_LENGTH + 100);
    const normalized = normalizeRichText([{ insert: longString }]);
    const totalChars = normalized.reduce((acc, op) => acc + op.insert.length, 0);
    expect(totalChars).toBeLessThanOrEqual(MAX_RICH_TEXT_LENGTH);
    expect(normalized[normalized.length - 1]?.insert.endsWith('\n')).toBe(true);
  });

  describe('sanitizeLink', () => {
    it('accepts safe schemes: http, https, mailto', () => {
      expect(sanitizeLink('https://kustora.id')).toBe('https://kustora.id');
      expect(sanitizeLink('http://localhost:3000')).toBe('http://localhost:3000');
      expect(sanitizeLink('mailto:halo@kustora.id')).toBe('mailto:halo@kustora.id');
    });

    it('rejects unsafe schemes and malicious URLs', () => {
      expect(sanitizeLink('javascript:alert(1)')).toBeUndefined();
      expect(sanitizeLink('data:text/html,<script>alert(1)</script>')).toBeUndefined();
      expect(sanitizeLink('vbscript:msgbox(1)')).toBeUndefined();
      expect(sanitizeLink('file:///etc/passwd')).toBeUndefined();
      expect(sanitizeLink('https://kustora.id/\x00evil')).toBeUndefined();
      expect(sanitizeLink('not-a-link')).toBeUndefined();
    });
  });

  describe('richTextToPlainText', () => {
    it('converts rich text to plain text with bullet and numbered markers', () => {
      const delta: RichText = [
        { insert: 'Judul\n' },
        { insert: 'Poin satu' },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'Poin dua' },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'Subpoin A' },
        { insert: '\n', attributes: { list: 'ordered', indent: 2 } },
      ];
      const plain = richTextToPlainText(delta);
      expect(plain).toBe('Judul\n- Poin satu\n- Poin dua\n  1. Subpoin A');
    });
  });

  describe('isRichTextEmpty', () => {
    it('returns true for EMPTY_RICH_TEXT and whitespace-only deltas', () => {
      expect(isRichTextEmpty(EMPTY_RICH_TEXT)).toBe(true);
      expect(isRichTextEmpty([{ insert: '\n' }])).toBe(true);
      expect(isRichTextEmpty([{ insert: '   \n\t  \n' }])).toBe(true);
    });

    it('returns false when visible text exists', () => {
      expect(isRichTextEmpty([{ insert: 'Halo\n' }])).toBe(false);
      expect(isRichTextEmpty([{ insert: 'a', attributes: { bold: true } }, { insert: '\n' }])).toBe(false);
    });
  });
});
