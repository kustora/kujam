import { attachStorage, createBoard, type Board } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { defaultElements, defaultTools } from '@kujam/shapes';
import { createIndexedDbStorage } from '@kujam/storage-indexeddb';
import { mountDefaultUi } from '@kujam/ui';

// 1. Board with the built-in elements and tools.
const board = createBoard({ locale: 'id', plugins: [defaultElements, defaultTools] });
board.setTool('select');

// 2. Mount the renderer into a sized element.
const container = document.getElementById('board')!;
mountRenderer(board, container, { theme: 'light' });

// 3. Load from IndexedDB, then save automatically after every change (debounced).
const adapter = createIndexedDbStorage({ databaseName: 'kujam-example-vanilla' });
const storage = attachStorage(board, adapter, { boardId: 'contoh-vanilla' });

// 4. The toolbar from @kujam/ui, floating at the bottom center.
mountDefaultUi({ board, container });

// History and zoom buttons on the public board API.
// TODO(BOARD-1404): replace with the zoom and undo controls from @kujam/ui.
mountHistoryControls(board, document.getElementById('controls')!);

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

function mountHistoryControls(board: Board, root: HTMLElement): void {
  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', onClick);
    root.append(el);
    return el;
  };
  const undo = button('Urungkan', () => board.undo());
  const redo = button('Ulangi', () => board.redo());
  const zoom = button('100%', () => board.camera.zoomTo(1));
  zoom.title = 'Kembali ke 100%';

  const syncHistory = () => {
    undo.disabled = !board.history.canUndo;
    redo.disabled = !board.history.canRedo;
  };
  const syncZoom = () => {
    zoom.textContent = `${Math.round(board.camera.get().zoom * 100)}%`;
  };
  board.on('history', syncHistory);
  board.on('camera', syncZoom);
  syncHistory();
  syncZoom();
}
