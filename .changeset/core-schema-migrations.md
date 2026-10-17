---
'@kujam/core': minor
---

Migrasi skema inti bernomor (BOARD-701).

- `CORE_MIGRATIONS`: daftar langkah `{ [versiAsal]: (doc) => doc }` milik package ini. Setiap versi dari 1 sampai `CURRENT_SCHEMA_VERSION - 1` wajib punya langkah.
- `migrateSchema(doc, migrations?, targetVersion?)`: menjalankan langkah berurutan sampai `CURRENT_SCHEMA_VERSION`. Input tidak pernah diubah (langkah menerima salinan beku), dan `schemaVersion` hasil diisi oleh runner.
- `MigrationError` (dengan `fromVersion`) dilempar bila langkah tidak ada, melempar, atau tidak mengembalikan objek.
- `createBoard({ document })` dan `board.loadDocument` menjalankan migrasi inti sebelum validasi struktur.
