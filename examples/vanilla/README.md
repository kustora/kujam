# Mulai cepat: JS/TS biasa

Contoh ini memasang papan Canvas Jam tanpa framework: papan dengan elemen dan tool bawaan, toolbar dari `@kujam/ui`, dan simpan otomatis ke IndexedDB. Target: papan jalan di browser kurang dari 10 menit.

## Jalankan contoh ini

```bash
pnpm install
pnpm --filter @kujam/example-vanilla dev
```

Buka alamat yang dicetak Vite (biasanya `http://localhost:5173`). Pilih **Sticky**, klik papan, lalu muat ulang halaman: sticky masih ada karena tersimpan di IndexedDB.

## Pasang di proyekmu sendiri

### 1. Pasang package

```bash
npm install @kujam/core @kujam/renderer @kujam/shapes @kujam/storage-indexeddb @kujam/ui
```

### 2. Siapkan elemen berukuran

Renderer mengisi elemen wadahnya, jadi wadah wajib punya ukuran.

```html
<div id="board" style="width: 100vw; height: 100vh"></div>
```

### 3. Buat papan dan pasang renderer

```ts
import { createBoard } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { defaultElements, defaultTools } from '@kujam/shapes';

const board = createBoard({ locale: 'id', plugins: [defaultElements, defaultTools] });
const view = mountRenderer(board, document.getElementById('board')!, { theme: 'light' });
```

Sampai di sini papan sudah bisa dipakai. Shortcut bawaan: `V` pilih, `H` tangan, `S` sticky, `P` pena, `T` teks, `R` kotak, `O` elips, `E` hapus. Ctrl/Cmd+C, X, dan V menyalin dan menempel antar papan.

### 4. Simpan ke IndexedDB

```ts
import { attachStorage } from '@kujam/core';
import { createIndexedDbStorage } from '@kujam/storage-indexeddb';

const storage = attachStorage(board, createIndexedDbStorage(), { boardId: 'papan-saya' });
await storage.ready; // dokumen tersimpan sudah dimuat
```

Setiap perubahan disimpan otomatis setelah jeda singkat. Pantau status dengan `storage.on('save:success' | 'save:error', ...)`. Di Safari mode privat, adapter jatuh ke memori dan memberi peringatan sekali.

### 5. Tambahkan toolbar

```ts
import { mountDefaultUi } from '@kujam/ui';

const ui = mountDefaultUi({ board, container: document.getElementById('board')! });
```

Toolbar tool melayang di bawah tengah, kontrol zoom di kanan bawah, dan urungkan/ulangi di kiri bawah. Semuanya mengikuti tema papan dan bisa dipakai penuh dengan keyboard (Tab ke toolbar, panah kiri/kanan, panah atas untuk pilihan bentuk). Butuh tombol sendiri? Semua kontrol memakai API publik `board`:

```ts
board.setTool('sticky');
board.undo();
board.camera.zoomTo(1);

board.on('tool', (e) => console.log('tool aktif:', e.id));
board.on('history', (e) => console.log('bisa undo:', e.canUndo));
```

### 6. Bersihkan

```ts
ui.unmount(); // lepas toolbar
view.unmount(); // lepas DOM dan listener renderer
board.dispose(); // simpan terakhir lalu lepas semua listener
```

## Berikutnya

- React: `@kujam/react` (`<Board>` dan hooks `useSelection`, `useCamera`, `useTool`, `useHistory`).
- Vue: `@kujam/vue` (`<Board>` dan composables dengan nama yang sama).
