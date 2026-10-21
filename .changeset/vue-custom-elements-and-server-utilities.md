---
'@kujam/vue': patch
'@kujam/react': patch
'@kujam/core': patch
'@kujam/server': patch
---

Adapter elemen kustom Vue, hook/composable useResolved, validasi server, dan ekstraksi referensi (BOARD-1305, BOARD-1306, BOARD-1801, BOARD-1802):

- Vue: render elemen kustom dengan komponen Vue via prop `elements` pada `<Board>` menggunakan `<Teleport>`, mewarisi `provide`/`inject` aplikasi, menangani passthrough event `data-board-interactive`, serta helper `defineVueElement`.
- React & Vue: hook dan composable `useResolved(board, resolver, id)` untuk membaca data resolver luar kanvas secara reaktif terhadap invalidasi.
- Core: penambahan kontrak `references?(el)` pada `ElementDefinition` untuk deklarasi referensi eksternal elemen.
- Server: `validateServerDocument` (validasi dokumen JSON dan biner Yjs tanpa DOM di Node 20 dengan mode strict) dan `extractReferences` (ekstraksi penempatan kartu untuk sinkronisasi database server).
