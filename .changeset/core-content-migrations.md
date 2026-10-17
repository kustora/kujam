---
'@kujam/core': minor
---

Migrasi per tipe elemen dan migrasi dokumen plugin (BOARD-702).

- `ElementRecord.typeVersion` (opsional, kosong berarti 1) menyimpan versi tipe tempat props ditulis. `board.create` mengisinya dengan `version` definisi elemen.
- Saat memuat (`loadDocument` dan `createBoard({ document })`), langkah `migrate` di `defineElement` dijalankan untuk setiap elemen yang `typeVersion`-nya lebih rendah dari `version` definisinya, lalu `typeVersion` diperbarui. Tipe yang tidak terdaftar tidak disentuh.
- `BoardDocument.pluginVersions` (opsional) mencatat versi dokumen per plugin. Langkah `migrations` di `definePlugin` kini berkunci versi milik plugin itu sendiri (bukan `schemaVersion`), dijalankan setelah migrasi inti dan migrasi props, sesuai urutan pemasangan plugin. Papan baru langsung memakai versi terbaru, sehingga langkah plugin hanya berjalan pada dokumen yang dimuat.
- Hasil migrasi diterapkan sebagai transaksi terpisah berasal `migration`, sehingga tidak masuk riwayat undo. Semua langkah menerima salinan beku; langkah yang gagal melempar `MigrationError` (dengan `source`) tanpa mengubah state papan. Bila gagal saat `createBoard`, papan di-dispose lalu error dilempar.
