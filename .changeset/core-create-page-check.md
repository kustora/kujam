---
'@kujam/core': minor
---

`board.create` menolak `pageId` yang bukan page yang ada (BOARD-208).

- Bila `pageId` (atau page aktif bawaan) tidak menunjuk ke record `page` di dokumen, `create` mengembalikan `undefined` dan memancarkan event `error` dengan kode baru `page-not-found` (`cause`: `{ pageId }`). Sebelumnya elemen tetap dibuat di page yang tidak ada, sehingga tidak pernah terlihat dan tidak ikut terhapus saat page dihapus.
- Dokumen tanpa record page sama sekali tidak bisa ditambah elemen sampai page dibuat lewat `board.pages.create`.
