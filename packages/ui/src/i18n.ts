/**
 * UI strings in Indonesian and English (BOARD-1401, BOARD-1909).
 */

import {
  DEFAULT_MESSAGES,
  translate,
  type Board,
  type BoardLocale,
  type TranslationParams,
} from '@kujam/core';

/**
 * Key of a built-in UI string.
 *
 * @internal
 */
export type UiStringKey = string;

/**
 * Built-in UI string for a locale or `Board` instance (respecting custom `messages`), falling back
 * to Indonesian.
 *
 * @internal
 */
export function t(
  key: UiStringKey,
  localeOrBoard: BoardLocale | Pick<Board, 't'>,
  params?: TranslationParams,
): string {
  if (typeof localeOrBoard === 'string') {
    return translate(key, localeOrBoard, params);
  }
  return localeOrBoard.t(key, params);
}

/**
 * Built-in or custom UI string when `key` is registered in the dictionary, else `fallback`: for
 * labels that may be i18n keys, such as brush or plugin toolbar labels (BOARD-603, BOARD-1909).
 *
 * @internal
 */
export function tOr(
  key: string,
  localeOrBoard: BoardLocale | Pick<Board, 't' | 'i18n'>,
  fallback: string,
): string {
  if (typeof localeOrBoard === 'string') {
    return Object.hasOwn(DEFAULT_MESSAGES.id, key) ? translate(key, localeOrBoard) : fallback;
  }
  return localeOrBoard.i18n.has(key) ? localeOrBoard.t(key) : fallback;
}

