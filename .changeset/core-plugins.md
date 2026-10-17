---
'@kujam/core': minor
'@kujam/shapes': minor
---

`definePlugin` dan pemasangan plugin deterministik (BOARD-602).

- `@kujam/core`: `definePlugin` dengan kontrak lengkap (`id`, `dependsOn`, `elements`, `tools`, `brushes`, `commands`, `keybindings`, `toolbarItems`, `exporters`, `migrations`, `permissions`, `onDocumentSaved`, `setup(board) => teardown`), `resolvePluginOrder`, dan `PluginError` (`invalid-plugin`, `duplicate-plugin`, `missing-dependency`, `circular-dependency`).
- `@kujam/core`: opsi `createBoard({ plugins })`, `board.elements` (`ElementRegistry`), dan `board.plugins` (`get`, `has`, `list`). Pemasangan memvalidasi dan mengurutkan `dependsOn` secara deterministik, melakukan rollback bersih bila salah satu plugin gagal dipasang, serta menjalankan teardown dalam urutan terbalik saat `board.dispose()` (idempoten).
- `@kujam/shapes`: `defaultElements` dan `defaultTools` didefinisikan sebagai plugin biasa memakai `definePlugin`.
