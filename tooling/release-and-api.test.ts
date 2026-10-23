/**
 * Tooling tests for versioning, API Extractor reports, deprecation policy, and migration guides:
 * - BOARD-110: fixed Changesets group, release/PR workflows, and PR diff changeset enforcement.
 * - BOARD-111: per-package `*.api.md` reports, CI drift failure, and TSDoc release tag enforcement (`ae-missing-release-tag`).
 * - BOARD-2206: `CHANGELOG.md` and `docs/MIGRATION.md` breaking-change before/after code block validation.
 * - BOARD-2301: API tag policy and minimum one-minor-release deprecation rule in `ADR-002`.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- untyped ESM tooling script
import { listPackageNames, runExtractorForPackage } from './api-report.mjs';
import {
  getPublishablePackageNames,
  verifyChangesetForChangedFiles,
  verifyFixedChangesetConfig,
  // @ts-expect-error -- untyped ESM tooling script
} from './check-changeset.mjs';
import {
  validateMigrationMarkdown,
  verifyChangelogAndMigrationFiles,
  // @ts-expect-error -- untyped ESM tooling script
} from './check-migration-docs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('BOARD-110: Changesets untuk versi serentak dan changelog', () => {
  it('mengunci seluruh 12 package @kujam/* dalam satu grup fixed di .changeset/config.json', () => {
    const result = verifyFixedChangesetConfig(ROOT);
    expect(result.valid).toBe(true);
    expect(result.expectedPackages).toHaveLength(12);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('memperingatkan PR yang mengubah packages/*/src tanpa berkas changeset', () => {
    const withoutChangeset = verifyChangesetForChangedFiles([
      'packages/core/src/index.ts',
      'packages/shapes/src/tools/draw.ts',
    ]);
    expect(withoutChangeset.ok).toBe(false);
    expect(withoutChangeset.requiresChangeset).toBe(true);
    expect(withoutChangeset.hasChangeset).toBe(false);
    expect(withoutChangeset.touchedPackages).toEqual(['@kujam/core', '@kujam/shapes']);
    expect(withoutChangeset.warningMessage).toContain('tanpa menyertakan berkas changeset');

    // README.md inside .changeset does not count as a release changeset.
    const onlyReadme = verifyChangesetForChangedFiles([
      'packages/core/src/index.ts',
      '.changeset/README.md',
    ]);
    expect(onlyReadme.ok).toBe(false);

    // Adding a real .changeset/*.md file satisfies the check.
    const withChangeset = verifyChangesetForChangedFiles([
      'packages/core/src/index.ts',
      '.changeset/core-new-api.md',
    ]);
    expect(withChangeset.ok).toBe(true);
    expect(withChangeset.hasChangeset).toBe(true);
    expect(withChangeset.warningMessage).toBeNull();

    // Changes outside packages/*/src (such as docs or playground) do not require a changeset.
    const docsOnly = verifyChangesetForChangedFiles([
      'docs/MIGRATION.md',
      'apps/playground/src/main.ts',
    ]);
    expect(docsOnly.ok).toBe(true);
    expect(docsOnly.requiresChangeset).toBe(false);
  });

  it('menyediakan workflow CI rilis dan pemeriksaan changeset PR', () => {
    const releaseWorkflow = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(releaseWorkflow).toContain('changesets/action@v1');
    expect(releaseWorkflow).toContain('pnpm version-packages');
    expect(releaseWorkflow).toContain('pnpm release');

    const prWorkflow = readFileSync(join(ROOT, '.github/workflows/changeset-check.yml'), 'utf8');
    expect(prWorkflow).toContain('node tooling/check-changeset.mjs');
    expect(prWorkflow).toContain('pnpm api:check');
  });
});

