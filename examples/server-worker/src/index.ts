/**
 * Demo of the board worker (BOARD-1805): builds a board with contact cards in a frame, stores its
 * Yjs state, then lets the worker validate it, index its references, and render a thumbnail.
 * A second save moves one card out of the frame and removes another, to show the placement diff.
 *
 * Run: `pnpm --filter @kujam/example-server-worker start`. The thumbnail is written to
 * `thumbnail.png` when `@napi-rs/canvas` is installed in this example.
 */

import { writeFileSync } from 'node:fs';
import { createBoard } from '@kujam/core';
import { contactCardPlugin } from '@kujam/example-contact-card';
import { defaultElements } from '@kujam/shapes';
import { documentToUpdate } from '@kujam/sync-yjs';
import { createMemoryStore } from './memory-store.js';
import { createBoardWorker, type BoardReport } from './worker.js';

const plugins = [defaultElements, contactCardPlugin];

function buildBoard() {
  const board = createBoard({ plugins });
  board.create({
    id: 'frame:team',
    type: 'frame',
    x: 0,
    y: 0,
    w: 700,
    h: 320,
    props: { name: 'Tim' },
  });
  for (const [i, contactId] of ['c-ani', 'c-budi', 'c-citra'].entries()) {
    board.create({
      id: `card:${contactId}`,
      type: 'contact-card',
      parentId: 'frame:team',
      x: 30 + i * 220,
      y: 60,
      w: 200,
      h: 96,
      props: { contactId },
    });
  }
  board.create({ type: 'sticky', x: 760, y: 40, w: 200, h: 200 });
  return board;
}

function print(report: BoardReport): void {
  if (report.status !== 'processed') {
    console.log(`[${report.boardId}] ${report.status}`, report);
    return;
  }
  const fmt = (refs: readonly { id: string; frameId?: string }[]) =>
    refs.map((r) => `${r.id}${r.frameId ? ` (di ${r.frameId})` : ''}`).join(', ') || '-';
  console.log(`[${report.boardId}] valid, record tidak valid: ${report.invalidRecords.length}`);
  console.log(`  penempatan baru  : ${fmt(report.placements.added)}`);
  console.log(`  penempatan hapus : ${fmt(report.placements.removed)}`);
  console.log(
    `  thumbnail        : ${report.thumbnail}` +
      (report.thumbnailError ? ` (${report.thumbnailError.split('.')[0]})` : ''),
  );
}

const store = createMemoryStore();
const worker = createBoardWorker({ store, plugins, debounceMs: 200, onReport: print });

const board = buildBoard();
// Three quick saves are processed once, after the board has been quiet for 200 ms.
for (let i = 0; i < 3; i++) {
  store.states.set('board-1', documentToUpdate(board.getDocument()));
  worker.enqueue('board-1');
}
await worker.flush();

// Move Budi out of the frame and remove Citra.
board.update('card:c-budi', { parentId: null, y: 400 });
board.delete(['card:c-citra']);
store.states.set('board-1', documentToUpdate(board.getDocument()));
await worker.process('board-1');

// A corrupted update is rejected before anything is indexed.
store.states.set('board-2', new Uint8Array([1, 2, 3, 4]));
await worker.process('board-2');

const png = store.thumbnails.get('board-1');
if (png) {
  writeFileSync(new URL('../thumbnail.png', import.meta.url), png);
  console.log('thumbnail.png ditulis.');
}
board.dispose();
