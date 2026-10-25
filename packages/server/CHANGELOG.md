# @kujam/server

## 0.2.0

### Minor Changes

- 51b29c9: Validasi dokumen masuk dan batas ukuran papan (BOARD-210).

  - `validateDocument(doc, registry?, { limits })` kini memeriksa props elemen terhadap skema tipe terdaftar (tipe tidak terdaftar dibiarkan, BOARD-209) serta batas ukuran: byte dokumen (UTF-8 JSON), jumlah elemen, dan titik per coretan (`props.points`). Hasilnya punya `invalidRecords` per ID record di samping `errors`. Fungsi yang sama dipakai klien (`createBoard`, `loadDocument`) dan server (`@kujam/server`).
  - `BoardLimits` dan `DEFAULT_BOARD_LIMITS` (10 MB, 5.000 elemen, 5.000 titik) dipakai bersama; semuanya bisa dikonfigurasi lewat `limits`. `board.create`/`board.update` menolak coretan yang melebihi `maxDrawPoints` dengan event `limit-exceeded`.
  - Record tidak valid dari dokumen masuk ditolak satu per satu dan dilaporkan sebagai event `error` berkode `invalid-record` (setelah event `change`); sisanya tetap dimuat. Untuk `createBoard({ document })`, laporan dikirim pada microtask berikutnya agar listener yang dipasang tepat setelah `createBoard` ikut menerimanya; tanpa listener `error`, laporan ditulis ke `console.error`.
  - Masalah tingkat dokumen (bentuk, versi skema, ukuran byte, jumlah elemen) tetap melempar `InvalidDocumentError` tanpa mengubah state.

### Patch Changes

- 99e743c: Open source di bawah lisensi Apache-2.0: setiap package menyertakan `LICENSE` dan `NOTICE` di tarball npm, serta `license`, `repository`, `homepage`, dan `bugs` di `package.json`. Package dipublikasikan dengan akses publik. Komentar JSDoc tema dan warna tidak lagi merujuk dokumen design system internal; nilai token tidak berubah.
- 5f5d801: Migrasi dokumen massal, thumbnail Node, dan tes server di Node murni (BOARD-705, BOARD-1804, BOARD-1806):

  - Server: `migrateServerDocument` (JSON dan Yjs biner, pipeline sama dengan klien) dan `migrateServerBatch` (mode dry-run, callback `onMigrated`, laporan per dokumen).
  - Server: `renderThumbnail(doc, { width, plugins, canvasFactory })` menghasilkan PNG; `@napi-rs/canvas` opsional dengan error yang jelas bila tidak terpasang.
  - Renderer: `CanvasRenderer.render` menerima antarmuka `CanvasLike` (bukan `HTMLCanvasElement`), sehingga bisa berjalan di Node; `CanvasRenderer` dan `CanvasLike` kini diekspor.
  - Server kini boleh mengimpor `@kujam/renderer`.

- 202a842: Adapter elemen kustom Vue, hook/composable useResolved, validasi server, dan ekstraksi referensi (BOARD-1305, BOARD-1306, BOARD-1801, BOARD-1802):

  - Vue: render elemen kustom dengan komponen Vue via prop `elements` pada `<Board>` menggunakan `<Teleport>`, mewarisi `provide`/`inject` aplikasi, menangani passthrough event `data-board-interactive`, serta helper `defineVueElement`.
  - React & Vue: hook dan composable `useResolved(board, resolver, id)` untuk membaca data resolver luar kanvas secara reaktif terhadap invalidasi.
  - Core: penambahan kontrak `references?(el)` pada `ElementDefinition` untuk deklarasi referensi eksternal elemen.
  - Server: `validateServerDocument` (validasi dokumen JSON dan biner Yjs tanpa DOM di Node 20 dengan mode strict) dan `extractReferences` (ekstraksi penempatan kartu untuk sinkronisasi database server).

- Updated dependencies [2b2f16a]
- Updated dependencies [d50bfa6]
- Updated dependencies [374785f]
- Updated dependencies [6394412]
- Updated dependencies [67cb589]
- Updated dependencies [6348589]
- Updated dependencies [c197881]
- Updated dependencies [903766d]
- Updated dependencies [0d85a42]
- Updated dependencies [c49d99c]
- Updated dependencies [bd12697]
- Updated dependencies [b51d845]
- Updated dependencies [5efe9cd]
- Updated dependencies [5ac555e]
- Updated dependencies [0106e46]
- Updated dependencies [e20dbd7]
- Updated dependencies [3a8d206]
- Updated dependencies [01285d2]
- Updated dependencies [51b29c9]
- Updated dependencies [3a8d206]
- Updated dependencies [ef8e020]
- Updated dependencies [7adf898]
- Updated dependencies [bc07ee4]
- Updated dependencies [efaf321]
- Updated dependencies [e95a3cd]
- Updated dependencies [a83b660]
- Updated dependencies [0b11ca5]
- Updated dependencies [f927d7a]
- Updated dependencies [b73f4a4]
- Updated dependencies [b3442b8]
- Updated dependencies [2eb9463]
- Updated dependencies [4266b56]
- Updated dependencies [ee9a96c]
- Updated dependencies [f43f589]
- Updated dependencies [ca67ac1]
- Updated dependencies [f44ed04]
- Updated dependencies [38bbf01]
- Updated dependencies [796a735]
- Updated dependencies [9628238]
- Updated dependencies [ef10de1]
- Updated dependencies [45f4392]
- Updated dependencies [0f37059]
- Updated dependencies [2b2f16a]
- Updated dependencies [47f4815]
- Updated dependencies [9099554]
- Updated dependencies [2b2f16a]
- Updated dependencies [45efc0d]
- Updated dependencies [4c8f116]
- Updated dependencies [25afdd9]
- Updated dependencies [2b2f16a]
- Updated dependencies [afb001d]
- Updated dependencies [374e083]
- Updated dependencies [1a1cffd]
- Updated dependencies [99e743c]
- Updated dependencies [0643637]
- Updated dependencies [0a31d08]
- Updated dependencies [32fe211]
- Updated dependencies [fcc4ef9]
- Updated dependencies [ed73de0]
- Updated dependencies [1a1cffd]
- Updated dependencies [434e8ad]
- Updated dependencies [0d85a42]
- Updated dependencies [20679c8]
- Updated dependencies [9840646]
- Updated dependencies [253a82c]
- Updated dependencies [1413dfd]
- Updated dependencies [5f5d801]
- Updated dependencies [434e8ad]
- Updated dependencies [d224253]
- Updated dependencies [374785f]
- Updated dependencies [c8ff07c]
- Updated dependencies [500dc1f]
- Updated dependencies [111e811]
- Updated dependencies [796a735]
- Updated dependencies [4536acf]
- Updated dependencies [374785f]
- Updated dependencies [5e3a417]
- Updated dependencies [4536acf]
- Updated dependencies [14a905d]
- Updated dependencies [9632069]
- Updated dependencies [202a842]
- Updated dependencies [5f94a1f]
  - @kujam/core@0.2.0
  - @kujam/renderer@0.2.0
  - @kujam/sync-yjs@0.2.0
