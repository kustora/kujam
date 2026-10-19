/* global process, console */
// Changeset lockstep configuration and PR diff verifier (BOARD-110).
//
// Verifies:
// 1. `.changeset/config.json` locks all publishable `@kujam/*` packages into a single `fixed` group.
// 2. Any PR/diff that modifies `packages/<pkg>/src/**` also includes a `.changeset/*.md` entry.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Returns all publishable `@kujam/*` package names discovered in `packages/<pkg>`.
 */
export function getPublishablePackageNames(rootDir = ROOT) {
  const packagesDir = join(rootDir, 'packages');
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')),
    )
    .map((entry) => {
      const pkgJson = JSON.parse(
        readFileSync(join(packagesDir, entry.name, 'package.json'), 'utf8'),
      );
      return pkgJson.name;
    })
    .sort();
}

/**
 * Validates that `.changeset/config.json` puts every publishable `@kujam/*` package
 * in a single `fixed` version group.
 */
export function verifyFixedChangesetConfig(rootDir = ROOT) {
  const configPath = join(rootDir, '.changeset', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const expectedPackages = getPublishablePackageNames(rootDir);
  const fixedGroups = Array.isArray(config.fixed) ? config.fixed : [];
  const primaryGroup = Array.isArray(fixedGroups[0]) ? [...fixedGroups[0]].sort() : [];

  const missing = expectedPackages.filter((name) => !primaryGroup.includes(name));
  const extra = primaryGroup.filter((name) => !expectedPackages.includes(name));

  return {
    valid: fixedGroups.length === 1 && missing.length === 0 && extra.length === 0,
    expectedPackages,
    configuredGroup: primaryGroup,
    missing,
    extra,
  };
}

/**
 * Evaluates a list of changed file paths (relative to repo root, POSIX slashes)
 * and checks whether modifications to `packages/<pkg>/src/` are accompanied by a changeset.
 *
 * @param {readonly string[]} changedFiles
 */
export function verifyChangesetForChangedFiles(changedFiles) {
  const normalized = changedFiles.map((file) => file.replace(/\\/g, '/').replace(/^\.\//, ''));

  const touchedSourceFiles = normalized.filter((file) =>
    /^packages\/[^/]+\/src\/.+/.test(file),
  );

  const touchedPackages = Array.from(
    new Set(
      touchedSourceFiles
        .map((file) => {
          const match = /^packages\/([^/]+)\/src\//.exec(file);
          return match ? `@kujam/${match[1]}` : null;
        })
        .filter(Boolean),
    ),
  ).sort();

  const changesetFiles = normalized.filter(
    (file) =>
      /^\.changeset\/[^/]+\.md$/.test(file) && file.toLowerCase() !== '.changeset/readme.md',
  );

  const requiresChangeset = touchedSourceFiles.length > 0;
  const hasChangeset = changesetFiles.length > 0;
  const ok = !requiresChangeset || hasChangeset;

  const warningMessage = ok
    ? null
    : `PR mengubah ${touchedSourceFiles.length} berkas di packages/*/src (${touchedPackages.join(', ')}) tanpa menyertakan berkas changeset (.changeset/*.md). Jalankan \`pnpm changeset\` untuk mencatat perubahan versi dan changelog.`;

  return {
    ok,
    requiresChangeset,
    hasChangeset,
    touchedSourceFiles,
    touchedPackages,
    changesetFiles,
    warningMessage,
  };
}

function getChangedFilesFromGit(baseRef) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  }
}

function main() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf('--base');
  const baseRef = baseIdx >= 0 && args[baseIdx + 1] ? args[baseIdx + 1] : 'origin/main';
  const strict = args.includes('--strict');

  const configCheck = verifyFixedChangesetConfig(ROOT);
  if (!configCheck.valid) {
    console.error(
      '[changeset-check] Konfigurasi .changeset/config.json tidak sinkron dengan daftar package @kujam/*:',
      configCheck,
    );
    process.exit(1);
  }

  const changedFiles = getChangedFilesFromGit(baseRef);
  const diffCheck = verifyChangesetForChangedFiles(changedFiles);

  if (!diffCheck.ok) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.warn(`::warning title=Changeset hilang::${diffCheck.warningMessage}`);
    } else {
      console.warn(`[changeset-check] Peringatan: ${diffCheck.warningMessage}`);
    }
    if (strict) {
      process.exit(1);
    }
  } else {
    console.log('[changeset-check] Pemeriksaan changeset lolos.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
