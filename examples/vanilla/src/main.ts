import { attachStorage, createBoard, type Board } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { defaultElements, defaultTools } from '@kujam/shapes';
import { createIndexedDbStorage } from '@kujam/storage-indexeddb';

const TOOLS: readonly (readonly [id: string, label: string])[] = [
  ['select', 'Pilih'],
  ['hand', 'Tangan'],
  ['sticky', 'Sticky'],
  ['draw', 'Pena'],
  ['text', 'Teks'],
  ['rectangle', 'Kotak'],
  ['eraser', 'Hapus'],
];

// 1. Board with the built-in elements and tools.
const board = createBoard({ locale: 'id', plugins: [defaultElements, defaultTools] });
board.setTool('select');

// 2. Mount the renderer into a sized element.
const container = document.getElementById('board')!;
mountRenderer(board, container, { theme: 'light' });

// 3. Load from IndexedDB, then save automatically after every change (debounced).
const adapter = createIndexedDbStorage({ databaseName: 'kujam-example-vanilla' });
const storage = attachStorage(board, adapter, { boardId: 'contoh-vanilla' });

// 4. A small toolbar on the public board API.
// TODO(BOARD-1402): replace with the toolbar from @kujam/ui once it exists.
mountToolbar(board, document.getElementById('toolbar')!);

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

function mountToolbar(board: Board, root: HTMLElement): void {
  const toolButtons = new Map<string, HTMLButtonElement>();
  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', onClick);
    root.append(el);
    return el;
  };

  for (const [id, label] of TOOLS) {
    if (!board.tools.get(id)) continue;
    toolButtons.set(
      id,
      button(label, () => board.setTool(id)),
    );
  }
  const undo = button('Urungkan', () => board.undo());
  const redo = button('Ulangi', () => board.redo());
  const zoom = button('100%', () => board.camera.zoomTo(1));
  zoom.title = 'Kembali ke 100%';

  const syncTool = () => {
    for (const [id, el] of toolButtons) el.setAttribute('aria-pressed', String(board.tool === id));
  };
  const syncHistory = () => {
    undo.disabled = !board.history.canUndo;
    redo.disabled = !board.history.canRedo;
  };
  const syncZoom = () => {
    zoom.textContent = `${Math.round(board.camera.get().zoom * 100)}%`;
  };

  board.on('tool', syncTool);
  board.on('history', syncHistory);
  board.on('camera', syncZoom);
  syncTool();
  syncHistory();
  syncZoom();
}
