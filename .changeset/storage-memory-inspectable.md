---
'@kujam/storage-memory': minor
---

Adapter penyimpanan memori yang bisa diinspeksi untuk tes dan demo (BOARD-1602).

- `createMemoryStorage({ initial?, debounceMs? })` mengembalikan `MemoryStorage`: `StorageAdapter` berbasis `Map` yang menyalin dalam setiap dokumen masuk dan keluar.
- `adapter.saved`: log setiap penyimpanan berhasil (`{ boardId, change }`) sesuai urutan panggilan, berupa salinan dalam sehingga perubahan papan berikutnya tidak ikut masuk.
- `peek(boardId)` dan `boards()` untuk memeriksa isi penyimpanan, `clear()` untuk mengosongkannya.
- `failNextSaves(count, error?)` mensimulasikan backend luring untuk menguji percobaan ulang `attachStorage`.
