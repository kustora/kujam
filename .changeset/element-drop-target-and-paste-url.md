---
'@kujam/core': minor
'@kujam/renderer': minor
'@kujam/shapes': minor
---

Elemen sebagai drop target dan hook `onPasteUrl` untuk plugin (BOARD-1208, BOARD-1209):

- `@kujam/core`:
  - `defineElement({ dropTarget: { accepts(dropped, target), onDrop(target, dropped, point, ctx) } })`: elemen bisa menerima elemen lain yang dijatuhkan ke atasnya. `ctx.updateProps(patch)` mengubah props target dan `ctx.removeDropped()` menghapus elemen yang dijatuhkan; tanpa itu elemen tetap dipertahankan di posisi lepasnya.
  - Fungsi `findDropTarget(board, ids, point)` dan `dropOnTarget(board, ids, point)`; seluruh `onDrop` berjalan dalam satu transaksi berlabel `element.drop`. Error di `accepts`/`onDrop` diisolasi menjadi event `error` berkode `plugin-error`, dan `onDrop` yang melempar error membatalkan seluruh perubahan drop.
  - Hook plugin `onPasteUrl(url, point, board) => ElementInput | null` (`PasteUrlHook`): plugin pertama menurut urutan pemasangan yang mengembalikan elemen menang. Fungsi `createElementFromUrl(board, url, point)` membuat elemen itu sebagai satu langkah undo (`clipboard.paste-url`), dan `isPastableUrl(text)` hanya meloloskan satu URL `http:`/`https:`. Package tidak pernah mengambil URL; metadata pratinjau diisi lewat `resolve` elemen dan resolver host, sehingga elemen langsung tampil dalam status memuat. Hook yang melempar error, mengembalikan Promise, atau mengembalikan nilai tidak valid dilaporkan sebagai `plugin-error` dan plugin berikutnya dicoba.
- `@kujam/renderer`:
  - Tempel URL menjalankan hook `onPasteUrl` plugin (setelah opsi `onPasteUrl` renderer bila ada) dan memilih elemen yang dibuat; bila tidak ada plugin yang menangani, URL tetap ditempel sebagai teks.
  - Overlay menyorot elemen drop target (`toolData.dropTargetId`) dengan isian tipis dan garis tepi tebal; `OverlayRenderStats.dropTargetId`.
- `@kujam/shapes`:
  - Tool select menghitung drop target di bawah pointer saat menggeser (`SelectToolData.dropTargetId`) dan menjalankan `dropOnTarget` saat dilepas di dalam interaksi yang sama, sehingga geser + drop = satu langkah undo. Bila target menyerap semua elemen yang diseret, target yang dipilih.
