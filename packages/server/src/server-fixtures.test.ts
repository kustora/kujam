// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  createEmptyDocument,
  definePlugin,
  type BoardDocument,
} from '@kujam/core';
import { documentToUpdate } from '@kujam/sync-yjs';
import {
  extractReferences,
  migrateServerBatch,
  migrateServerDocument,
  renderThumbnail,
  validateServerDocument,
} from './index.js';

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/documents');

function findJson(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? findJson(full) : entry.endsWith('.json') ? [full] : [];
  });
}

const fixtures = findJson(FIXTURES_DIR).map((path) => ({
  name: path.slice(FIXTURES_DIR.length + 1),
  doc: JSON.parse(readFileSync(path, 'utf8')) as BoardDocument,
}));

/** Plugin whose document migration marks the document, to observe that migration ran. */
function auditPlugin(step = vi.fn((d: BoardDocument) => ({ ...d, meta: { ...d.meta, audited: true } }))) {
  return { step, plugin: definePlugin({ id: 'audit', migrations: { 0: step } }) };
}

describe('BOARD-1806: server functions on release fixtures (pure Node)', () => {
  it('has no DOM globals in this environment', () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
  });

  it('finds the release fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('fixture $name', ({ doc }) => {
    it('validates (relaxed and from binary)', () => {
      expect(validateServerDocument(doc).valid).toBe(true);
      expect(validateServerDocument(documentToUpdate(doc)).valid).toBe(true);
    });

    it('migrates to the current schema and is stable on a second run', () => {
      const first = migrateServerDocument(doc);
      expect(first.toVersion).toBe(CURRENT_SCHEMA_VERSION);
      const second = migrateServerDocument(first.document);
      expect(second.changed).toBe(false);
    });

    it('extracts references without throwing', () => {
      expect(Array.isArray(extractReferences(doc))).toBe(true);
    });

    it('renders a thumbnail with an injected canvas', async () => {
      const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
      const out = await renderThumbnail(doc, {
        width: 200,
        canvasFactory: (w, h) => ({
          canvas: { width: w, height: h, toBuffer: () => Buffer.from('x') },
          ctx,
        }),
      });
      expect(out.byteLength).toBeGreaterThan(0);
    });
  });
});

describe('BOARD-705: migrateServerDocument', () => {
  it('runs plugin migrations on JSON, using the client pipeline', () => {
    const { plugin, step } = auditPlugin();
    // Recorded plugin version 0 means the step still has to run.
    const old: BoardDocument = { ...createEmptyDocument(), pluginVersions: { audit: 0 } };
    const result = migrateServerDocument(old, { plugins: [plugin] });
    expect(step).toHaveBeenCalledTimes(1);
    expect(result.changed).toBe(true);
    expect(result.document.meta).toMatchObject({ audited: true });
    expect(result.document.pluginVersions).toEqual({ audit: 1 });
    expect(result.update).toBeUndefined();
  });

  it('migrates binary Yjs input and returns a migrated binary update', () => {
    const { plugin } = auditPlugin();
    const old: BoardDocument = { ...createEmptyDocument(), pluginVersions: { audit: 0 } };
    const result = migrateServerDocument(documentToUpdate(old), { plugins: [plugin] });
    expect(result.changed).toBe(true);
    expect(result.update).toBeInstanceOf(Uint8Array);
    // The binary result round-trips to the migrated document.
    const again = migrateServerDocument(result.update!, { plugins: [plugin] });
    expect(again.changed).toBe(false);
  });

  it('reports unchanged when the document is already current', () => {
    const result = migrateServerDocument(createEmptyDocument());
    expect(result.changed).toBe(false);
    expect(result.fromVersion).toBe(result.toVersion);
  });

  it('rejects a document newer than the server understands', () => {
    const tooNew = { ...createEmptyDocument(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(() => migrateServerDocument(tooNew)).toThrow();
  });
});

describe('BOARD-705: migrateServerBatch', () => {
  const { plugin } = auditPlugin();
  const stale = (): BoardDocument => ({ ...createEmptyDocument(), pluginVersions: { audit: 0 } });
  const items = () => [
    { id: 'stale', data: stale() },
    { id: 'current', data: { ...createEmptyDocument(), pluginVersions: { audit: 1 } } },
    { id: 'broken', data: { nope: true } as unknown as BoardDocument },
  ];

  it('dry-run reports changes but never persists', async () => {
    const onMigrated = vi.fn();
    const report = await migrateServerBatch(items(), { plugins: [plugin], dryRun: true, onMigrated });
    expect(report).toMatchObject({ dryRun: true, total: 3, migrated: 1, unchanged: 1, failed: 1 });
    expect(onMigrated).not.toHaveBeenCalled();
  });

  it('persists changed items through onMigrated and isolates failures', async () => {
    const saved: string[] = [];
    const report = await migrateServerBatch(items(), {
      plugins: [plugin],
      onMigrated: (id) => {
        saved.push(id);
      },
    });
    expect(saved).toEqual(['stale']);
    expect(report.entries.map((e) => [e.id, e.status])).toEqual([
      ['stale', 'migrated'],
      ['current', 'unchanged'],
      ['broken', 'failed'],
    ]);
    expect(report.entries[2]?.error).toBeTruthy();
  });
});
