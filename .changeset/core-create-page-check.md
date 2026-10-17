---
'@kujam/core': minor
---

`board.create` menolak `pageId` yang bukan page yang ada (BOARD-208).

- Bila `pageId` (atau page aktif bawaan) tidak menunjuk ke record `page` di dokumen, `create` mengembalikan `undefined` dan memancarkan event `error` dengan kode baru `page-not-found` (`cause`: `{ pageId }`). Sebelumnya elemen tetap dibuat di page yang tidak ada, sehingga tidak pernah terlihat dan tidak ikut terhapus saat page dihapus.
- `board.update` dengan `patch.pageId` ke page yang tidak ada juga ditolak dengan `page-not-found` (seluruh patch dibatalkan). Hanya perpindahan page yang diperiksa, sehingga elemen yang sudah berada di page yang tidak ada tetap bisa diubah atau dipindahkan ke page yang valid.
- Dokumen tanpa record page sama sekali tidak bisa ditambah elemen sampai page dibuat lewat `board.pages.create`.
