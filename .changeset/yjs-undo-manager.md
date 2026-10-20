---
'@kujam/core': patch
'@kujam/sync-yjs': patch
---

Implementasi Undo per orang dengan Yjs UndoManager (BOARD-1507):
- `@kujam/sync-yjs`:
  - Menambahkan modul `createYjsHistory` yang mengimplementasikan `HistoryApi` berbasis `Y.UndoManager`.
  - Pelacakan origin terbatas pada origin klien sendiri (`trackedOrigins: new Set([clientOrigin])`) sehingga operasi undo/redo kolaborator hanya membalik perubahannya sendiri tanpa membatalkan perubahan kolaborator lain.
  - Preservasi penggabungan langkah (*coalescing*) berkelanjutan menggunakan `mergeKey` dan `captureTimeout` (1000ms), serta pemisahan langkah yang tepat dengan `stopCapturing()`.
  - Dukungan pelabelan transaksi pada `undoStack` dan `redoStack`.
  - Dukungan callback `tx.onUndo` dan `tx.onRedo` (BOARD-303) dengan konteks transaksi saat langkah dibatalkan atau diterapkan ulang.
  - Pemulihan seleksi elemen (*selection restoration*) setelah undo bila elemen yang terdampak masih ada di dokumen.
- `@kujam/core`:
  - Menambahkan method `tx.onUndo(hook)` dan `tx.onRedo(hook)` pada antarmuka `Transaction`.
  - Memperluas `HistoryApi` dengan dukungan opsional untuk `batch`, `undoStack`, dan `redoStack`.
  - Mendelegasikan pemanggilan `board.history.batch()`, `board.history.undoStack`, dan `board.history.redoStack` ke adapter history yang terpasang.
