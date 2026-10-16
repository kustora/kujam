---
'@kujam/core': minor
---

Sistem event `board.on` lengkap dan riwayat undo/redo lokal (BOARD-207, BOARD-301).

- `BoardEventMap` kini berisi `change`, `selection`, `camera`, `tool`, `action`, `error`, dan `history`, dengan tipe isi `CameraEvent`, `BoardErrorEvent`, `HistoryEvent`, serta `SelectionEvent`, `ToolEvent`, `ActionEvent` (`@beta`, sumbernya menyusul).
- `setCamera` memancarkan event `camera` (`{ camera, previous }`) hanya bila kamera benar-benar berubah.
- Event `error` membawa kode stabil (`BoardErrorCode`: `listener-error`, `invalid-props`, `invalid-record`, `forbidden`, `limit-exceeded`, `document-too-new`) dan `cause`.
- **Perubahan perilaku:** listener yang melempar tidak lagi membuat `transact` melempar ulang error-nya. Error dipancarkan sebagai event `error` berkode `listener-error`; bila tidak ada listener `error`, atau listener `error` sendiri melempar, error dilaporkan ke `console.error` tanpa rekursi.
- `board.undo()`, `board.redo()`, dan `board.history` (`canUndo`, `canRedo`, `limit`, `clear()`). Hanya transaksi `local` yang dicatat; undo/redo memakai origin `undo`/`redo` dengan label transaksi asli; perubahan lokal baru membuang tumpukan redo; `loadDocument` mengosongkan riwayat. Batas bawaan 200 langkah (`DEFAULT_HISTORY_LIMIT`), diubah lewat `createBoard({ history: { limit } })`.
- Record yang diubah pihak lain (misalnya `remote`) setelah sebuah langkah dicatat tidak ikut dibalik oleh undo/redo; langkah yang tidak bisa dibalik sama sekali dibuang.
- Event `history` (`{ canUndo, canRedo }`) dipancarkan saat salah satu nilainya berubah.
