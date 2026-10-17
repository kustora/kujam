/**
 * Rich text schema for sticky notes, text, and shape labels (ADR-008).
 *
 * Format: a flat delta identical to the `Y.Text` and Quill delta. Inline attributes (`bold`,
 * `italic`, `link`) attach to text; block attributes (`list`, `indent`) only to the `\n` that ends
 * a line; documents always end with `\n`. Normalization and the Canvas text renderer follow in
 * BOARD-1003a; this module only holds the structural schema and conversion to plain text.
 */
import {
  array,
  enumOf,
  literal,
  number,
  object,
  optional,
  string,
  url,
  type Infer,
} from '@kujam/core';

/**
 * Rich text length limit per element, in UTF-16 code units (ADR-008).
 *
 * @beta
 */
export const MAX_RICH_TEXT_LENGTH = 20_000;

/**
 * Link length limit (ADR-008).
 *
 * @beta
 */
export const MAX_LINK_LENGTH = 2048;

/**
 * Schemes allowed for rich text links (ADR-008, BOARD-2002). Anything else, including
 * `javascript:`, is rejected by {@link richTextSchema}.
 *
 * @beta
 */
export const LINK_URL_SCHEMES: readonly string[] = Object.freeze(['https:', 'http:', 'mailto:']);

/**
 * Maximum list indentation depth (ADR-008).
 *
 * @beta
 */
export const MAX_LIST_INDENT = 3;

/**
 * Structural rich text schema for data from peers or the server (ADR-007, ADR-008).
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
        link: optional(url({ schemes: LINK_URL_SCHEMES, maxLength: MAX_LINK_LENGTH })),
        list: optional(enumOf(['bullet', 'ordered'])),
        indent: optional(number({ int: true, min: 1, max: MAX_LIST_INDENT })),
      }),
    ),
  }),
  { maxLength: MAX_RICH_TEXT_LENGTH },
);

/**
 * Rich text: a list of `{ insert, attributes? }` ops.
 *
 * @beta
 */
export type RichText = Infer<typeof richTextSchema>;

/**
 * Empty rich text in canonical form.
 *
 * @beta
 */
export const EMPTY_RICH_TEXT: RichText = Object.freeze([
  Object.freeze({ insert: '\n' }),
]) as unknown as RichText;

/**
 * Plain text from rich text, without the document's closing `\n`. Formatting and list markers are dropped.
 *
 * @beta
 */
export function richTextToPlainText(text: RichText): string {
  let out = '';
  for (const op of text) out += op.insert;
  return out.endsWith('\n') ? out.slice(0, -1) : out;
}
