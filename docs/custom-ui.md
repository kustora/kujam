# UI Papan: Bawaan, Wrapper Framework, atau Buatan Sendiri

Panduan untuk aplikasi yang memasang UI di atas papan (BOARD-1410). Ada tiga tingkat, dan semuanya bisa dicampur: misalnya toolbar buatan sendiri dengan minimap dan command palette bawaan.

| Tingkat              | Cara                                                    | Cocok untuk                                      |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| 1. UI bawaan         | `mountDefaultUi({ board, container })` dari `@kujam/ui` | Prototipe dan aplikasi tanpa design system       |
| 2. Wrapper framework | `<Toolbar board={board} />` dari `@kujam/react` / `vue` | Menaruh komponen bawaan di tata letak sendiri    |
| 3. Komponen sendiri  | Hooks/composables + API board                           | Design system sendiri (misalnya aplikasi Tayang) |

Package tidak punya state UI tersembunyi. Semua yang dipakai UI bawaan (tool aktif, riwayat, kamera, seleksi, aksi elemen, shortcut) tersedia lewat API publik board. Komponen sendiri pun bisa menyamai UI bawaan.

## 1. UI bawaan

```ts
import { mountRenderer } from '@kujam/renderer';
import { mountDefaultUi } from '@kujam/ui';

const view = mountRenderer(board, container);
const ui = mountDefaultUi({ board, container });
// nanti
ui.unmount();
view.unmount();
```

`mountDefaultUi` memasang toolbar, zoom, undo/redo, toolbar seleksi, minimap, command palette, menu konteks, presence bar, dan panel bantuan shortcut (`?`) beserta posisinya. Warna diatur lewat properti CSS `--kujam-ui-*` (lihat `uiToken`).

## 2. Wrapper React dan Vue

Wrapper merender elemen bawaan dengan prop bertipe dan meneruskan `board` sebagai properti DOM. Adapter tidak mengimpor `@kujam/ui`, karena adapter hanya boleh bergantung pada core dan renderer (BOARD-106). Daftarkan elemennya sekali saja di aplikasi:

```ts
import { defineUiElements } from '@kujam/ui';

defineUiElements(); // sekali, di sisi klien
```

Tanpa langkah ini, tag-nya tetap elemen tak dikenal dan wrapper mencatat peringatan di konsol.

### React

```tsx
import { Board, CommandPalette, Minimap, ShortcutHelp, Toolbar, ZoomControl } from '@kujam/react';

export function Editor({ board }: { board: CoreBoard }) {
  const help = useRef<UiElementRef>(null);
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <Board board={board} />
      <Toolbar board={board} className="editor-toolbar" />
      <ZoomControl board={board} style={{ position: 'absolute', right: 16, bottom: 16 }} />
      <Minimap board={board} />
      <CommandPalette board={board} source={mySource} />
      <ShortcutHelp board={board} ref={help} />
      <button onClick={() => (help.current as ShortcutHelpElement | null)?.open()}>?</button>
    </div>
  );
}
```

Komponen yang tersedia: `Toolbar`, `ZoomControl`, `HistoryControl`, `SelectionToolbar`, `Minimap`, `CommandPalette` (prop `source`), `ContextMenu`, `PresenceBar`, dan `ShortcutHelp`. Semuanya menerima `board`, `className`, `style`, dan `id`, dan `ref`-nya menunjuk ke elemen DOM. Untuk metode seperti `open()`, cast ke tipe elemen dari `@kujam/ui` (`ShortcutHelpElement`, `CommandPaletteElement`, `ContextMenuElement`). Saat SSR, wrapper hanya merender tag kosong.

### Vue

```vue
<script setup lang="ts">
import { Board, Minimap, ShortcutHelp, Toolbar } from '@kujam/vue';
const help = ref<{ element: ShortcutHelpElement | null }>();
</script>

<template>
  <div class="editor">
    <Board :board="board" />
    <Toolbar :board="board" class="editor-toolbar" />
    <Minimap :board="board" />
    <ShortcutHelp ref="help" :board="board" />
    <button @click="help?.element?.open()">?</button>
  </div>
</template>
```

`class` dan `style` diteruskan ke elemen. Instance komponen punya properti `element`. Template tidak perlu pengaturan `isCustomElement`, karena wrapper membuat elemennya lewat render function.

## 3. UI buatan sendiri dengan hooks

Kerangka tiap kontrol di bawah memakai React. Composables Vue di `@kujam/vue` bernama sama (`useTool`, `useHistory`, `useCamera`, `useSelection`, `useBoardEvent`) dan mengembalikan `Ref`.

