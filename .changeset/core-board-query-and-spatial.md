---
'@kujam/core': minor
---

Implementasi API baca: `board.query`, indeks spasial R-tree, dan `BoardElementTypes` (BOARD-206, BOARD-404, BOARD-607).

- `board.query(filter)`: Mencari dan memfilter elemen berdasarkan `type`, `pageId`, `parentId` (termasuk `null` untuk root kanvas), serta `inBounds` yang memanfaatkan indeks spasial R-tree (`rbush`), dengan hasil terurut deterministik sesuai urutan lapisan (*fractional index*).
- Indeks Spasial (`SpatialIndex` / `rbush`): Menghitung AABB elemen dengan mempertimbangkan ukuran dasar, rotasi (`rotation` 0–360 derajat), dan geometri lokal (`geometry`). Indeks terbarui secara inkremental dari event `change` tanpa dibangun ulang. Benchmark viewport query pada 5.000 elemen tercapai < 0.02 ms (jauh melampaui target < 1 ms).
- Declaration Merging `BoardElementTypes`: Menyediakan titik perluasan global untuk inferensi tipe props otomatis pada `board.getElement<'type'>`, `board.query<'type'>`, `board.create<'type'>`, dan `board.update<'type'>`.
- Migrasi Dokumen pada `board.loadDocument`: Menjalankan rantai migrasi dokumen plugin (`PluginMigrations`) sebelum validasi dan penerapan state dengan origin `'load'`.
