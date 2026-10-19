/**
 * Security and Zero-Telemetry Audit (BOARD-2005).
 *
 * Verifies that the whiteboard packages (@kujam/core, @kujam/renderer, @kujam/shapes)
 * operate completely offline and standalone without any telemetry, analytics,
 * unauthorized outbound network calls, or hidden tracking pings.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  createBoard,
  defaultCommands,
  defineElement,
  definePlugin,
  object,
  string,
  type Board,
} from './index.js';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGES_ROOT = resolve(CURRENT_DIR, '../..');

/** Directories audited for zero-telemetry and offline guarantees. */
const AUDITED_PACKAGES = ['core', 'renderer', 'shapes'];

/**
 * Recursively collects TypeScript source files from a directory,
 * excluding test files and type declaration files.
 */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test-d.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Removes both single-line and multi-line comments from source code
 * so that documentation or explanatory notes do not trigger false positives.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

interface SecurityRule {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

const BANNED_PATTERNS: readonly SecurityRule[] = Object.freeze([
  {
    id: 'banned-fetch',
    description: 'Panggilan fetch tidak diizinkan di modul inti papan',
    pattern: /\b(?:globalThis\.)?fetch\s*\(/,
  },
  {
    id: 'banned-websocket',
    description: 'Instansiasi WebSocket tidak diizinkan di modul inti papan',
    pattern: /\bnew\s+WebSocket\s*\(/,
  },
  {
    id: 'banned-xhr',
    description: 'Instansiasi XMLHttpRequest tidak diizinkan di modul inti papan',
    pattern: /\bnew\s+XMLHttpRequest\s*\(/,
  },
  {
    id: 'banned-beacon',
    description: 'Panggilan sendBeacon tidak diizinkan',
    pattern: /\bsendBeacon\s*\(/,
  },
  {
    id: 'banned-telemetry-endpoint',
    description: 'Endpoint telemetri dilarang keras',
    pattern: /https?:\/\/[^\s'"`]+\/telemetry/i,
  },
  {
    id: 'banned-google-analytics',
    description: 'Skrip atau endpoint Google Analytics dilarang',
    pattern: /google-analytics\.com|googletagmanager\.com/i,
  },
  {
    id: 'banned-mixpanel',
    description: 'Endpoint Mixpanel dilarang',
    pattern: /mixpanel\.com/i,
  },
  {
    id: 'banned-segment',
    description: 'Endpoint Segment analytics dilarang',
    pattern: /segment\.io|segment\.com/i,
  },
  {
    id: 'banned-sentry',
    description: 'Endpoint Sentry telemetry dilarang',
    pattern: /sentry\.io/i,
  },
  {
    id: 'banned-amplitude',
    description: 'Endpoint Amplitude analytics dilarang',
    pattern: /amplitude\.com/i,
  },
  {
    id: 'banned-hotjar',
    description: 'Endpoint Hotjar analytics dilarang',
    pattern: /hotjar\.com/i,
  },
  {
    id: 'banned-statsig',
    description: 'Endpoint Statsig telemetry dilarang',
    pattern: /statsig\.com/i,
  },
]);

describe('BOARD-2005: Audit Tanpa Telemetri & Keamanan Mandiri', () => {
  it('semua package inti, renderer, dan shapes memiliki berkas sumber yang dipindai', () => {
    for (const pkg of AUDITED_PACKAGES) {
      const pkgSrc = join(PACKAGES_ROOT, pkg, 'src');
      const files = collectSourceFiles(pkgSrc);
      expect(files.length).toBeGreaterThan(0);
    }
  });

  it('memastikan NOL panggilan jaringan atau telemetri tersembunyi di kode sumber', () => {
    const violations: Array<{ file: string; rule: string; matched: string }> = [];

    for (const pkg of AUDITED_PACKAGES) {
      const pkgSrc = join(PACKAGES_ROOT, pkg, 'src');
      const files = collectSourceFiles(pkgSrc);

      for (const file of files) {
        const rawContent = readFileSync(file, 'utf8');
        const codeOnly = stripComments(rawContent);

        for (const rule of BANNED_PATTERNS) {
          const match = rule.pattern.exec(codeOnly);
          if (match) {
            violations.push({
              file: file.replace(PACKAGES_ROOT, 'packages'),
              rule: rule.id,
              matched: match[0],
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('memverifikasi 0 permintaan jaringan dalam siklus hidup papan offline / mandiri', () => {
    // Monitor all possible global dispatchers
    const networkCalls: string[] = [];

    const originalFetch = globalThis.fetch;
    if (typeof originalFetch === 'function') {
      vi.spyOn(globalThis, 'fetch').mockImplementation((input: unknown) => {
        networkCalls.push(String(input));
        return Promise.reject(new Error('Network offline blocked'));
      });
    }

    const simpleNote = defineElement({
      type: 'simple-note',
      version: 1,
      props: object({ text: string() }),
      defaults: { text: '' },
    });

    const mockPlugin = definePlugin({
      id: 'mock-offline-plugin',
      elements: [simpleNote],
    });

    const board: Board = createBoard({
      plugins: [mockPlugin, defaultCommands],
    });

    // 1. Create elements
    board.create({
      id: 'item-1',
      type: 'simple-note',
      x: 100,
      y: 100,
      w: 200,
      h: 200,
      props: { text: 'Halo Mandiri' },
    });

    board.create({
      id: 'item-2',
      type: 'simple-note',
      x: 350,
      y: 100,
      w: 150,
      h: 150,
      props: { text: 'Tanpa Telemetri' },
    });

    // 2. Query spatial index
    const found = board.query({ inBounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 } });
    expect(found.length).toBe(2);

    // 3. Selection & Camera operations
    board.select(['item-1', 'item-2']);
    expect(board.selection).toEqual(['item-1', 'item-2']);

    board.camera.setViewport({ width: 800, height: 600 });
    board.camera.zoomToFit();
    board.camera.set({ x: 200, y: 150, zoom: 1.5 });

    // 4. Update elements
    board.update('item-1', { x: 120, y: 130 });
    expect(board.getElement('item-1')?.x).toBe(120);

    // 5. Undo and Redo
    board.undo();
    expect(board.getElement('item-1')?.x).toBe(100);
    board.redo();
    expect(board.getElement('item-1')?.x).toBe(120);

    // 6. Delete element
    board.delete(['item-2']);
    expect(board.getElement('item-2')).toBeUndefined();

    // Verify 0 outbound requests occurred
    expect(networkCalls).toEqual([]);

    board.dispose();
  });
});
