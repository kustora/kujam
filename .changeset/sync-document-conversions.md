---
'@kujam/sync-yjs': patch
---

Utilitas Konversi Y.Doc ke JSON Dokumen dan Sebaliknya (BOARD-1513):
- `BOARD-1513`: Utilitas konversi `documentToYDoc` dan `yDocToDocument`.
  - Mengonversi `BoardDocument` kanonikal ke `Y.Doc` dengan pemetaan records (`recordsMap`) dan rich text Y.Text yang lengkap serta metadata dokumen (`schemaVersion`, `meta`, `pluginVersions`).
  - Mengonversi `Y.Doc` kembali menjadi `BoardDocument` valid dengan pembersihan record malformed dan dukungan opsi filter `validateRecord`.
  - Konversi dua arah *lossless roundtrip* berakurasi 100%.
  - Utilitas biner: `documentToUpdate`, `updateToDocument`, `yDocToUpdate`, dan `updateToYDoc` untuk mendukung penyimpanan blob database dan skrip migrasi massal di Node.js.
