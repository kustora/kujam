/**
 * Tes tooling untuk aturan arsitektur dan build:
 * - BOARD-106: aturan lint arah impor dan larangan DOM di core terbukti menolak fixture pelanggaran.
 * - BOARD-106: `lib` TypeScript core tanpa `dom`, sehingga `window` gagal typecheck.
 * - BOARD-107: istilah domain aplikasi ditolak lint.
 * - BOARD-102: konfigurasi tsup core benar-benar meng-inline rbush, fractional-indexing, dan nanoid.
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

/** Package yang boleh mengimpor @kujam/renderer (core <- renderer <- ui/react/vue/export). */
const RENDERER_CONSUMERS = ['ui', 'react', 'vue', 'export'];

const eslint = new ESLint({ cwd: ROOT });

/** Lint isi fixture seolah-olah berkas itu berada di `packages/<pkg>/src/`. */
async function lintFixtureAs(fixture: string, pkg: string) {
  const code = readFileSync(join(FIXTURES, 'lint', fixture), 'utf8');
  const [result] = await eslint.lintText(code, {
    filePath: join(ROOT, 'packages', pkg, 'src', `__lint_fixture__.ts`),
  });
  if (!result) throw new Error('ESLint tidak mengembalikan hasil.');
  // Pastikan fixture benar-benar terparse; error parse tidak punya ruleId.
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
    // Opsi proyek tanpa project references/rootDir agar fixture di luar src bisa diperiksa.
    const options: ts.CompilerOptions = {
      ...parsed.options,
      composite: false,
      rootDir: undefined,
      noEmit: true,
    };

    expect(diagnosticsWith(options)).toContain("Cannot find name 'window'.");
    // Kontrol: dengan `dom`, fixture yang sama lolos. Kegagalan di atas memang karena `lib`.
    expect(diagnosticsWith({ ...options, lib: [...lib, 'lib.dom.d.ts'] })).toEqual([]);
  });
});

describe('BOARD-107: istilah domain aplikasi', () => {
  it('lint menolak identifier berisi istilah domain', async () => {
    const messages = await lintFixtureAs('domain-terms.ts', 'shapes');
    const errors = errorsOf(messages, 'no-restricted-syntax');
    // postId, createCampaign, approvalStatus, BRAND_COLOR, TaskList
    expect(errors).toHaveLength(5);
    expect(errors[0]?.message).toContain('BOARD-107: ');
  });

  it('API platform seperti postMessage tetap boleh', async () => {
    const messages = await lintFixtureAs('domain-terms-allowed.ts', 'core');
    expect(errorsOf(messages, 'no-restricted-syntax')).toEqual([]);
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
    // Di dalam repo (bukan tmpdir) agar bundel bisa dimuat lewat loader Vite/Vitest.
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
          // Fixture berada di luar packages/core; arahkan resolusi ke devDependencies core.
          options.nodePaths = [join(ROOT, 'packages/core/node_modules')];
        },
      });

      const output = readFileSync(join(outDir, 'index.js'), 'utf8');
      // Tidak ada impor tersisa: ketiga library (dan dependensi transitifnya) ikut dibundel.
      expect(output).not.toMatch(/^\s*import\s/m);
      expect(output).not.toMatch(/\bfrom\s*["']/);
      expect(output).not.toMatch(/\brequire\(/);
      // Build lintas-runtime nanoid (Web Crypto global), bukan build Node yang mengimpor `crypto`.
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
