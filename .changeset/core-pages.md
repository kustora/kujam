---
'@kujam/core': minor
---

Dukungan page di model data (BOARD-208).

- `board.pages`: `list()` (terurut menurut `index`), `get(id)`, `create(page?)`, `rename(id, name)`, `delete(id)`, `setCurrent(id)`, dan `current`. Nama bawaan page baru `Halaman N`, ditaruh setelah page terakhir.
- Menghapus page menghapus semua elemennya (termasuk yang terkunci) beserta binding yang menempel dalam satu transaksi, jadi satu langkah undo memulihkan semuanya. Page terakhir tidak bisa dihapus.
- Page aktif adalah state lokal (tidak disimpan dan tidak masuk undo). Bila page aktif terhapus (lokal, remote, atau `loadDocument`), papan pindah ke page tetangga. Event baru `page` dipancarkan saat page aktif berganti.
- `board.query`, `board.hitTest`, dan `board.create` memakai page aktif bila `pageId` tidak diisi. Opsi baru `allPages: true` mencari di semua page.
- Seleksi hanya berisi elemen di page aktif: berganti page mengosongkan seleksi, dan elemen yang dipindah ke page lain keluar dari seleksi.
- Perubahan page melewati hook izin dengan aksi `'page.create'`, `'page.rename'`, dan `'page.delete'`; menghapus page juga memeriksa izin `'delete'` untuk setiap elemennya.
