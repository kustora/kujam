/**
 * BOARD-008 — prototipe model rich text untuk sticky dan teks (kandidat untuk BOARD-1003a).
 *
 * Format: delta datar, sama dengan delta `Y.Text` dan Quill.
 * - Teks berformat adalah op `{ insert, attributes? }` dengan atribut inline (`bold`, `italic`, `link`).
 * - Atribut blok (`list`, `indent`) menempel pada karakter `\n` yang menutup baris tersebut.
 * - Dokumen selalu diakhiri `\n`. Dokumen kosong adalah `[{ insert: '\n' }]`.
 * - Bentuk kanonik: op bersebelahan dengan atribut sama digabung (seperti keluaran `Y.Text.toDelta()`).
 */
import {
  array,
  enumOf,
  literal,
  number,
  object,
  optional,
  string,
  validate,
  type Infer,
  type SchemaResult,
} from '../../../packages/core/src/schema.ts';

export const MAX_RICH_TEXT_LENGTH = 20_000;
export const MAX_LINK_LENGTH = 2048;
export const MAX_INDENT = 3;

/** Skema struktural untuk data dari peer atau server (ADR-007). Normalisasi dilakukan terpisah. */
export const richTextSchema = array(
  object({
    insert: string({ minLength: 1, maxLength: MAX_RICH_TEXT_LENGTH }),
    attributes: optional(
      object({
        bold: optional(literal(true)),
        italic: optional(literal(true)),
        link: optional(string({ maxLength: MAX_LINK_LENGTH })),
        list: optional(enumOf(['bullet', 'ordered'])),
        indent: optional(number({ int: true, min: 1, max: MAX_INDENT })),
      }),
    ),
  }),
  { maxLength: MAX_RICH_TEXT_LENGTH },
);

export type RichText = Infer<typeof richTextSchema>;
export type RichTextOp = RichText[number];
export type RichTextAttributes = NonNullable<RichTextOp['attributes']>;

const INLINE_KEYS = ['bold', 'italic', 'link'] as const;
const BLOCK_KEYS = ['list', 'indent'] as const;

export function validateRichText(value: unknown): SchemaResult<RichText> {
  return validate(richTextSchema, value);
}

/** Hanya `http:`, `https:`, dan `mailto:`; selain itu tautan dibuang (aturan lengkap di BOARD-2002). */
export function sanitizeLink(href: string): string | undefined {
  const trimmed = href.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!match) return undefined;
  return ['http', 'https', 'mailto'].includes(match[1]!.toLowerCase()) ? trimmed : undefined;
}

function cleanText(text: string): string {
  // CRLF dan CR menjadi LF; karakter kontrol lain selain tab dibuang.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

function pickAttributes(
  attrs: Record<string, unknown> | undefined,
  isNewline: boolean,
): RichTextAttributes | undefined {
  if (!attrs) return undefined;
  const out: Record<string, unknown> = {};
  if (isNewline) {
    if (attrs.list === 'bullet' || attrs.list === 'ordered') {
      out.list = attrs.list;
      const indent = attrs.indent;
      if (typeof indent === 'number' && Number.isInteger(indent) && indent >= 1)
        out.indent = Math.min(indent, MAX_INDENT);
    }
  } else {
    if (attrs.bold === true) out.bold = true;
    if (attrs.italic === true) out.italic = true;
    if (typeof attrs.link === 'string') {
      const href = sanitizeLink(attrs.link);
      if (href && href.length <= MAX_LINK_LENGTH) out.link = href;
    }
  }
  return Object.keys(out).length ? (out as RichTextAttributes) : undefined;
}

function sameAttributes(
  a: RichTextAttributes | undefined,
  b: RichTextAttributes | undefined,
): boolean {
  for (const key of [...INLINE_KEYS, ...BLOCK_KEYS]) if (a?.[key] !== b?.[key]) return false;
  return true;
}

/**
 * Mengubah delta apa pun (dari editor, Y.Text, tempel, atau peer) ke bentuk kanonik yang aman.
 * Tidak pernah melempar exception; masukan yang tidak dikenali dibuang.
 */
export function normalizeRichText(input: readonly unknown[]): RichText {
  const out: RichTextOp[] = [];
  let length = 0;
  // Satu karakter dicadangkan untuk `\n` penutup.
  const push = (insert: string, attributes: RichTextAttributes | undefined, final = false) => {
    const room = MAX_RICH_TEXT_LENGTH - (final ? 0 : 1) - length;
    if (!insert || room <= 0) return;
    const text = insert.slice(0, room);
    length += text.length;
    const last = out[out.length - 1];
    if (last && sameAttributes(last.attributes, attributes)) last.insert += text;
    else out.push(attributes ? { insert: text, attributes } : { insert: text });
  };

  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { insert, attributes } = raw as {
      insert?: unknown;
      attributes?: Record<string, unknown>;
    };
    if (typeof insert !== 'string') continue; // embed tidak didukung
    const text = cleanText(insert);
    // Pisahkan per baris: atribut inline untuk teks, atribut blok untuk `\n`.
    let start = 0;
    for (let i = 0; i <= text.length; i++) {
      if (i === text.length || text[i] === '\n') {
        push(text.slice(start, i), pickAttributes(attributes, false));
        if (i < text.length) push('\n', pickAttributes(attributes, true));
        start = i + 1;
      }
    }
  }

  if (!out[out.length - 1]?.insert.endsWith('\n')) push('\n', undefined, true);
  return out;
}

/** Teks polos untuk `export.text`, a11y, dan pencarian. Daftar diberi penanda sederhana. */
export function richTextToPlainText(delta: RichText): string {
  const lines: string[] = [];
  let line = '';
  const counters: number[] = [];
  for (const op of delta) {
    for (const ch of op.insert.split(/(\n)/)) {
      if (ch !== '\n') {
        line += ch;
        continue;
      }
      const list = op.attributes?.list;
      const indent = op.attributes?.indent ?? 0;
      if (list) {
        counters.length = indent + 1;
        counters[indent] = (counters[indent] ?? 0) + 1;
        const marker = list === 'ordered' ? `${counters[indent]}.` : '-';
        lines.push(`${'  '.repeat(indent)}${marker} ${line}`);
      } else {
        counters.length = 0;
        lines.push(line);
      }
      line = '';
    }
  }
  return lines.join('\n').replace(/\n+$/, '');
}
