/**
 * Tooling tests for architecture and build rules:
 * - BOARD-106: the import-direction lint rules and the core DOM ban are proven to reject violation fixtures.
 * - BOARD-106: core's TypeScript `lib` has no `dom`, so `window` fails typecheck.
 * - BOARD-107: application domain terms are rejected by lint.
 * - BOARD-102: the core tsup config really inlines rbush, fractional-indexing, and nanoid.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';
import { build, type Options } from 'tsup';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import coreTsupConfig from '../packages/core/tsup.config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tooling/fixtures');

const ALL_PACKAGES = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(join(ROOT, 'packages', entry.name, 'package.json')),
  )
  .map((entry) => entry.name);

/** Packages allowed to import @kujam/renderer (core <- renderer <- ui/react/vue/export). */
const RENDERER_CONSUMERS = ['ui', 'react', 'vue', 'export'];

const eslint = new ESLint({ cwd: ROOT });

/** Lints fixture content as if the file were in `packages/<pkg>/src/`. */
async function lintFixtureAs(fixture: string, pkg: string) {
  const code = readFileSync(join(FIXTURES, 'lint', fixture), 'utf8');
  const [result] = await eslint.lintText(code, {
    filePath: join(ROOT, 'packages', pkg, 'src', `__lint_fixture__.ts`),
  });
  if (!result) throw new Error('ESLint tidak mengembalikan hasil.');
  // Make sure the fixture actually parses; parse errors have no ruleId.
  expect(result.messages.filter((message) => message.fatal)).toEqual([]);
  return result.messages;
}

function errorsOf(messages: ESLint.LintResult['messages'], ruleId: string) {
  return messages.filter((message) => message.ruleId === ruleId && message.severity === 2);
}

describe('BOARD-106: aturan lint arah impor', () => {
  it('semua package terdaftar dan teruji', () => {
    expect(ALL_PACKAGES).toContain('core');
    expect(ALL_PACKAGES.length).toBeGreaterThanOrEqual(12);
  });

  it('@kujam/core menolak impor @kujam/* lain, termasuk subpath', async () => {
    const messages = await lintFixtureAs('import-core.ts', 'core');
    const errors = errorsOf(messages, 'no-restricted-imports');
    expect(errors).toHaveLength(2);
    expect(errors[0]?.message).toContain('BOARD-106: @kujam/core adalah lapisan paling dalam');
  });

  it.each(ALL_PACKAGES.filter((pkg) => pkg !== 'core'))(
    '@kujam/%s boleh mengimpor @kujam/core',
    async (pkg) => {
      const messages = await lintFixtureAs('import-core.ts', pkg);
      expect(errorsOf(messages, 'no-restricted-imports')).toEqual([]);
    },
  );

  it.each(ALL_PACKAGES)('@kujam/renderer hanya boleh diimpor lapisan luar (%s)', async (pkg) => {
    const messages = await lintFixtureAs('import-renderer.ts', pkg);
    const errors = errorsOf(messages, 'no-restricted-imports');
    if (RENDERER_CONSUMERS.includes(pkg)) {
      expect(errors).toEqual([]);
    } else {
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain(
        pkg === 'core'
          ? 'BOARD-106: @kujam/core adalah lapisan paling dalam'
          : `BOARD-106: @kujam/${pkg} hanya boleh mengimpor`,
      );
    }
  });

  it.each(ALL_PACKAGES)('@kujam/%s tidak boleh mengimpor ui/react/vue/export', async (pkg) => {
    const messages = await lintFixtureAs('import-outer-layers.ts', pkg);
    expect(errorsOf(messages, 'no-restricted-imports')).toHaveLength(4);
  });
});

