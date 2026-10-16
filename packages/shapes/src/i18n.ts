/**
 * Teks bawaan elemen dalam bahasa Indonesia dan Inggris (label a11y).
 *
 * @internal
 */

/** Teks dwibahasa. */
export interface Bilingual {
  readonly id: string;
  readonly en: string;
}

/** Memilih teks sesuai locale board; selain `en*` memakai bahasa Indonesia. */
export function localize(text: Bilingual, locale: string): string {
  return locale.toLowerCase().startsWith('en') ? text.en : text.id;
}

/** Label a11y `"<jenis>: <isi>"`, atau hanya jenis bila isi kosong. Isi dipotong 200 karakter. */
export function a11yLabel(kind: string, content: string): string {
  const trimmed = content.replace(/\s+/g, ' ').trim();
  if (!trimmed) return kind;
  return `${kind}: ${trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed}`;
}
