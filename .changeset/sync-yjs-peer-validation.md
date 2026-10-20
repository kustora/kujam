---
'@kujam/sync-yjs': minor
---

Validasi data dari peer dan update Yjs yang tidak tepercaya (BOARD-2004).

- Record dari peer kini divalidasi dengan aturan yang sama seperti `loadDocument`: struktur lengkap, props terhadap skema tipe terdaftar di `board.elements`, dan batas titik coretan `board.limits.maxDrawPoints`. Record tidak valid dibuang dan dilaporkan sebagai `invalid-record` (dengan daftar masalah di `cause.errors`); papan mempertahankan nilai valid terakhir. Record yang disimpan di kunci yang berbeda dari `id`-nya juga ditolak.
- Elemen baru dari peer yang melebihi `board.limits.maxElements` dibuang dan dilaporkan sebagai `limit-exceeded`; pembaruan elemen yang sudah ada tetap diterapkan.
- Satu record yang ditolak store tidak lagi membatalkan seluruh update remote.
- `updateToYDoc` dan `updateToDocument`: opsi `maxUpdateBytes` (bawaan 10 MB) diperiksa sebelum decoding, dan update rusak ditolak dengan `InvalidUpdateError` (error Yjs asli di `cause`). `updateToDocument` juga menolak hasil yang melebihi `limits.maxElements` atau `limits.maxDocumentBytes` dengan `InvalidDocumentError`.
- `yDocToDocument` dan `updateToDocument` menerima opsi `registry` dan `limits`; bila diberikan, record yang gagal `validateBoardRecord` dibuang.
