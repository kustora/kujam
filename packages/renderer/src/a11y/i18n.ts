/**
 * Accessibility tree strings in Indonesian and English (BOARD-1901). A full i18n system is
 * BOARD-1909.
 *
 * @internal
 */

type Text = Readonly<{ id: string; en: string }>;

const STRINGS = {
  board: { id: 'Papan tulis', en: 'Whiteboard' },
  roleDescription: { id: 'papan tulis', en: 'whiteboard' },
  list: { id: 'Elemen papan', en: 'Board elements' },
  help: {
    id:
      'Tab dan Shift+Tab berpindah antar elemen. Panah memindahkan elemen terpilih, ' +
      'Shift+panah sejauh 10 piksel. Enter mengedit. Esc keluar dari elemen; ' +
      'tekan Esc lalu Tab untuk keluar dari papan.',
    en:
      'Tab and Shift+Tab move between elements. Arrow keys move the selected element, ' +
      'Shift+arrow by 10 pixels. Enter edits. Esc leaves the element; ' +
      'press Esc, then Tab to leave the board.',
  },
  element: { id: 'Elemen {type}', en: '{type} element' },
  locked: { id: 'Terkunci', en: 'Locked' },
} as const satisfies Record<string, Text>;

/**
 * Key of an accessibility tree string.
 *
 * @internal
 */
export type A11yStringKey = keyof typeof STRINGS;

/**
 * String for the board locale (anything other than `en*` uses Indonesian), with `{name}`
 * placeholders replaced from `params`.
 *
 * @internal
 */
export function a11yText(
  key: A11yStringKey,
  locale: string,
  params: Readonly<Record<string, string>> = {},
): string {
  const text: Text = STRINGS[key];
  const template = locale.toLowerCase().startsWith('en') ? text.en : text.id;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}
