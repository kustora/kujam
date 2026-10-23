/* global process, console */
/**
 * Verifies that `CHANGELOG.md` and `docs/MIGRATION.md` exist and that every
 * `### [Breaking] ...` section in `docs/MIGRATION.md` includes both `#### Before`
 * and `#### After` sections with fenced code examples (BOARD-2206).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Parses markdown content of `docs/MIGRATION.md` (ignoring fenced markdown templates)
 * and checks that every `### [Breaking]` heading has both `#### Before` and `#### After`
 * subsections with code blocks.
 *
 * @param {string} markdown
 */
export function validateMigrationMarkdown(markdown) {
  // Strip outer 4-backtick or ```markdown template blocks so template examples are not confused with real entries.
  const withoutTemplates = markdown.replace(/```markdown[\s\S]*?```/g, '');

  const headingRegex = /^### \[Breaking\]\s+(.+)$/gm;
  const matches = [...withoutTemplates.matchAll(headingRegex)];

  const issues = [];
  const entries = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const title = current[1].trim();
    const startIdx = current.index + current[0].length;
    const nextSectionIdx =
      i + 1 < matches.length ? matches[i + 1].index : withoutTemplates.length;

    // Stop at next `## ` or `### ` heading if earlier than next `[Breaking]`
    const slice = withoutTemplates.slice(startIdx, nextSectionIdx);
    const nextH2 = slice.search(/^##\s+/m);
    const body = nextH2 >= 0 ? slice.slice(0, nextH2) : slice;

    const hasBeforeHeading = /^####\s+Before\b/m.test(body);
    const hasAfterHeading = /^####\s+After\b/m.test(body);

    const beforeMatch = /####\s+Before\b([\s\S]*?)(?=####\s+After\b|$)/.exec(body);
    const afterMatch = /####\s+After\b([\s\S]*?)$/.exec(body);

    const hasBeforeCode = Boolean(beforeMatch && /```[a-zA-Z]*\r?\n[\s\S]+?```/.test(beforeMatch[1]));
    const hasAfterCode = Boolean(afterMatch && /```[a-zA-Z]*\r?\n[\s\S]+?```/.test(afterMatch[1]));

    if (!hasBeforeHeading || !hasBeforeCode) {
      issues.push(
        `Section "[Breaking] ${title}" has no "#### Before" subsection with a code example.`,
      );
    }
    if (!hasAfterHeading || !hasAfterCode) {
      issues.push(
        `Section "[Breaking] ${title}" has no "#### After" subsection with a code example.`,
      );
    }

    entries.push({
      title,
      hasBeforeHeading,
      hasBeforeCode,
      hasAfterHeading,
      hasAfterCode,
    });
  }

  if (entries.length === 0) {
    issues.push('No "### [Breaking] ..." section found in docs/MIGRATION.md.');
  }

  return {
    valid: issues.length === 0,
    entries,
    issues,
  };
}

export function verifyChangelogAndMigrationFiles(rootDir = ROOT) {
  const changelogPath = join(rootDir, 'CHANGELOG.md');
  const migrationPath = join(rootDir, 'docs', 'MIGRATION.md');

  if (!existsSync(changelogPath)) {
    return { valid: false, entries: [], issues: ['CHANGELOG.md not found.'] };
  }
  if (!existsSync(migrationPath)) {
    return { valid: false, entries: [], issues: ['docs/MIGRATION.md not found.'] };
  }

  const changelogContent = readFileSync(changelogPath, 'utf8');
  const migrationContent = readFileSync(migrationPath, 'utf8');

  const result = validateMigrationMarkdown(migrationContent);
  if (!changelogContent.includes('docs/MIGRATION.md')) {
    result.issues.push('CHANGELOG.md must link to docs/MIGRATION.md.');
    result.valid = false;
  }

  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = verifyChangelogAndMigrationFiles(ROOT);
  if (!res.valid) {
    console.error('[migration-docs] Migration guide check failed:');
    for (const issue of res.issues) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }
  console.log(
    `[migration-docs] Valid (${res.entries.length} breaking change entries with Before and After code).`,
  );
}
