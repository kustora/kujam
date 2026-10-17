---
'@kujam/core': minor
---

Dokumen dari versi lebih baru dibuka baca saja (BOARD-703).

- Bila `schemaVersion` dokumen, `typeVersion` sebuah elemen terdaftar, atau versi dokumen sebuah plugin terpasang lebih tinggi dari yang dikenal, `loadDocument` dan `createBoard({ document })` tidak lagi melempar: dokumen dimuat apa adanya, papan masuk mode baca saja (`board.readOnly` bernilai `true`), dan event `error` berkode `document-too-new` dipancarkan dengan `cause` bertipe `DocumentTooNewReason`.
- Dalam kondisi ini dokumen tidak pernah ditulis ulang: tidak ada migrasi yang dijalankan dan transaksi lokal ditolak, termasuk dari `setup` plugin.
- Untuk dokumen awal `createBoard`, event dipancarkan secara asinkron agar listener yang didaftarkan tepat setelah `createBoard` menerimanya.
- Memuat dokumen yang didukung mencabut mode baca saja paksa ini; opsi `readOnly` tetap berlaku.
- `validateDocument` publik tetap menolak `schemaVersion` yang lebih baru.
