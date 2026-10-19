---
'@kujam/core': patch
'@kujam/sync-yjs': patch
---

Implementasi Realtime Collaboration Foundation (Epic BOARD-E15: BOARD-1501 & BOARD-1502):
- `BOARD-1501`: Antarmuka sinkronisasi dan kolaborasi terpadu di `@kujam/core`.
  - Definisi tipe `SyncStatus` ('offline' | 'connecting' | 'synced' | 'error'), `PresenceUser`, `PresencePeerState`, `PresenceApi`, `HistoryApi`, `SyncEventMap`, dan `SyncAdapter`.
  - Fungsi `attachSync(board, adapter)` yang mengelola siklus hidup adapter, mengarahkan delegasi `board.undo()`, `board.redo()`, `board.history.canUndo`, `board.history.canRedo` ke `adapter.history`, dan mengembalikan `SyncAttachment` dengan `disconnect()`.
  - Implementasi in-memory sync bus (`createMemorySyncBus`) dan adapter (`createMemorySyncAdapter`) untuk pengujian konvergensi multi-papan tanpa server/backend eksternal. Perubahan remote diterapkan dengan `{ origin: 'remote', label: 'sync.remote' }` yang dilewati oleh undo lokal.
- `BOARD-1502`: Binding store ke `Y.Doc` (record sebagai `Y.Map`) di `@kujam/sync-yjs`.
  - Pemetaan dua arah `BoardRecord` (elemen, page, binding, asset) ke `Y.Map<unknown>` di dalam peta dokumen `records`. Properti elemen `props` disimpan sebagai child `Y.Map` sehingga pembaruan concurrent pada properti berbeda menyatu di tingkat properti.
  - Penulisan perubahan lokal ke `Y.Doc` dalam satu transaksi atomik per transaksi papan dengan origin klien unik.
  - Penerimaan pembaruan remote via `observeDeep` dengan pencegahan echo (mengabaikan transaksi dari origin klien sendiri), validasi skema peer, dan penolakan record korup dengan pelaporan event error.
  - Inisialisasi dokumen kosong vs berpenghuni yang deterministik dan idempoten tanpa duplikasi record saat dibuka bersamaan oleh banyak klien.
