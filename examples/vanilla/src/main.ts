import { attachStorage, createBoard, defaultCommands } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { attachTextEditor, defaultElements, defaultTools } from '@kujam/shapes';
import { createIndexedDbStorage } from '@kujam/storage-indexeddb';
import { mountDefaultUi } from '@kujam/ui';

// 1. Board with the built-in commands (shortcuts and keyboard navigation), elements, and tools.
const board = createBoard({
  locale: 'id',
  plugins: [defaultCommands, defaultElements, defaultTools],
});
board.setTool('select');

// 2. Mount the renderer into a sized element, with the inline text editor (double click or Enter).
const container = document.getElementById('board')!;
const view = mountRenderer(board, container, { theme: 'light' });
attachTextEditor(view);

// 3. Load from IndexedDB, then save automatically after every change (debounced).
const adapter = createIndexedDbStorage({ databaseName: 'kujam-example-vanilla' });
const storage = attachStorage(board, adapter, { boardId: 'contoh-vanilla' });

// 4. The UI from @kujam/ui: toolbar, zoom, and undo/redo floating over the board.
mountDefaultUi({ board, container });

// Save status badge.
const status = document.getElementById('status')!;
const show = (text: string) => {
  status.textContent = text;
};
board.on('change', (e) => {
  if (e.origin !== 'load' && e.origin !== 'remote') show('Belum tersimpan');
});
storage.on('save:start', () => show('Menyimpan...'));
storage.on('save:success', () => show('Tersimpan'));
storage.on('save:error', (e) =>
  show(e.willRetry ? 'Gagal menyimpan, mencoba lagi...' : 'Gagal menyimpan'),
);
storage.ready.then(
  async () => {
    const mode = await adapter.mode();
    show(mode === 'indexeddb' ? 'Tersimpan' : 'Mode memori: tidak tersimpan setelah muat ulang');
  },
  () => show('Gagal memuat papan'),
);
