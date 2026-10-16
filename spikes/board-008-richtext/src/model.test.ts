import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MAX_RICH_TEXT_LENGTH,
  normalizeRichText,
  richTextToPlainText,
  sanitizeLink,
  validateRichText,
  type RichText,
} from './model.ts';

const samples: Record<string, RichText> = {
  kosong: [{ insert: '\n' }],
  polos: [{ insert: 'Halo dunia\n' }],
  tebalDiTengah: [
    { insert: 'Ini ' },
    { insert: 'penting', attributes: { bold: true } },
    { insert: ' sekali\n' },
  ],
  tebalMiringTautan: [
    { insert: 'baca ' },
    { insert: 'dokumen', attributes: { bold: true, italic: true, link: 'https://kustora.id/doc' } },
    { insert: '\n' },
  ],
  daftar: [
    { insert: 'Rencana\nide satu' },
    { insert: '\n', attributes: { list: 'bullet' } },
    { insert: 'ide dua' },
    { insert: '\n', attributes: { list: 'bullet' } },
    { insert: 'sub' },
    { insert: '\n', attributes: { list: 'ordered', indent: 1 } },
    { insert: 'penutup\n' },
  ],
  baris_kosong_berurutan: [{ insert: 'a\n\n\nb\n' }],
  emojiDanCJK: [
    { insert: '👩‍💻 日本語のテキスト 한국어 ' },
    { insert: '中文', attributes: { italic: true } },
    { insert: '\n' },
  ],
};

function toYText(delta: RichText): Y.Text {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  text.applyDelta(delta);
  return text;
}

describe('format delta kompatibel Y.Text (BOARD-008)', () => {
  for (const [name, delta] of Object.entries(samples)) {
    it(`${name}: kanonik, valid, dan round-trip Y.Text identik`, () => {
      expect(normalizeRichText(delta)).toEqual(delta);
      expect(validateRichText(delta).ok).toBe(true);
      expect(toYText(delta).toDelta()).toEqual(delta);
    });
  }

  it('edit bersamaan dua klien konvergen dan tetap valid setelah normalisasi', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText('t').applyDelta(samples.daftar!);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // A menebalkan rentang yang melintasi baris (termasuk `\n`), B mengetik dan mengubah daftar.
    a.getText('t').format(2, 15, { bold: true });
    b.getText('t').insert(10, 'XYZ', { italic: true });
    b.getText('t').format(b.getText('t').toString().indexOf('\n', 12), 1, { list: 'ordered' });

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const da = a.getText('t').toDelta();
    expect(b.getText('t').toDelta()).toEqual(da);

    const normalized = normalizeRichText(da);
    expect(validateRichText(normalized).ok).toBe(true);
    // Tebal yang menempel di `\n` dibuang, teksnya utuh.
    expect(normalized.map((op) => op.insert).join('')).toBe(a.getText('t').toString());
    expect(normalized.some((op) => op.insert.includes('\n') && op.attributes?.bold)).toBe(false);
  });
});

describe('normalisasi dan keamanan (BOARD-008)', () => {
  it('menambah \\n penutup dan menggabung op beratribut sama', () => {
    expect(normalizeRichText([])).toEqual([{ insert: '\n' }]);
    expect(normalizeRichText([{ insert: 'a' }, { insert: 'b', attributes: {} }])).toEqual([
      { insert: 'ab\n' },
    ]);
    expect(normalizeRichText([{ insert: 'x', attributes: { bold: true } }])).toEqual([
      { insert: 'x', attributes: { bold: true } },
      { insert: '\n' },
    ]);
  });

  it('memisahkan atribut inline dan blok', () => {
    expect(
      normalizeRichText([{ insert: 'a\nb', attributes: { bold: true, list: 'bullet' } }]),
    ).toEqual([
      { insert: 'a', attributes: { bold: true } },
      { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'b', attributes: { bold: true } },
      { insert: '\n' },
    ]);
  });

  it('membuang atribut asing, embed, dan karakter kontrol; CRLF menjadi LF', () => {
    expect(
      normalizeRichText([
        { insert: 'a\r\nb\u0000c', attributes: { color: 'red', font: 'x', bold: 'yes' } },
        { insert: { image: 'https://x/y.png' } },
        null,
        'teks lepas',
      ]),
    ).toEqual([{ insert: 'a\nbc\n' }]);
  });

  it('tautan hanya http, https, dan mailto', () => {
    expect(sanitizeLink('https://a.b')).toBe('https://a.b');
    expect(sanitizeLink(' mailto:x@y.z ')).toBe('mailto:x@y.z');
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\u0000script:x',
      'data:text/html,x',
      'vbscript:x',
      '/relatif',
      '',
    ]) {
      expect(sanitizeLink(bad)).toBeUndefined();
    }
    expect(
      normalizeRichText([{ insert: 'klik', attributes: { link: 'javascript:alert(1)' } }]),
    ).toEqual([{ insert: 'klik\n' }]);
  });

  it('teks berisi HTML tetap teks biasa', () => {
    const html = '<script>alert(1)</script><img src=x onerror=alert(1)>&amp;';
    expect(normalizeRichText([{ insert: html }])).toEqual([{ insert: `${html}\n` }]);
    expect(richTextToPlainText(normalizeRichText([{ insert: html }]))).toBe(html);
  });

  it('memotong teks di batas panjang dan tetap diakhiri \\n', () => {
    const result = normalizeRichText([{ insert: 'a'.repeat(MAX_RICH_TEXT_LENGTH + 500) }]);
    const total = result.reduce((n, op) => n + op.insert.length, 0);
    expect(total).toBe(MAX_RICH_TEXT_LENGTH);
    expect(result.at(-1)!.insert.endsWith('\n')).toBe(true);
  });

  it('validasi struktural menolak data peer yang rusak', () => {
    expect(validateRichText([{ insert: '' }]).ok).toBe(false);
    expect(validateRichText([{ insert: 'a', attributes: { bold: false } }]).ok).toBe(false);
    expect(validateRichText([{ insert: 'a', attributes: { list: 'checked' } }]).ok).toBe(false);
    expect(validateRichText([{ insert: 'a', attributes: { script: 'x' } }]).ok).toBe(false);
    expect(validateRichText('<p>html</p>').ok).toBe(false);
  });
});

describe('teks polos', () => {
  it('menandai daftar berurutan dan bersarang', () => {
    expect(richTextToPlainText(samples.daftar!)).toBe(
      'Rencana\n- ide satu\n- ide dua\n  1. sub\npenutup',
    );
    expect(richTextToPlainText(samples.kosong!)).toBe('');
  });
});
