import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// BOARD-107: istilah domain aplikasi yang dilarang di packages/*/src.
const FORBIDDEN_DOMAIN_TERMS = [
  'post',
  'task',
  'brand',
  'approval',
  'campaign',
  'kampanye',
  'tayang',
];

const capitalize = (term) => term[0].toUpperCase() + term.slice(1);

// Cocokkan istilah sebagai satu segmen nama, termasuk di dalam camelCase, PascalCase,
// snake_case, dan SCREAMING_CASE: `post`, `postId`, `createPost`, `approvalStatus`,
// `campaign_name`, `BRAND_COLOR`. Segmen boleh berakhiran `s` (jamak). Tanpa flag `i`
// agar batas camelCase terbaca dari huruf besar.
const FORBIDDEN_DOMAIN_TERMS_REGEX = [
  `(^|[^a-zA-Z])(${FORBIDDEN_DOMAIN_TERMS.join('|')})s?(?![a-z])`,
  `(${FORBIDDEN_DOMAIN_TERMS.map(capitalize).join('|')})s?(?![a-z])`,
  `(${FORBIDDEN_DOMAIN_TERMS.map((term) => term.toUpperCase()).join('|')})S?(?![A-Z])`,
].join('|');

// API platform yang kebetulan memuat istilah di atas dan boleh dipakai.
const ALLOWED_IDENTIFIERS_REGEX = '^(postMessage|onmessage)$';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**', 'docs/**'],
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
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // BOARD-107: Larangan istilah domain Tayang di seluruh packages/*/src
      'no-restricted-syntax': [
        'error',
        {
          selector: `Identifier[name=/${FORBIDDEN_DOMAIN_TERMS_REGEX}/]:not([name=/${ALLOWED_IDENTIFIERS_REGEX}/])`,
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
