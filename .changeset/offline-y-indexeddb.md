---
'@kujam/sync-yjs': patch
---

Offline Singkat dengan y-indexeddb (BOARD-1508):
- `BOARD-1508`: Dukungan persistensi IndexedDB browser berbasis `y-indexeddb` (`IndexeddbPersistence`).
  - Pembaruan dokumen selama offline disimpan secara lokal di IndexedDB dan disinkronkan otomatis saat koneksi pulih via CRDT Yjs.
  - Memuat ulang tab browser memulihkan state dokumen secara instan tanpa menunggu koneksi remote.
  - Opsi konfigurasi `indexeddb?: boolean | YjsIndexedDbOptions` (aktif secara default jika browser mendukung IndexedDB, dinonaktifkan di Node/SSR atau saat `indexeddb: false`).
  - Interface callable dan thenable `whenLoaded` (`await adapter.whenLoaded` atau `await adapter.whenLoaded()`) untuk menunggu pemulihan data lokal.
  - Siklus status (`offline` -> `connecting` -> `synced`) dengan pelacakan perubahan tertunda (`pendingUpdates`).
  - Hook opsional `isOnlineRequired(action)` untuk memvalidasi aksi yang memerlukan jaringan.
  - Teardown bersih saat disconnect (`persistence.destroy()`) dan dukungan rekoneksi bersih.
