import { existsSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// BOARD-107: application domain terms banned in packages/*/src.
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

// Match a term as a single name segment, including inside camelCase, PascalCase,
// snake_case, and SCREAMING_CASE: `post`, `postId`, `createPost`, `approvalStatus`,
// `campaign_name`, `BRAND_COLOR`. Segments may end in `s` (plural). No `i` flag,
// so camelCase boundaries are read from uppercase letters.
const FORBIDDEN_DOMAIN_TERMS_REGEX = [
  `(^|[^a-zA-Z])(${FORBIDDEN_DOMAIN_TERMS.join('|')})s?(?![a-z])`,
  `(${FORBIDDEN_DOMAIN_TERMS.map(capitalize).join('|')})s?(?![a-z])`,
  `(${FORBIDDEN_DOMAIN_TERMS.map((term) => term.toUpperCase()).join('|')})S?(?![A-Z])`,
].join('|');

// Platform APIs that happen to contain the terms above and are allowed.
const ALLOWED_IDENTIFIERS_REGEX = '^(postMessage|onmessage)$';

// Reviewed string exceptions: whole string values that contain a banned term but name a platform
// concept, not the application domain. Keep each entry justified here.
// - `POST`: the HTTP method, for HTTP adapters such as storage-http (`method: 'POST'`).
const ALLOWED_STRINGS_REGEX = '^(POST)$';

const DOMAIN_TERMS_MESSAGE =
  'BOARD-107: Istilah domain aplikasi (post, task, brand, approval, campaign, kampanye, tayang) dilarang di dalam package @kujam/*.';

// BOARD-106: @kujam/* packages each package may import, following the "Depends on"
// column of the package table in the PRD. One direction: core <- renderer <- ui/react/vue/export;
// shapes, sync-yjs, storage-*, and server depend only on core. New packages must be
// registered here; otherwise loading this config throws.
const KUJAM_ALLOWED_IMPORTS = {
  core: [],
  renderer: ['core'],
  shapes: ['core'],
  'sync-yjs': ['core'],
  'storage-memory': ['core'],
  'storage-indexeddb': ['core'],
  'storage-http': ['core'],
  server: ['core', 'sync-yjs', 'renderer'],
  ui: ['core', 'renderer'],
  react: ['core', 'renderer'],
  vue: ['core', 'renderer'],
  export: ['core', 'renderer'],
};

const packagesDir = new URL('./packages/', import.meta.url);
const unregisteredPackages = readdirSync(packagesDir, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(new URL(`${entry.name}/package.json`, packagesDir)),
  )
  .map((entry) => entry.name)
  .filter((name) => !Object.hasOwn(KUJAM_ALLOWED_IMPORTS, name));
if (unregisteredPackages.length > 0) {
  throw new Error(
    `BOARD-106: package berikut belum terdaftar di KUJAM_ALLOWED_IMPORTS (eslint.config.mjs): ${unregisteredPackages.join(', ')}`,
  );
}

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.next/**',
      '**/next-env.d.ts',
      'docs/**',
      // Claude Code subagent worktrees hold full copies of the repo.
      '.claude/**',
      // BOARD-106: intentional violation examples; linted by tooling/architecture.test.ts.
      'tooling/fixtures/**',
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
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // BOARD-107: Ban Tayang domain terms across packages/*/src
      // Identifiers, string literals, and template literal text are checked with the same
      // segment regex, so words that merely contain a term (`postpone`, `multitask`) still pass.
      'no-restricted-syntax': [
        'error',
        {
          selector: `Identifier[name=/${FORBIDDEN_DOMAIN_TERMS_REGEX}/]:not([name=/${ALLOWED_IDENTIFIERS_REGEX}/])`,
          message: DOMAIN_TERMS_MESSAGE,
        },
        {
          selector: `Literal[value=/${FORBIDDEN_DOMAIN_TERMS_REGEX}/]:not([value=/${ALLOWED_STRINGS_REGEX}/])`,
          message: DOMAIN_TERMS_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=/${FORBIDDEN_DOMAIN_TERMS_REGEX}/]`,
          message: DOMAIN_TERMS_MESSAGE,
        },
      ],
    },
  },
  {
    // BOARD-2001: Ban innerHTML, outerHTML, insertAdjacentHTML, and document.write in package runtime code.
    files: ['packages/*/src/**/*.{ts,tsx}'],
    ignores: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test-d.ts', 'packages/*/src/**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Identifier[name=/${FORBIDDEN_DOMAIN_TERMS_REGEX}/]:not([name=/${ALLOWED_IDENTIFIERS_REGEX}/])`,
          message: DOMAIN_TERMS_MESSAGE,
        },
        {
          selector: `Literal[value=/${FORBIDDEN_DOMAIN_TERMS_REGEX}/]:not([value=/${ALLOWED_STRINGS_REGEX}/])`,
          message: DOMAIN_TERMS_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=/${FORBIDDEN_DOMAIN_TERMS_REGEX}/]`,
          message: DOMAIN_TERMS_MESSAGE,
        },
        {
          selector: "MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]",
          message:
            'BOARD-2001: Dilarang memakai innerHTML/outerHTML/insertAdjacentHTML di kode sumber package @kujam/*; gunakan DOM API terstruktur (createElement, textContent) atau DOMParser.',
        },
        {
          selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
          message:
            'BOARD-2001: Dilarang memakai document.write/writeln di kode sumber package @kujam/*.',
        },
      ],
    },
  },
  {
    // BOARD-106: @kujam/core must be DOM-free. The full check is in typecheck
    // (`lib: ["ES2022"]` without `dom`); this rule gives a clear message for common cases.
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
    },
  },
  // BOARD-106: import direction between layers, one block per package.
  ...Object.entries(KUJAM_ALLOWED_IMPORTS).map(([pkg, allowed]) => ({
    files: [`packages/${pkg}/src/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // gitignore-style patterns: ban all @kujam/*, then allow the permitted ones.
              group: ['@kujam/*', ...allowed.map((dep) => `!@kujam/${dep}`)],
              message:
                allowed.length === 0
                  ? 'BOARD-106: @kujam/core adalah lapisan paling dalam dan tidak boleh mengimpor package @kujam/* lain.'
                  : `BOARD-106: @kujam/${pkg} hanya boleh mengimpor ${allowed.map((dep) => `@kujam/${dep}`).join(', ')}; lapisan dalam tidak boleh mengimpor lapisan luar.`,
            },
          ],
        },
      ],
    },
  })),
);
