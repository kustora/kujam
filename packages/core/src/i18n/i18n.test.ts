import { describe, expect, it } from 'vitest';
import {
  createBoard,
  DEFAULT_MESSAGES,
  definePlugin,
  interpolateMessage,
  normalizeLocale,
  PluginError,
  SUPPORTED_LOCALES,
  translate,
} from '../index.js';

/** Extracts all `{param}` placeholder names from a message template. */
function extractPlaceholders(template: string): string[] {
  const matches = template.matchAll(/\{(\w+)\}/g);
  return [...new Set([...matches].map((m) => m[1]!))].sort();
}

describe('i18n system and id/en dictionaries (BOARD-1909)', () => {
  describe('DEFAULT_MESSAGES completeness', () => {
    it('has zero missing or empty keys across id and en dictionaries', () => {
      const idKeys = Object.keys(DEFAULT_MESSAGES.id).sort();
      const enKeys = Object.keys(DEFAULT_MESSAGES.en).sort();

      expect(idKeys.length).toBeGreaterThan(70);
      expect(enKeys).toEqual(idKeys);

      for (const locale of SUPPORTED_LOCALES) {
        const dict = DEFAULT_MESSAGES[locale];
        for (const key of idKeys) {
          const val = dict[key];
          expect(typeof val, `Missing or non-string "${key}" in "${locale}"`).toBe('string');
          expect(val!.trim().length, `Empty translation for "${key}" in "${locale}"`).toBeGreaterThan(
            0,
          );
        }
      }
    });

    it('keeps identical {param} placeholders between id and en for every key', () => {
      for (const key of Object.keys(DEFAULT_MESSAGES.id)) {
        const idParams = extractPlaceholders(DEFAULT_MESSAGES.id[key]!);
        const enParams = extractPlaceholders(DEFAULT_MESSAGES.en[key]!);
        expect(enParams, `Placeholder mismatch for key "${key}"`).toEqual(idParams);
      }
    });
  });

  describe('standalone helpers', () => {
    it('normalizes locale strings to id or en', () => {
      expect(normalizeLocale('id')).toBe('id');
      expect(normalizeLocale('id-ID')).toBe('id');
      expect(normalizeLocale('en')).toBe('en');
      expect(normalizeLocale('en-US')).toBe('en');
      expect(normalizeLocale('EN-GB')).toBe('en');
      expect(normalizeLocale(undefined)).toBe('id');
    });

    it('interpolates {name} parameters and preserves unmatched placeholders', () => {
      expect(interpolateMessage('Zoom {percent}', { percent: '150%' })).toBe('Zoom 150%');
      expect(interpolateMessage('{count} dipilih ({missing})', { count: 3 })).toBe(
        '3 dipilih ({missing})',
      );
    });

    it('translates built-in keys with translate(key, locale, params)', () => {
      expect(translate('tool.select', 'id')).toBe('Pilih');
      expect(translate('tool.select', 'en')).toBe('Select');
      expect(translate('a11y.element', 'id', { type: 'sticky' })).toBe('Elemen sticky');
      expect(translate('a11y.element', 'en-US', { type: 'sticky' })).toBe('sticky element');
      expect(translate('unknown.custom.key', 'en')).toBe('unknown.custom.key');
    });
  });

  describe('board.t and board.i18n', () => {
    it('translates built-in UI and a11y keys using the active board locale', () => {
      const board = createBoard({ locale: 'id' });
      expect(board.t('toolbar')).toBe('Alat');
      expect(board.t('zoomLevel', { percent: '125%' })).toBe('Zoom 125%');
      expect(board.t('a11y.board')).toBe('Papan tulis');

      board.setLocale('en');
      expect(board.i18n.locale).toBe('en');
      expect(board.t('toolbar')).toBe('Tools');
      expect(board.t('zoomLevel', { percent: '125%' })).toBe('Zoom 125%');
      expect(board.t('a11y.board')).toBe('Whiteboard');
    });

    it('accepts custom messages in createBoard({ messages }) and falls back to id then key', () => {
      const board = createBoard({
        locale: 'en',
        messages: {
          id: {
            toolbar: 'Bilah Alat Kustom',
            'app.onlyId': 'Hanya Indonesia ({n})',
          },
          en: {
            toolbar: 'Custom Toolbar',
          },
        },
      });

      expect(board.t('toolbar')).toBe('Custom Toolbar');
      // Falls back to 'id' when 'en' does not define the key
      expect(board.t('app.onlyId', { n: 5 })).toBe('Hanya Indonesia (5)');
      // Falls back to the key itself when neither dictionary defines it
      expect(board.t('app.missingKey')).toBe('app.missingKey');
      expect(board.i18n.has('app.onlyId')).toBe(true);
      expect(board.i18n.has('app.missingKey')).toBe(false);

      board.setLocale('id');
      expect(board.t('toolbar')).toBe('Bilah Alat Kustom');
    });

    it('merges plugin messages via definePlugin({ messages }) and lets consumer messages win', () => {
      let setupTranslation = '';
      const pluginA = definePlugin({
        id: 'plugin-a',
        messages: {
          id: {
            'plugin.shared': 'Dari A (ID)',
            'plugin.a.greeting': 'Halo {user}',
          },
          en: {
            'plugin.shared': 'From A (EN)',
            'plugin.a.greeting': 'Hello {user}',
          },
        },
        setup(b) {
          setupTranslation = b.t('plugin.a.greeting', { user: 'Riziq' });
        },
      });

      const pluginB = definePlugin({
        id: 'plugin-b',
        dependsOn: ['plugin-a'],
        messages: {
          id: {
            'plugin.shared': 'Dari B (ID)',
            'plugin.b.title': 'Judul B',
          },
          en: {
            'plugin.shared': 'From B (EN)',
            'plugin.b.title': 'Title B',
          },
        },
      });

      const board = createBoard({
        locale: 'id',
        plugins: [pluginB, pluginA],
        messages: {
          id: {
            'plugin.b.title': 'Judul B (Override Aplikasi)',
          },
        },
      });

      // Plugin setup can already access its own messages
      expect(setupTranslation).toBe('Halo Riziq');
      // Later plugin in dependency order overrides earlier plugin
      expect(board.t('plugin.shared')).toBe('Dari B (ID)');
      // Consumer messages in createBoard override plugin messages
      expect(board.t('plugin.b.title')).toBe('Judul B (Override Aplikasi)');

      board.setLocale('en');
      expect(board.t('plugin.shared')).toBe('From B (EN)');
      expect(board.t('plugin.a.greeting', { user: 'Riziq' })).toBe('Hello Riziq');
      expect(board.t('plugin.b.title')).toBe('Title B');
    });

    it('supports runtime dictionary updates via board.i18n.addMessages', () => {
      const board = createBoard({ locale: 'id' });
      board.i18n.addMessages('id', { 'runtime.notice': 'Tersimpan ({count})' });
      board.i18n.addMessages('en', { 'runtime.notice': 'Saved ({count})' });

      expect(board.t('runtime.notice', { count: 2 })).toBe('Tersimpan (2)');
      board.setLocale('en');
      expect(board.t('runtime.notice', { count: 2 })).toBe('Saved (2)');
    });

    it('rejects invalid messages in createBoard and definePlugin', () => {
      expect(() =>
        createBoard({
          messages: 'bukan-objek' as unknown as never,
        }),
      ).toThrow(TypeError);

      expect(() =>
        createBoard({
          messages: {
            id: { valid: 123 as unknown as string },
          },
        }),
      ).toThrow(TypeError);

      expect(() =>
        definePlugin({
          id: 'bad-i18n',
          messages: {
            fr: { hello: 'Bonjour' },
          } as unknown as never,
        }),
      ).toThrow(PluginError);
    });
  });
});