### Toolbar

`buildToolbarItems(board)` dari `@kujam/ui` adalah fungsi biasa tanpa DOM. Fungsi ini mengembalikan tool bawaan dan item plugin (`toolbarItems`) dengan label yang sudah diterjemahkan dan shortcut yang sudah diformat, jadi toolbar sendiri tetap mengikuti plugin dan binding pemakai:

```tsx
import { useTool } from '@kujam/react';
import { buildToolbarItems } from '@kujam/ui';

function MyToolbar({ board }: { board: CoreBoard }) {
  const tool = useTool(board);
  const items = useMemo(() => buildToolbarItems(board), [board]);
  return (
    <div role="toolbar" aria-label={board.t('toolbar')}>
      {items.map((item) => (
        <button
          key={item.id}
          aria-pressed={item.toolId === tool}
          aria-label={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
          onClick={() =>
            item.toolId ? board.setTool(item.toolId) : item.commandId && board.run(item.commandId)
          }
        >
          <MyIcon name={item.icon} />
        </button>
      ))}
    </div>
  );
}
```

Tanpa `@kujam/ui`, sumber yang sama tersedia langsung: `board.tools.list()`, `board.keybindings.forTarget('tool:draw')`, dan `board.keybindings.format(shortcut)`.

### Undo, redo, dan zoom

```tsx
function MyHistory({ board }: { board: CoreBoard }) {
  const { canUndo, canRedo } = useHistory(board);
  return (
    <>
      <button disabled={!canUndo} onClick={() => board.undo()}>{board.t('undo')}</button>
      <button disabled={!canRedo} onClick={() => board.redo()}>{board.t('redo')}</button>
    </>
  );
}

function MyZoom({ board }: { board: CoreBoard }) {
  const zoom = useCamera(board, (camera) => camera.zoom);
  const step = (direction: 1 | -1) =>
    board.camera.zoomTo(nextZoomStep(zoom, direction, board.camera.zoomRange));
  return (
    <>
      <button onClick={() => step(-1)}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button onClick={() => step(1)}>+</button>
      <button onClick={() => board.camera.zoomToFit()}>{board.t('zoomToFit')}</button>
    </>
  );
}
```

### Toolbar seleksi dan aksi elemen

`useSelection(board)` memberi ID terpilih. Aksi kontekstual tiap elemen (bawaan dan dari plugin, BOARD-1205) dibaca dengan `board.getActions(ids)` dan dijalankan dengan `board.runAction(action, element)`, yang memeriksa izin. Posisi toolbar mengikuti kotak seleksi di layar: ubah batas seleksi ke koordinat layar dengan `board.camera.boardToScreen`, lalu perbarui saat kamera berubah (`useCamera`).

### Menu konteks

Renderer hanya mengirim data menu (BOARD-912). Tangani lewat opsi `onContextMenu` di `mountRenderer`, atau `useBoardEvent(board, 'contextmenu', handler)`. Event-nya membawa `items` (aksi elemen dan perintah umum), posisi `client` untuk menaruh menu, dan `targetId`.

### Panel bantuan shortcut

`buildShortcutHelp(board)` dari `@kujam/ui` mengembalikan `{ tools, commands }`, masing-masing berisi `{ target, label, shortcuts }` yang sudah diformat. Panggil setiap kali panel dibuka, supaya perubahan `board.keybindings.set(...)` ikut tampil. Tanpa `@kujam/ui`, kelompokkan sendiri hasil `board.keybindings.list()`.

### Aksesibilitas

UI bawaan memenuhi `docs/a11y-checklist.md`. Saat mengganti UI sendiri, pertahankan beberapa hal ini:

- tombol tool punya nama yang memuat shortcut (misalnya "Pena (P)") dan `aria-pressed`;
- toolbar memakai `role="toolbar"` dengan navigasi panah;
- dialog (palette, bantuan shortcut) memakai `role="dialog"`, `aria-modal`, Esc untuk menutup, dan mengembalikan fokus;
- area sentuh minimal 24 × 24 px CSS;
- teks diambil dari `board.t(key)` agar mengikuti `board.locale` dan kamus aplikasi (BOARD-1909).

Pengumuman pembaca layar untuk aksi di papan (elemen dibuat atau dihapus, kolaborator bergabung) sudah dibuat renderer (BOARD-1903). Pesan dari UI sendiri bisa ditambahkan dengan `view.announce(message)`.
