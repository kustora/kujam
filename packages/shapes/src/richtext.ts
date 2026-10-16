/**
 * Skema rich text untuk sticky, teks, dan label shape (ADR-008).
 *
 * Format: delta datar yang identik dengan delta `Y.Text` dan Quill. Atribut inline (`bold`,
 * `italic`, `link`) menempel pada teks; atribut blok (`list`, `indent`) hanya pada `\n` penutup
 * baris; dokumen selalu diakhiri `\n`. Normalisasi dan renderer teks Canvas menyusul di
 * BOARD-1003a; modul ini hanya memuat skema struktural dan konversi ke teks polos.
 */
import { array, enumOf, literal, number, object, optional, string, type Infer } from '@kujam/core';

/**
 * Batas panjang rich text per elemen, dalam unit UTF-16 (ADR-008).
 *
 * @beta
 */
export const MAX_RICH_TEXT_LENGTH = 20_000;

/**
 * Batas panjang tautan (ADR-008).
 *
 * @beta
 */
export const MAX_LINK_LENGTH = 2048;

/**
 * Kedalaman indentasi daftar maksimum (ADR-008).
 *
 * @beta
 */
export const MAX_LIST_INDENT = 3;

/**
 * Skema struktural rich text untuk data dari peer atau server (ADR-007, ADR-008).
 *
 * @beta
 */
export const richTextSchema = array(
  object({
    insert: string({ minLength: 1, maxLength: MAX_RICH_TEXT_LENGTH }),
    attributes: optional(
      object({
        bold: optional(literal(true)),
        italic: optional(literal(true)),
        link: optional(string({ maxLength: MAX_LINK_LENGTH })),
        list: optional(enumOf(['bullet', 'ordered'])),
        indent: optional(number({ int: true, min: 1, max: MAX_LIST_INDENT })),
      }),
    ),
  }),
  { maxLength: MAX_RICH_TEXT_LENGTH },
);

/**
 * Rich text: daftar op `{ insert, attributes? }`.
 *
 * @beta
 */
export type RichText = Infer<typeof richTextSchema>;

/**
 * Rich text kosong dalam bentuk kanonik.
 *
 * @beta
 */
export const EMPTY_RICH_TEXT: RichText = Object.freeze([
  Object.freeze({ insert: '\n' }),
]) as unknown as RichText;

/**
 * Teks polos dari rich text, tanpa `\n` penutup dokumen. Format dan penanda daftar dibuang.
 *
 * @beta
 */
export function richTextToPlainText(text: RichText): string {
  let out = '';
  for (const op of text) out += op.insert;
  return out.endsWith('\n') ? out.slice(0, -1) : out;
}
