/**
 * Re-exports rich text model and schemas from `text/model.js` (ADR-008, BOARD-1003a).
 */

export {
  EMPTY_RICH_TEXT,
  LINK_URL_SCHEMES,
  MAX_LINK_LENGTH,
  MAX_LIST_INDENT,
  MAX_RICH_TEXT_LENGTH,
  isRichTextEmpty,
  normalizeRichText,
  richTextSchema,
  richTextToPlainText,
  sanitizeLink,
  validateRichText,
  type RichText,
  type RichTextAttributes,
  type RichTextOp,
} from './text/model.js';
