/**
 * UI strings in Indonesian and English (BOARD-1401). A full i18n system is BOARD-1909.
 */

import type { BoardLocale } from '@kujam/core';

type Text = Readonly<Record<BoardLocale, string>>;

const STRINGS = {
  toolbar: { id: 'Alat', en: 'Tools' },
  moreOptions: { id: 'Pilihan lain', en: 'More options' },
  'tool.select': { id: 'Pilih', en: 'Select' },
  'tool.hand': { id: 'Tangan', en: 'Hand' },
  'tool.sticky': { id: 'Sticky', en: 'Sticky' },
  'tool.draw': { id: 'Pena', en: 'Pen' },
  'tool.shape': { id: 'Bentuk', en: 'Shape' },
  'tool.rectangle': { id: 'Kotak', en: 'Rectangle' },
  'tool.ellipse': { id: 'Elips', en: 'Ellipse' },
  'tool.text': { id: 'Teks', en: 'Text' },
  'tool.eraser': { id: 'Penghapus', en: 'Eraser' },
  'style.color': { id: 'Warna', en: 'Color' },
  'style.brush': { id: 'Kuas', en: 'Brush' },
  'brush.pen': { id: 'Pena', en: 'Pen' },
  'brush.highlighter': { id: 'Stabilo', en: 'Highlighter' },
  'color.black': { id: 'Hitam', en: 'Black' },
  'color.grey': { id: 'Abu-abu', en: 'Grey' },
  'color.gray': { id: 'Abu-abu', en: 'Gray' },
  'color.white': { id: 'Putih', en: 'White' },
  'color.red': { id: 'Merah', en: 'Red' },
  'color.orange': { id: 'Oranye', en: 'Orange' },
  'color.yellow': { id: 'Kuning', en: 'Yellow' },
  'color.green': { id: 'Hijau', en: 'Green' },
  'color.blue': { id: 'Biru', en: 'Blue' },
  'color.violet': { id: 'Violet', en: 'Violet' },
  'color.purple': { id: 'Ungu', en: 'Purple' },
  'color.pink': { id: 'Merah muda', en: 'Pink' },
  zoom: { id: 'Zoom', en: 'Zoom' },
  zoomIn: { id: 'Perbesar', en: 'Zoom in' },
  zoomOut: { id: 'Perkecil', en: 'Zoom out' },
  zoomOptions: { id: 'Pilihan zoom', en: 'Zoom options' },
  zoomLevel: { id: 'Zoom {percent}', en: 'Zoom {percent}' },
  zoomToFit: { id: 'Pas ke layar', en: 'Zoom to fit' },
  history: { id: 'Riwayat', en: 'History' },
  undo: { id: 'Urungkan', en: 'Undo' },
  redo: { id: 'Ulangi', en: 'Redo' },
} as const satisfies Record<string, Text>;

/**
 * Key of a built-in UI string.
 *
 * @internal
 */
export type UiStringKey = keyof typeof STRINGS;

/**
 * Built-in UI string for a locale, falling back to Indonesian.
 *
 * @internal
 */
export function t(key: UiStringKey, locale: BoardLocale): string {
  const text: Text = STRINGS[key];
  return text[locale] ?? text.id;
}

/**
 * Built-in UI string when `key` is one, else `fallback`: for labels that may be i18n keys, such as
 * brush labels (BOARD-603).
 *
 * @internal
 */
export function tOr(key: string, locale: BoardLocale, fallback: string): string {
  return Object.hasOwn(STRINGS, key) ? t(key as UiStringKey, locale) : fallback;
}
