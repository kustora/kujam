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
