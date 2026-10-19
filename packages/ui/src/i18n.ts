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
  'tool.connector': { id: 'Konektor', en: 'Connector' },
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
  selectionToolbar: { id: 'Aksi elemen', en: 'Element actions' },
  lock: { id: 'Kunci', en: 'Lock' },
  unlock: { id: 'Buka kunci', en: 'Unlock' },
  delete: { id: 'Hapus', en: 'Delete' },
  duplicate: { id: 'Duplikat', en: 'Duplicate' },
  layer: { id: 'Lapisan', en: 'Layer' },
  'layer.bringForward': { id: 'Bawa maju', en: 'Bring forward' },
  'layer.sendBackward': { id: 'Kirim mundur', en: 'Send backward' },
  'layer.bringToFront': { id: 'Bawa ke paling depan', en: 'Bring to front' },
  'layer.sendToBack': { id: 'Kirim ke paling belakang', en: 'Send to back' },
  'style.fillColor': { id: 'Warna isian', en: 'Fill color' },
  'style.fill': { id: 'Isian', en: 'Fill' },
  'style.thickness': { id: 'Ketebalan', en: 'Thickness' },
  'style.dash': { id: 'Gaya garis', en: 'Line style' },
  'style.size': { id: 'Ukuran font', en: 'Font size' },
  'style.align': { id: 'Perataan', en: 'Alignment' },
  'style.connectorStyle': { id: 'Gaya konektor', en: 'Connector style' },
  'style.connectorStyle.straight': { id: 'Lurus', en: 'Straight' },
  'style.connectorStyle.elbow': { id: 'Siku', en: 'Elbow' },
  'style.connectorStyle.curved': { id: 'Lengkung', en: 'Curved' },
  'style.startArrow': { id: 'Panah awal', en: 'Start arrow' },
  'style.endArrow': { id: 'Panah akhir', en: 'End arrow' },
  'style.arrow.none': { id: 'Tanpa panah', en: 'None' },
  'style.arrow.arrow': { id: 'Panah', en: 'Arrow' },
  'style.arrow.triangle': { id: 'Segitiga', en: 'Triangle' },
  'style.arrow.dot': { id: 'Titik', en: 'Dot' },
  'style.fill.none': { id: 'Tanpa isian', en: 'None' },
  'style.fill.semi': { id: 'Transparan', en: 'Semi' },
  'style.fill.solid': { id: 'Penuh', en: 'Solid' },
  'style.dash.solid': { id: 'Penuh', en: 'Solid' },
  'style.dash.dashed': { id: 'Putus-putus', en: 'Dashed' },
  'style.dash.dotted': { id: 'Titik-titik', en: 'Dotted' },
  'style.align.start': { id: 'Awal', en: 'Start' },
  'style.align.center': { id: 'Tengah', en: 'Center' },
  'style.align.end': { id: 'Akhir', en: 'End' },
  'size.s': { id: 'Kecil', en: 'Small' },
  'size.m': { id: 'Sedang', en: 'Medium' },
  'size.l': { id: 'Besar', en: 'Large' },
  'size.xl': { id: 'Sangat besar', en: 'Extra large' },
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
