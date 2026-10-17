---
'@kujam/export': minor
'@kujam/core': minor
---

Ekspor dan impor JSON papan (BOARD-1701).

- `exportJSON(board, { ids? })`: tanpa `ids` mengekspor seluruh dokumen (salinan, aman untuk `JSON.stringify`). Dengan `ids`, hanya elemen tersebut beserta anak-anaknya, binding di antara elemen yang diekspor, page tempat mereka berada, dan aset yang dirujuk props. Induk yang tidak ikut diekspor membuat elemen menjadi elemen akar.
- `importJSON(board, json, { at? })`: menerima teks JSON atau objek dokumen. Isi melewati validasi, batas, dan migrasi yang sama dengan `loadDocument`; record tidak valid dibuang dan dilaporkan di `result.rejected`. Ke papan tanpa elemen, ID, page, dan index dipertahankan. Ke papan berisi, seperti tempel: semua record mendapat ID baru, elemen ditaruh di page aktif di atas elemen teratas dengan urutan tetap, dan induk serta binding dipetakan ulang (`result.idMap`). `at` menaruh titik tengah isi di titik papan tersebut.
- Impor ditulis sebagai satu transaksi lokal berlabel `import` (satu langkah undo, ikut tersimpan otomatis). Gagal dengan `ImportError` (`read-only`, `document-too-new`, `limit-exceeded`, `forbidden`), `InvalidDocumentError`, atau `MigrationError` tanpa mengubah papan.
- `@kujam/core`: `board.prepareDocument(doc)` menjalankan pipeline dokumen masuk yang sama dengan `loadDocument` (migrasi skema, validasi terhadap registri dan batas papan, migrasi elemen dan plugin) tanpa menyentuh papan, dan mengembalikan `{ document, rejected, tooNew }`.
