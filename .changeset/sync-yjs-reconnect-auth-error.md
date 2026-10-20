---
'@kujam/core': patch
'@kujam/sync-yjs': patch
---

Status Koneksi, Backoff Eksponensial, dan Isolasi Error Autentikasi (BOARD-1509):
- `BOARD-1509`: Kontrol siklus status koneksi dan event rekoneksi pada adapter sinkronisasi.
  - Implementasi retry rekoneksi dengan backoff eksponensial (`calculateBackoffDelay` & `ReconnectController`) yang mendukung `initialDelayMs`, `maxDelayMs`, `backoffFactor`, serta random jitter.
  - Pembedaan event error autentikasi (`SyncAuthError`, status/kode 401/403/4401/4403, `{ reason: 'auth' }`) vs terputusnya jaringan (`{ reason: 'network' }`).
  - Kegagalan autentikasi memancarkan event `auth-error` dan membatalkan auto-retry untuk mencegah flood request ke server.
  - Putus jaringan beralih ke status `'connecting'` dan secara otomatis menjadwalkan rekoneksi bertahap.
  - Menambahkan tipe `SyncErrorDetail` pada `@kujam/core` dan event `'auth-error'` pada `SyncEventMap`.
