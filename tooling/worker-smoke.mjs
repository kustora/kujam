/* global process, console, URL, Worker, setTimeout, clearTimeout */
// BOARD-103: smoke test of @kujam/core in a real Web Worker (headless Chromium via Playwright).
// It loads the release artifact `packages/core/dist/index.js` as-is, without a bundler:
// if dist still imports other packages (BOARD-102) or touches the DOM on load, the test fails.
//
// Usage: pnpm test:worker (builds core first, then runs this script).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIST = join(ROOT, 'packages/core/dist/index.js');
const ORIGIN = 'http://kujam.test';
const TIMEOUT_MS = 15_000;

// Runs inside the Worker. Reports results to the page via postMessage.
const WORKER_SOURCE = `
const env = {
  hasWindow: typeof window !== 'undefined',
  hasDocument: typeof document !== 'undefined',
  isWorkerScope:
    typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope,
};
try {
  const core = await import('./core.js');
  const board = core.createBoard();
  const doc = board.getDocument();
  const result = {
    ok: true,
    env,
    exports: Object.keys(core).sort(),
    recordIds: Object.keys(doc.records),
    frozen: Object.isFrozen(doc),
  };
  board.dispose();
  postMessage(result);
} catch (error) {
  postMessage({ ok: false, env, error: String((error && error.stack) || error) });
}
`;

const PAGE_SOURCE = '<!doctype html><meta charset="utf-8"><title>kujam worker smoke</title>';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

if (!existsSync(CORE_DIST)) {
  console.error(`✗ ${CORE_DIST} belum ada. Jalankan build core dulu (pnpm test:worker).`);
  process.exit(1);
}

const coreSource = readFileSync(CORE_DIST, 'utf8');
// BOARD-102: core dist must be self-contained. Module workers cannot resolve bare specifiers.
const leftoverImports = coreSource.match(/^\s*import\s.*$|\bfrom\s*["'][^"']+["']/gm) ?? [];
if (leftoverImports.length > 0) {
  fail(`dist core masih punya impor: ${leftoverImports.join(' | ')}`);
}

const files = {
  '/': { type: 'text/html', body: PAGE_SOURCE },
  '/core.js': { type: 'text/javascript', body: coreSource },
  '/worker.js': { type: 'text/javascript', body: WORKER_SOURCE },
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = files[new URL(route.request().url()).pathname];
    return file
      ? route.fulfill({ status: 200, contentType: file.type, body: file.body })
      : route.fulfill({ status: 404, body: 'not found' });
  });
  await page.goto(`${ORIGIN}/`);

  const report = await page.evaluate(
    (timeoutMs) =>
      new Promise((done) => {
        const worker = new Worker('/worker.js', { type: 'module' });
        const timer = setTimeout(
          () => done({ ok: false, error: `Worker tidak membalas dalam ${timeoutMs} ms` }),
          timeoutMs,
        );
        worker.addEventListener('message', (event) => {
          clearTimeout(timer);
          worker.terminate();
          done(event.data);
        });
        worker.addEventListener('error', (event) => {
          clearTimeout(timer);
          worker.terminate();
          done({ ok: false, error: `error di Worker: ${event.message || 'gagal memuat modul'}` });
        });
      }),
    TIMEOUT_MS,
  );

  if (!report.ok) {
    fail(`core gagal di Web Worker: ${report.error}`);
  } else {
    if (!report.env.isWorkerScope) fail('skrip tidak berjalan di WorkerGlobalScope');
    if (report.env.hasWindow || report.env.hasDocument) fail('Worker tidak semestinya punya DOM');
    if (!report.exports.includes('createBoard')) fail('createBoard tidak diekspor');
    if (report.recordIds.length === 0) fail('dokumen papan baru kosong tanpa halaman');
    if (!report.frozen) fail('snapshot dokumen tidak dibekukan');
  }

  if (!process.exitCode) {
    console.log(
      `✓ @kujam/core dimuat dan createBoard() jalan di Web Worker Chromium ${browser.version()} ` +
        `(${report.exports.length} ekspor, record: ${report.recordIds.join(', ')})`,
    );
  }
} finally {
  await browser.close();
}
