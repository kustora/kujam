---
'@kujam/core': minor
---

Implementasi API perubahan tingkat tinggi: `board.create`, `board.update`, `board.delete` (BOARD-205).

- `board.create(partialElement, options)`: Mengisi nilai bawaan `id` (nanoid), `index` di atas elemen teratas di halaman target via fractional indexing (`indexAbove`), `props` digabung di atas nilai bawaan tipe (`defaults`), validasi skema tipe elemen via `validateElementProps`, serta validasi batas `limits.maxElements`.
- `board.update(id, patch, options)`: Menggabungkan patch dangkal dengan `props` digabung per kunci (`Object.assign`), divalidasi dengan skema tipe elemen, dan menolak pengubahan elemen `locked` kecuali diberikan opsi `force: true`.
- `board.delete(ids, options)`: Menghapus satu atau sekumpulan elemen, secara otomatis melakukan cascade penghapusan elemen anak (frame/grup) secara rekursif dan binding yang menempel, serta menolak penghapusan elemen `locked` tanpa `force: true`.
- Penanganan error: Operasi yang tidak valid memancarkan event `error` berkode `invalid-props` atau `limit-exceeded` dan mengembalikan `undefined` tanpa merusak state dokumen.
