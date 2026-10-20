---
'@kujam/core': patch
'@kujam/sync-yjs': patch
---

Mode Baca Saja per Klien di Sinkronisasi (BOARD-1512):
- `BOARD-1512`: Klien mode *read-only* pada adapter sinkronisasi.
  - Klien dengan `readOnly: true` (pada `createYjsSyncAdapter` maupun `createMemorySyncAdapter`) menerima seluruh pembaruan dokumen jarak jauh (remote updates) dan menyiarkan presence awareness (posisi kursor, kamera, seleksi).
  - Mencegah inisialisasi/seeding `recordsMap` kosong pada Y.Doc saat koneksi awal pengguna baca saja.
  - Memblokir pengiriman perubahan dokumen lokal ke Y.Doc (`recordsMap`) dan menonaktifkan streaming goresan live.
  - Mengatur `board.setReadOnly(true)` secara otomatis saat adapter terhubung ke papan tulis.
  - Menyediakan getter `adapter.readOnly` dan metode `adapter.setReadOnly(readOnly: boolean)` untuk mengganti mode secara dinamis saat runtime.
