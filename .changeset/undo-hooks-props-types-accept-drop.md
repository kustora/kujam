---
'@kujam/core': patch
'@kujam/renderer': patch
---

Hook efek samping transaksi onUndo/onRedo, inferensi tipe props elemen, dan pendaftaran drag-drop objek aplikasi (BOARD-303, BOARD-607, BOARD-608):

- Core: `tx.onUndo` & `tx.onRedo` untuk mendaftarkan hook efek samping dalam `board.transact`, dipanggil saat undo/redo dibalik/diaplikasikan ulang dengan context `{ label, origin }`. Callback async tidak memblokir kanvas dan error dilaporkan via event `error` (`undo-hook-error`).
- Core: antarmuka declaration merging `BoardElementTypes` dan generic `board.getElement<T>()` serta `board.create<T>()` untuk membawa tipe props yang kuat di TypeScript.
- Core & Renderer: `board.acceptDrop(type, handler)` untuk mendaftarkan custom/MIME drag types dan `board.dropAt(point, type, payload)` untuk drop terprogram. Terintegrasi penuh dengan HTML5 drag-and-drop di renderer kanvas beserta visual drop indicator di layer overlay.
