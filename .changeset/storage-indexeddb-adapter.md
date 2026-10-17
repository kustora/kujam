---
'@kujam/storage-indexeddb': minor
---

Adapter penyimpanan IndexedDB untuk browser (BOARD-1603).

- `createIndexedDbStorage({ databaseName?, debounceMs?, indexedDB?, onFallback? })` menyimpan satu dokumen JSON (atau update biner) per `boardId`. Ringkasan papan disimpan di object store terpisah dalam transaksi yang sama.
- `list()` mengembalikan daftar papan tersimpan untuk demo (`{ boardId, updatedAt, kind }`, terbaru lebih dulu), `remove(boardId)` menghapus papan, `mode()` melaporkan `'indexeddb'` atau `'memory'`, dan `close()` menutup koneksi.
- Mode privat Safari: bila IndexedDB tidak ada, gagal dibuka, atau menolak tulisan uji, adapter beralih ke penyimpanan memori dan memberi satu peringatan lewat `onFallback` (bawaan `console.warn`).
- Database yang sudah di-upgrade ke versi lebih baru oleh tab lain tidak memicu fallback; pemanggilan ditolak dengan `VersionError` agar data yang lebih baru tidak tampak hilang.
- Tanpa dependensi runtime selain `@kujam/core`; tes memakai `fake-indexeddb` (Apache-2.0) sebagai devDependency.
