---
'@kujam/core': minor
---

Fungsi `createBoard` dan `board.dispose` (BOARD-211).

- Menambahkan opsi konfigurasi `CreateBoardOptions`: `resolvers`, `assets`, `user`, `limits`, `permissions`, `readOnly`, `locale`, `document`, `plugins`.
- Menambahkan validasi ketat untuk seluruh opsi masukan di `createBoard`.
- Mengekspos properti `resolvers`, `assets`, `user`, `limits`, `permissions`, `readOnly`, `locale`, dan `disposed` pada antarmuka `Board`.
- Penegakan `readOnly: true` menolak seluruh mutasi lokal (melempar `ReadOnlyBoardError`, undo/redo return `false`), namun kamera dan `loadDocument` tetap diizinkan.
- Pembersihan total pada `board.dispose()`: idempoten, melepas event listeners, command registry, tool registry, history, dan store; melempar error pada pemanggilan method aktif sesudahnya; serta menjalankan teardown plugin terbalik.
- Uji kebocoran memori membuktikan 100 instance board dibersihkan sepenuhnya oleh GC setelah `dispose()`.
