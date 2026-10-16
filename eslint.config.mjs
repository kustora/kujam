import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const FORBIDDEN_DOMAIN_TERMS_REGEX =
  '\\b(post|posts|postId|task|tasks|taskId|brand|brands|brandId|approval|approvals|campaign|campaigns|campaignId|kampanye|tayang)\\b';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      // BOARD-107: Larangan istilah domain Tayang di seluruh packages/*/src
      'no-restricted-syntax': [
        'error',
        {
          selector: `Identifier[name=/${FORBIDDEN_DOMAIN_TERMS_REGEX}/i]`,
          message:
            'BOARD-107: Istilah domain aplikasi (post, task, brand, approval, campaign, kampanye, tayang) dilarang di dalam package @kujam/*.',
        },
      ],
    },
  },
  {
    // BOARD-106: @kujam/core tidak boleh mengimpor package @kujam/* lain atau menyentuh DOM globals
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'BOARD-106: @kujam/core harus bebas DOM (tidak boleh mengakses window).',
        },
        {
          name: 'document',
          message: 'BOARD-106: @kujam/core harus bebas DOM (tidak boleh mengakses document).',
        },
        {
          name: 'HTMLElement',
          message: 'BOARD-106: @kujam/core harus bebas DOM.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@kujam/*'],
              message:
                'BOARD-106: @kujam/core adalah lapisan paling dalam dan tidak boleh mengimpor package @kujam/* lain.',
            },
          ],
        },
      ],
    },
  },
  {
    // BOARD-106: @kujam/renderer hanya boleh mengimpor @kujam/core, tidak boleh mengimpor lapisan luar
    files: ['packages/renderer/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@kujam/ui',
                '@kujam/react',
                '@kujam/vue',
                '@kujam/export',
                '@kujam/server',
                '@kujam/sync-yjs',
                '@kujam/storage-*',
              ],
              message:
                'BOARD-106: @kujam/renderer tidak boleh mengimpor lapisan luar (ui, react, vue, export, server, sync, storage).',
            },
          ],
        },
      ],
    },
  },
);

