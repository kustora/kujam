---
'@kujam/core': minor
---

Elemen bertipe tidak terdaftar tetap disimpan utuh (BOARD-209).

- Record elemen yang tipenya belum terpasang dimuat apa adanya (dokumen awal maupun `loadDocument`) tanpa validasi props, ikut terindeks spasial dan `board.query` sebagai kotak biasa.
- Elemen tersebut bisa dipindah, di-resize, diputar, dikunci, dan dihapus (termasuk undo/redo) tanpa mengubah props. Patch `props` lewat `board.update` ditolak dengan event `error` berkode `invalid-props`, karena props tidak bisa divalidasi.
- `board.create` untuk tipe tidak terdaftar tetap ditolak.
- Tes round-trip memastikan simpan ulang menghasilkan props identik.
