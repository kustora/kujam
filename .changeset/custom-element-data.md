---
'@kujam/core': patch
'@kujam/renderer': patch
---

Data luar untuk elemen kustom (BOARD-604, BOARD-605, BOARD-1201, BOARD-1202, BOARD-1203, BOARD-1206):

- Core: runtime kontrak `resolve`. `board.getElementData(id, { load? })` menjalankan `resolve` elemen sekali dan menyimpan hasilnya; resolver di-cache per `(resolver, id)` dengan permintaan yang sedang berjalan dipakai bersama; `board.invalidate(resolver, id?)` hanya me-reset elemen yang memakai pasangan itu (event baru `data`); `board.reloadElementData(id)` untuk coba lagi. Kegagalan tidak di-cache dan dilaporkan sebagai `resolve-error`. `isResolveError` diekspor. `actions` dan `a11y` kini menerima data yang sudah siap; exception di `actions` hanya menghilangkan aksi elemen itu (`action-error`). `placeholder(reason)` kini juga dipanggil dengan `'loading'`.
- Renderer: `render.html` dan `render.canvas` menerima data; `update` hanya dipanggil saat record atau data berubah, tidak saat kamera bergerak. Selama data dimuat, ditolak, tidak ditemukan, atau gagal, elemen menampilkan placeholder seukuran elemen (dengan tombol "Coba lagi" untuk error). Host HTML kini meneruskan event pointer ke tool papan; hanya node `data-board-interactive` yang menerima event sendiri.

Panduan dan aturan keamanan untuk penulis plugin: `docs/custom-elements.md`.