describe('BOARD-111: api-extractor laporan API publik per package', () => {
  const packages: string[] = listPackageNames();

  it('setiap package memiliki api-extractor.json dan berkas <pkg>.api.md', () => {
    expect(packages).toHaveLength(getPublishablePackageNames(ROOT).length);
    for (const pkg of packages) {
      const apiReportPath = join(ROOT, 'packages', pkg, `${pkg}.api.md`);
      const configPath = join(ROOT, 'packages', pkg, 'api-extractor.json');
      expect(existsSync(configPath), `Missing ${configPath}`).toBe(true);
      expect(existsSync(apiReportPath), `Missing ${apiReportPath}`).toBe(true);
      const report = readFileSync(apiReportPath, 'utf8');
      expect(report).toContain(`## API Report File for "@kujam/${pkg}"`);
    }
  });

  it('semua laporan *.api.md sinkron dengan deklarasi dist/index.d.ts dan bebas error tag TSDoc', () => {
    for (const pkg of packages) {
      const pkgDir = join(ROOT, 'packages', pkg);
      const res = runExtractorForPackage(pkgDir, { localBuild: false, silent: true });
      expect(res.errorCount, `@kujam/${pkg} has API Extractor errors`).toBe(0);
      expect(res.apiReportChanged, `@kujam/${pkg} API report is out of sync`).toBe(false);
      expect(res.succeeded, `@kujam/${pkg} API Extractor check failed`).toBe(true);
    }
  }, 30_000);

  it('menolak ekspor tanpa tag rilis TSDoc (@public, @beta, @internal) dan gagal bila *.api.md berubah tanpa di-commit', () => {
    const cacheDir = join(ROOT, 'node_modules/.cache');
    mkdirSync(cacheDir, { recursive: true });
    const tempPkgDir = mkdtempSync(join(cacheDir, 'kujam-api-extractor-fixture-'));

    try {
      mkdirSync(join(tempPkgDir, 'dist'), { recursive: true });
      writeFileSync(
        join(tempPkgDir, 'package.json'),
        JSON.stringify({ name: '@kujam/fixture', version: '0.1.0' }, null, 2),
      );
      writeFileSync(
        join(tempPkgDir, 'tsconfig.json'),
        JSON.stringify(
          {
            extends: join(ROOT, 'tsconfig.base.json'),
            compilerOptions: { rootDir: './dist' },
            include: ['dist/**/*.d.ts'],
            exclude: ['node_modules'],
          },
          null,
          2,
        ),
      );
      writeFileSync(
        join(tempPkgDir, 'api-extractor.json'),
        JSON.stringify(
          {
            extends: join(ROOT, 'tooling/api-extractor.base.json'),
            mainEntryPointFilePath: '<projectFolder>/dist/index.d.ts',
            apiReport: {
              enabled: true,
              reportFileName: 'fixture.api.md',
              reportFolder: '<projectFolder>',
              reportTempFolder: '<projectFolder>/temp',
            },
          },
          null,
          2,
        ),
      );

      // 1. Export without TSDoc release tag must fail with ae-missing-release-tag.
      writeFileSync(
        join(tempPkgDir, 'dist', 'index.d.ts'),
        '/** Function missing release tag. */\nexport declare function untaggedFn(): void;\n',
      );
      const untaggedRes = runExtractorForPackage(tempPkgDir, { localBuild: true, silent: true });
      expect(untaggedRes.succeeded).toBe(false);
      expect(untaggedRes.errorCount).toBeGreaterThan(0);
      expect(
        untaggedRes.messages.some(
          (m: { messageId?: string }) => m.messageId === 'ae-missing-release-tag',
        ),
      ).toBe(true);

      // 2. Adding @public allows localBuild: true to generate fixture.api.md cleanly.
      writeFileSync(
        join(tempPkgDir, 'dist', 'index.d.ts'),
        '/** Tagged function.\n * @public\n */\nexport declare function taggedFn(): void;\n',
      );
      const validRes = runExtractorForPackage(tempPkgDir, { localBuild: true, silent: true });
      expect(validRes.succeeded).toBe(true);
      expect(validRes.errorCount).toBe(0);

      // 3. Changing signature without updating fixture.api.md causes CI mode (localBuild: false) to fail.
      writeFileSync(
        join(tempPkgDir, 'dist', 'index.d.ts'),
        '/** Tagged function.\n * @public\n */\nexport declare function taggedFn(newParam: string): void;\n',
      );
      const driftRes = runExtractorForPackage(tempPkgDir, { localBuild: false, silent: true });
      expect(driftRes.apiReportChanged).toBe(true);
      expect(driftRes.succeeded).toBe(false);
    } finally {
      rmSync(tempPkgDir, { recursive: true, force: true });
    }
  });
});

describe('BOARD-2206 & BOARD-2301: Changelog, panduan migrasi, dan kebijakan deprecation', () => {
  it('CHANGELOG.md dan docs/MIGRATION.md valid dengan contoh kode Before & After', () => {
    const res = verifyChangelogAndMigrationFiles(ROOT);
    expect(res.issues).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.entries.length).toBeGreaterThanOrEqual(2);
  });

  it('validator panduan migrasi menolak bagian [Breaking] yang tidak punya kode Before atau After', () => {
    const missingAfter = validateMigrationMarkdown(`
## Rilis 0.2.0

### [Breaking] Perubahan Tanda Tangan createBoard

#### Before

\`\`\`ts
createBoard();
\`\`\`
`);
    expect(missingAfter.valid).toBe(false);
    expect(missingAfter.issues[0]).toContain('#### After');

    const complete = validateMigrationMarkdown(`
## Rilis 0.2.0

### [Breaking] Perubahan Tanda Tangan createBoard

#### Before

\`\`\`ts
createBoard(oldArg);
\`\`\`

#### After

\`\`\`ts
createBoard({ newArg });
\`\`\`
`);
    expect(complete.valid).toBe(true);
    expect(complete.issues).toEqual([]);
  });

  it('ADR-002 mencatat kebijakan tag API dan aturan deprecation minimal satu rilis minor (BOARD-2301)', () => {
    const adr = readFileSync(
      join(ROOT, 'docs/adr/ADR-002-technical-owner-and-api-review.md'),
      'utf8',
    );
    expect(adr).toContain('BOARD-2301');
    expect(adr).toContain('deprecate(message)');
    expect(adr).toContain('minimal satu rilis minor');
  });
});
