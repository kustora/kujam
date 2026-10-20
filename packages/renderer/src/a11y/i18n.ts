/**
 * Accessibility tree strings in Indonesian and English (BOARD-1901, BOARD-1909).
 *
 * @internal
 */

import { translate, type Board, type TranslationParams } from '@kujam/core';

/**
 * Key of an accessibility tree string (`a11y.<key>` in {@link DEFAULT_MESSAGES}).
 *
 * @internal
 */
export type A11yStringKey =
  | 'board'
  | 'roleDescription'
  | 'list'
  | 'help'
  | 'element'
  | 'locked'
  | 'elementCreated'
  | 'elementsCreated'
  | 'elementDeletedOne'
  | 'elementDeleted'
  | 'peerJoined'
  | 'peersJoined'
  | 'peerLeft'
  | 'peersLeft'
  | 'someone'
  | 'connectionLost'
  | 'connectionRestored'
  | 'connectionError';

/**
 * String for the board locale (anything other than `en*` uses Indonesian) or from a `Board`
 * instance (respecting custom `messages`), with `{name}` placeholders replaced from `params`.
 *
 * @internal
 */
export function a11yText(
  key: A11yStringKey,
  localeOrBoard: string | Pick<Board, 't'>,
  params: TranslationParams = {},
): string {
  const fullKey = `a11y.${key}`;
  if (typeof localeOrBoard === 'string') {
    return translate(fullKey, localeOrBoard, params);
  }
  return localeOrBoard.t(fullKey, params);
}
