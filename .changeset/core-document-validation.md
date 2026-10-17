---
'@kujam/core': minor
'@kujam/server': minor
---

Validasi dokumen masuk dan batas ukuran papan (BOARD-210).

- `validateDocument(doc, registry?, { limits })` kini memeriksa props elemen terhadap skema tipe terdaftar (tipe tidak terdaftar dibiarkan, BOARD-209) serta batas ukuran: byte dokumen (UTF-8 JSON), jumlah elemen, dan titik per coretan (`props.points`). Hasilnya punya `invalidRecords` per ID record di samping `errors`. Fungsi yang sama dipakai klien (`createBoard`, `loadDocument`) dan server (`@kujam/server`).
- `BoardLimits` dan `DEFAULT_BOARD_LIMITS` (10 MB, 5.000 elemen, 5.000 titik) dipakai bersama; semuanya bisa dikonfigurasi lewat `limits`. `board.create`/`board.update` menolak coretan yang melebihi `maxDrawPoints` dengan event `limit-exceeded`.
- Record tidak valid dari dokumen masuk ditolak satu per satu dan dilaporkan sebagai event `error` berkode `invalid-record` (setelah event `change`); sisanya tetap dimuat. Untuk `createBoard({ document })`, laporan dikirim pada microtask berikutnya agar listener yang dipasang tepat setelah `createBoard` ikut menerimanya; tanpa listener `error`, laporan ditulis ke `console.error`.
- Masalah tingkat dokumen (bentuk, versi skema, ukuran byte, jumlah elemen) tetap melempar `InvalidDocumentError` tanpa mengubah state.
