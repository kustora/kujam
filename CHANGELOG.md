# Changelog (`@kujam/*`)

Seluruh package dalam keluarga `@kujam/*` (`@kujam/core`, `@kujam/renderer`, `@kujam/shapes`, `@kujam/sync-yjs`, `@kujam/storage-memory`, `@kujam/storage-indexeddb`, `@kujam/storage-http`, `@kujam/ui`, `@kujam/react`, `@kujam/vue`, `@kujam/export`, dan `@kujam/server`) dirilis **serentak (lockstep / fixed mode)** dengan nomor versi yang sama melalui [Changesets](./.changeset/config.json) (`BOARD-110`).

- Untuk panduan migrasi per rilis dan contoh kode **Sebelum / Sesudah** pada setiap perubahan yang memecah kompatibilitas (*breaking changes*) selama fase `0.x`, lihat **[Panduan Migrasi (`docs/MIGRATION.md`)](./docs/MIGRATION.md)** (`BOARD-2206`).
- Sesuai kebijakan `BOARD-2301` ([ADR-002](./docs/adr/ADR-002-technical-owner-and-api-review.md)), setiap API publik yang ditinggalkan (*deprecated*) akan memancarkan peringatan sekali lewat `deprecate(message)` di mode development selama **minimal satu rilis minor penuh** sebelum dihapus.

---

## [0.1.0] — Unreleased (Rilis Fondasi Papan Lokal)

### Ringkasan Rilis `0.1.0`

- **`@kujam/core`**:
  - Skema dokumen `BoardDocument` (`schemaVersion: 1`), validasi ketat `validateDocument`, batasan ukuran dokumen (`DEFAULT_BOARD_LIMITS`), dan isolasi record yang tidak dikenal (`UnknownElementRecord`).
  - Store bertransaksi (`board.transact`), event terketik (`board.on`), serta riwayat undo/redo lokal dengan penggabungan berjendela waktu (*coalescing*).
  - Kamera (`pan`, `zoom`, `zoomToFit`, `zoomToSelection`), indeks spasial R-tree (`rbush`), *hit-testing* (`board.hitTest`), *snapping* (`computeSnap`), serta manajemen multi-halaman (`board.pages`).
  - Sistem registri elemen (`defineElement`), kuas (`defineBrush`), state machine tool (`defineTool`), command (`defineCommand`), keybindings (`Mod+...`), clipboard (`serializeClipboard` / `parseClipboard`), tema (`light` / `dark`), dan plugin (`definePlugin`).
  - Utilitas peringatan usang `deprecate(message)` (warn-once di mode development, `BOARD-2301`).
- **`@kujam/renderer`**:
  - Arsitektur tiga lapisan (`mountRenderer`): Canvas 2D utama dengan *dirty-rect* & *spatial culling*, lapisan HTML bertransformasi kamera dengan virtualisasi viewport, dan lapisan overlay untuk seleksi, *handle* transformasi, garis bantu *snap*, serta kursor kolaborator.
  - Penanganan input terpadu (mouse, touch multi-jari, Apple Pencil / stylus dengan tekanan dan kemiringan, *wheel* / *pinch* trackpad), pembatasan piksel kanvas Safari iPadOS (`SAFARI_MAX_CANVAS_PIXELS`), pohon aksesibilitas (`A11yTree`), dan isolasi *error* render per elemen (`BOARD-810`).
- **`@kujam/shapes`**:
  - Elemen bawaan: `sticky` (catatan tempel dengan *auto-shrink font*), `draw` (coretan bebas dengan `perfect-freehand`, penyederhanaan RDP, dan *chunking* 5.000 titik), `text` (teks kaya `RichTextBlock[]` kanonikal ADR-008 + editor inline `contenteditable` aman IME), `geo` (8 bentuk geometri), dan `connector` (garis lurus, kurva Bezier, dan siku ortogonal menghindari rintangan + `BindingRecord` reaktif).
  - Tool bawaan: `select`, `hand`, `sticky`, `draw`, `eraser` (mode coretan & area), `text`, `geo`, dan `connector`.
- **`@kujam/storage-memory` & `@kujam/storage-indexeddb`**:
  - Adapter penyimpanan lokal dan in-memory yang mematuhi kontrak `StorageAdapter` dengan autosave *debounced* dan `flush()` saat tab ditutup.
- **`@kujam/ui`, `@kujam/react`, `@kujam/vue`**:
  - Web Components agnostik framework (`<kujam-toolbar>`, `<kujam-selection-toolbar>`, `<kujam-style-panel>`, `<kujam-zoom-bar>`), serta komponen dan hooks/composables untuk React 18/19 dan Vue 3.
- **`@kujam/export`**:
  - Ekspor dan impor dokumen JSON tervalidasi (`exportJSON`, `importJSON`).
