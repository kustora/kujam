---
'@kujam/core': minor
---

State seleksi lokal (BOARD-405).

- `board.select(ids)`, `board.addToSelection(ids)`, `board.removeFromSelection(ids)`, dan `board.clearSelection()`, menerima satu ID atau array ID (`SelectionInput`). ID yang bukan elemen diabaikan dan duplikat dibuang; urutan seleksi dipertahankan.
- `board.selection`: array ID beku yang tetap objek yang sama sampai seleksi berubah. `board.selectionBounds`: AABB gabungan elemen terpilih yang memperhitungkan rotasi dan geometri elemen, atau `null`.
- Seleksi bukan bagian dokumen, tidak disimpan, dan tidak masuk riwayat undo. Tetap bisa dipakai di papan `readOnly`.
- Elemen yang dihapus dari asal mana pun (lokal, remote, undo, `loadDocument`) otomatis keluar dari seleksi, setelah event `change`.
- Event `selection` hanya dipancarkan bila seleksi benar-benar berubah.
