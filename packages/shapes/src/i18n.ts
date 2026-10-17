/**
 * Built-in element text in Indonesian and English (a11y labels).
 *
 * @internal
 */

/** Bilingual text. */
export interface Bilingual {
  readonly id: string;
  readonly en: string;
}

/** Picks text for the board locale; anything other than `en*` uses Indonesian. */
export function localize(text: Bilingual, locale: string): string {
  return locale.toLowerCase().startsWith('en') ? text.en : text.id;
}

/** a11y label `"<kind>: <content>"`, or just the kind when content is empty. Content is truncated to 200 characters. */
export function a11yLabel(kind: string, content: string): string {
  const trimmed = content.replace(/\s+/g, ' ').trim();
  if (!trimmed) return kind;
  return `${kind}: ${trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed}`;
}
