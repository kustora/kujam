/**
 * Canonical rich text model, schema validation, and normalization (ADR-008, BOARD-1003a).
 *
 * Format: a flat delta identical to the `Y.Text` and Quill delta.
 * - Inline attributes (`bold`, `italic`, `link`) attach to text ops.
 * - Block attributes (`list`, `indent`) attach strictly to the `\n` that closes a line.
 * - Documents always end with `\n`. Empty document is `[{ insert: '\n' }]`.
 * - Canonical form: adjacent ops with identical attributes are merged.
 *
 * @packageDocumentation
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
  validate,
  type Infer,
  type SchemaResult,
} from '@kujam/core';

/**
 * Rich text length limit per element in UTF-16 code units (ADR-008).
 *
 * @public
 */
export const MAX_RICH_TEXT_LENGTH = 20_000;

/**
 * Link length limit in characters (ADR-008).
 *
 * @public
 */
export const MAX_LINK_LENGTH = 2048;

/**
 * Maximum list nesting indent depth (ADR-008).
 *
 * @public
 */
export const MAX_LIST_INDENT = 3;

/**
 * Schemes allowed for rich text links (ADR-008, BOARD-2002).
 * Any other scheme (e.g. `javascript:`, `data:`, `vbscript:`) is rejected.
 *
 * @public
 */
export const LINK_URL_SCHEMES: readonly string[] = Object.freeze(['https:', 'http:', 'mailto:']);

/**
 * Structural rich text schema for runtime payload validation from disk or network (ADR-007, ADR-008).
 *
 * @public
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
 * Rich text payload: a list of `{ insert, attributes? }` ops.
 *
 * @public
 */
export type RichText = Infer<typeof richTextSchema>;

/**
 * Individual rich text operation.
 *
 * @public
 */
export type RichTextOp = RichText[number];

/**
 * Attributes supported on rich text ops.
 *
 * @public
 */
export type RichTextAttributes = NonNullable<RichTextOp['attributes']>;

/**
 * Canonical empty rich text document.
 *
 * @public
 */
export const EMPTY_RICH_TEXT: RichText = Object.freeze([
  Object.freeze({ insert: '\n' }),
]) as unknown as RichText;

const INLINE_KEYS = ['bold', 'italic', 'link'] as const;
const BLOCK_KEYS = ['list', 'indent'] as const;

/**
 * Validates untrusted rich text data against the structural schema (ADR-007).
 *
 * @public
 */
export function validateRichText(value: unknown): SchemaResult<RichText> {
  return validate(richTextSchema, value);
}

/**
 * Sanitizes a link URL.
 * Only `http:`, `https:`, and `mailto:` are permitted; control chars and invalid schemes are dropped.
 *
 * @public
 */
export function sanitizeLink(href: string): string | undefined {
  const trimmed = href.trim();
  // Reject ASCII control characters
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!match) return undefined;
  const scheme = match[1]!.toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? trimmed : undefined;
}

/**
 * Cleans input text: normalizes CRLF and CR to LF, and strips non-tab control characters.
 */
function cleanText(text: string): string {
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
      if (typeof indent === 'number' && Number.isInteger(indent) && indent >= 1) {
        out.indent = Math.min(indent, MAX_LIST_INDENT);
      }
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
  for (const key of [...INLINE_KEYS, ...BLOCK_KEYS]) {
    if (a?.[key] !== b?.[key]) return false;
  }
  return true;
}

/**
 * Converts any delta or raw op list into canonical form without throwing exceptions (BOARD-1003a).
 * - Inline attributes only apply to non-newline characters.
 * - Block attributes (`list`, `indent`) strictly apply to newline characters.
 * - Non-string inserts and unsupported attributes are stripped.
 * - Merges adjacent ops with identical attributes.
 * - Guarantees document ends with `\n`.
 *
 * @public
 */
export function normalizeRichText(input: readonly unknown[]): RichText {
  const out: RichTextOp[] = [];
  let length = 0;

  const push = (insert: string, attributes: RichTextAttributes | undefined, final = false) => {
    const room = MAX_RICH_TEXT_LENGTH - (final ? 0 : 1) - length;
    if (!insert || room <= 0) return;
    const text = insert.slice(0, room);
    length += text.length;
    const last = out[out.length - 1];
    if (last && sameAttributes(last.attributes, attributes)) {
      last.insert += text;
    } else {
      out.push(attributes ? { insert: text, attributes } : { insert: text });
    }
  };

  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { insert, attributes } = raw as {
      insert?: unknown;
      attributes?: Record<string, unknown>;
    };
    if (typeof insert !== 'string') continue;
    const text = cleanText(insert);

    let start = 0;
    for (let i = 0; i <= text.length; i++) {
      if (i === text.length || text[i] === '\n') {
        if (i > start) {
          push(text.slice(start, i), pickAttributes(attributes, false));
        }
        if (i < text.length) {
          push('\n', pickAttributes(attributes, true));
        }
        start = i + 1;
      }
    }
  }

  if (!out[out.length - 1]?.insert.endsWith('\n')) {
    push('\n', undefined, true);
  }

  return out.length > 0 ? out : [Object.freeze({ insert: '\n' })];
}

/**
 * Returns plain text representation of a rich text delta, suitable for search, export, and a11y labels.
 * Dropping the terminal trailing newline.
 *
 * @public
 */
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
      const indent = (op.attributes?.indent ?? 1) - 1;
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

  if (line.length > 0) {
    lines.push(line);
  }

  return lines.join('\n').replace(/\n+$/, '');
}

/**
 * Returns `true` if rich text contains no visible text characters (only empty lines / spaces).
 *
 * @public
 */
export function isRichTextEmpty(delta: RichText): boolean {
  for (const op of delta) {
    const textWithoutNewlines = op.insert.replace(/\n/g, '').trim();
    if (textWithoutNewlines.length > 0) return false;
  }
  return true;
}
