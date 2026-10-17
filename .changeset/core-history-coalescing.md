---
'@kujam/core': minor
---

Penggabungan langkah undo (coalescing) untuk interaksi kontinu (BOARD-302).

- Satu seret lewat tool (pindah, resize, rotasi) tetap menjadi satu langkah undo walau menghasilkan banyak transaksi (mekanisme interaksi BOARD-501).
- Opsi `mergeKey` di `board.transact`, `board.create`, `board.update`, dan `board.delete`: transaksi lokal dengan kunci yang sama digabung ke langkah terakhir selama jeda antartransaksi tidak melebihi `history.mergeWindowMs` (bawaan `DEFAULT_MERGE_WINDOW_MS`, 1 detik). Cocok untuk mengetik di teks; ganti kunci untuk memecah langkah, misalnya per kata.
- `board.history.batch(key, fn)`: semua transaksi lokal di dalam `fn` digabung menjadi satu langkah, apa pun kuncinya dan berapa pun jedanya. Batch bersarang ikut batch terluar.
- Penggabungan berhenti di undo, redo, perubahan pihak lain (remote), interaksi tool, dan `history.clear()`. Bila perubahan yang digabung saling meniadakan, langkahnya dihapus.
- Opsi `createBoard({ history: { mergeWindowMs } })`, properti `board.history.mergeWindowMs`, dan field `mergeKey` di event `change`.
