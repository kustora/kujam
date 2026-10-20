---
'@kujam/ui': patch
---

`<kujam-presence-bar>` kini memakai `board.sync` dan mengikat ulang pada event `sync`, sehingga status koneksi dan avatar kolaborator tampil benar walaupun `attachSync` dipanggil setelah UI dipasang. Sebelumnya bar membaca properti `board.sync` yang tidak pernah diisi `attachSync` dan selalu menampilkan "Offline".
