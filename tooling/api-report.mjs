/* global process, console */
/**
 * Public API report generator and verifier powered by @microsoft/api-extractor (BOARD-111).
 *
 * Usage:
 * - `node tooling/api-report.mjs --check`  (CI mode: fails if any `<pkg>.api.md` is out of date or any export lacks `@public`/`@beta`/`@internal`)
 * - `node tooling/api-report.mjs --update` (Local update mode: regenerates `<pkg>.api.md` for all packages)
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Extractor, ExtractorConfig, ExtractorLogLevel } from '@microsoft/api-extractor';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = join(ROOT, 'packages');

const require = createRequire(import.meta.url);
const typescriptCompilerFolder = dirname(require.resolve('typescript/package.json'));

/**
 * Discovers all publishable packages under `packages/*`.
 */
export function listPackageNames() {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(PACKAGES_DIR, entry.name, 'package.json')),
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * Runs API Extractor for a single package directory.
 *
 * @param {string} pkgDir - Absolute path to the package folder (or fixture folder).
 * @param {object} [options]
 * @param {boolean} [options.localBuild=false] - When true, updates `<pkg>.api.md` in place.
 * @param {string} [options.configPath] - Optional custom path to `api-extractor.json`.
 */
export function runExtractorForPackage(pkgDir, options = {}) {
  const { localBuild = false, configPath = join(pkgDir, 'api-extractor.json') } = options;
  const extractorConfig = ExtractorConfig.loadFileAndPrepare(configPath);

  mkdirSync(extractorConfig.reportTempFolder, { recursive: true });
  mkdirSync(extractorConfig.reportFolder, { recursive: true });

  const messages = [];
  const result = Extractor.invoke(extractorConfig, {
    localBuild,
    showVerboseMessages: false,
    typescriptCompilerFolder,
    messageCallback(message) {
      messages.push({
        messageId: message.messageId,
        logLevel: message.logLevel,
        text: message.text,
        sourceFilePath: message.sourceFilePath,
        sourceFileLine: message.sourceFileLine,
      });
      if (
        message.logLevel === ExtractorLogLevel.Error ||
        message.logLevel === ExtractorLogLevel.Warning
      ) {
        // Suppress default console spam when caller inspects `messages`, except in CLI mode.
        if (!options.silent) {
          message.handled = false;
        } else {
          message.handled = true;
        }
      } else {
        message.handled = true;
      }
    },
  });

  return {
    succeeded: result.succeeded,
    apiReportChanged: result.apiReportChanged,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    messages,
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const localBuild = args.has('--update') || args.has('-u');
  const packages = listPackageNames();

  let hasFailures = false;
  const changedPackages = [];

  for (const pkg of packages) {
    const pkgDir = join(PACKAGES_DIR, pkg);
    const dtsPath = join(pkgDir, 'dist', 'index.d.ts');
    if (!existsSync(dtsPath)) {
      console.error(
        `[api-report] File deklarasi tidak ditemukan: ${dtsPath}. Jalankan \`pnpm build\` terlebih dahulu.`,
      );
      process.exit(1);
    }

    const res = runExtractorForPackage(pkgDir, { localBuild, silent: false });
    if (res.apiReportChanged && !localBuild) {
      changedPackages.push(`@kujam/${pkg} (packages/${pkg}/${pkg}.api.md)`);
    }
    if (!res.succeeded) {
      hasFailures = true;
    }
  }

  if (changedPackages.length > 0) {
    console.error('\n[api-report] Laporan API publik berubah tetapi belum diperbarui/di-commit:');
    for (const item of changedPackages) {
      console.error(`  - ${item}`);
    }
    console.error('Jalankan `pnpm api:update` dan commit berkas `*.api.md` yang berubah.');
    process.exit(1);
  }

  if (hasFailures) {
    console.error(
      '\n[api-report] Pemeriksaan API publik gagal. Pastikan seluruh simbol yang diekspor memiliki tag rilis TSDoc (@public, @beta, atau @internal).',
    );
    process.exit(1);
  }

  console.log(
    `[api-report] ${localBuild ? 'Berhasil memperbarui' : 'Berhasil memverifikasi'} laporan API untuk ${packages.length} package.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