describe('BOARD-106: core bebas DOM', () => {
  it('lint menolak window, document, dan HTMLElement di core', async () => {
    const messages = await lintFixtureAs('core-dom-globals.ts', 'core');
    const errors = errorsOf(messages, 'no-restricted-globals');
    expect(errors.map((error) => error.message)).toEqual([
      expect.stringContaining(
        'BOARD-106: @kujam/core harus bebas DOM (tidak boleh mengakses window)',
      ),
      expect.stringContaining(
        'BOARD-106: @kujam/core harus bebas DOM (tidak boleh mengakses document)',
      ),
      expect.stringContaining('BOARD-106: @kujam/core harus bebas DOM.'),
    ]);
  });

  it('larangan DOM global hanya berlaku untuk core', async () => {
    const messages = await lintFixtureAs('core-dom-globals.ts', 'renderer');
    expect(errorsOf(messages, 'no-restricted-globals')).toEqual([]);
  });

  it('`lib` TypeScript core tanpa `dom`, sehingga `window` gagal typecheck', () => {
    const configPath = join(ROOT, 'packages/core/tsconfig.json');
    const { config, error } = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
    expect(error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dirname(configPath));
    const lib = parsed.options.lib ?? [];
    expect(lib.length).toBeGreaterThan(0);
    expect(lib.filter((name) => /dom/i.test(name))).toEqual([]);

    const fixture = join(FIXTURES, 'typecheck/core-uses-window.ts');
    const diagnosticsWith = (options: ts.CompilerOptions) =>
      ts
        .getPreEmitDiagnostics(ts.createProgram([fixture], options))
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    // Project options without project references/rootDir so fixtures outside src can be checked.
    const options: ts.CompilerOptions = {
      ...parsed.options,
      composite: false,
      rootDir: undefined,
      noEmit: true,
    };

    expect(diagnosticsWith(options)).toContain("Cannot find name 'window'.");
    // Control: with `dom`, the same fixture passes. The failure above is indeed caused by `lib`.
    expect(diagnosticsWith({ ...options, lib: [...lib, 'lib.dom.d.ts'] })).toEqual([]);
  });
});

describe('BOARD-107: istilah domain aplikasi', () => {
  it('lint menolak identifier berisi istilah domain', async () => {
    const messages = await lintFixtureAs('domain-terms.ts', 'shapes');
    const errors = errorsOf(messages, 'no-restricted-syntax');
    // Identifiers: postId (2), createCampaign (3), approvalStatus and BRAND_COLOR (4), TaskList (6).
    // Strings and template text: one per line from 9 to 14.
    expect(errors.map((error) => error.line)).toEqual([2, 3, 4, 4, 6, 9, 10, 11, 12, 13, 14]);
    expect(errors.every((error) => error.message.startsWith('BOARD-107: '))).toBe(true);
  });

  it('API platform, method HTTP POST, dan kata biasa yang memuat istilah tetap boleh', async () => {
    const messages = await lintFixtureAs('domain-terms-allowed.ts', 'core');
    expect(errorsOf(messages, 'no-restricted-syntax')).toEqual([]);
  });

  it('dokumentasi (docs/**) tidak di-lint, jadi resep boleh memakai contoh "kartu post"', async () => {
    expect(await eslint.isPathIgnored(join(ROOT, 'docs', 'resep-kartu-post.ts'))).toBe(true);
  });
});

describe('BOARD-102: inline dependensi @kujam/core', () => {
  it('package.json core tanpa dependencies dan peerDependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it('konfigurasi tsup core menghasilkan bundel ESM mandiri dari rbush, fractional-indexing, nanoid', async () => {
    // Inside the repo (not tmpdir) so the bundle can be loaded through the Vite/Vitest loader.
    const cacheDir = join(ROOT, 'node_modules/.cache');
    mkdirSync(cacheDir, { recursive: true });
    const outDir = mkdtempSync(join(cacheDir, 'kujam-core-inline-'));
    try {
      const config = coreTsupConfig as Options;
      await build({
        ...config,
        config: false,
        entry: { index: join(FIXTURES, 'build/core-inline-entry.ts') },
        outDir,
        dts: false,
        sourcemap: false,
        silent: true,
        esbuildOptions(options, context) {
          config.esbuildOptions?.(options, context);
          // The fixture lives outside packages/core; point resolution at core's devDependencies.
          options.nodePaths = [join(ROOT, 'packages/core/node_modules')];
        },
      });

      const output = readFileSync(join(outDir, 'index.js'), 'utf8');
      // No imports left: all three libraries (and their transitive dependencies) are bundled.
      expect(output).not.toMatch(/^\s*import\s/m);
      expect(output).not.toMatch(/\bfrom\s*["']/);
      expect(output).not.toMatch(/\brequire\(/);
      // nanoid's cross-runtime build (global Web Crypto), not the Node build that imports `crypto`.
      expect(output).toContain('crypto.getRandomValues');

      const mod = (await import(
        /* @vite-ignore */ pathToFileURL(join(outDir, 'index.js')).href
      )) as {
        probe(): [number, string, number];
      };
      expect(mod.probe()).toEqual([1, 'a0', 8]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});
