# @kujam/vue

## 0.2.0

### Patch Changes

- 67cb589: Menu klik kanan (context menu) dan komponen `<kujam-context-menu>` (BOARD-912, BOARD-1408):

  - Core: Interface `ContextMenuEvent`, tipe `ContextMenuItem`, fungsi `buildContextMenuItems`, dan helper `createContextMenuEvent` dengan fallback clipboard in-memory saat Clipboard API browser tidak tersedia.
  - Renderer: Deteksi klik kanan (button 2), event browser DOM `contextmenu` dengan auto-selection elemen yang diklik kanan, timer long-press (500ms) untuk input sentuh/pena, serta opsi `onContextMenu` pada renderer.
  - UI: Komponen bawaan `<kujam-context-menu>` (`ContextMenuElement`) dengan Shadow DOM, CSS tokens, keyboard navigation (ArrowUp/Down, Home, End, Esc), auto-clamping ke batas viewport, dismiss otomatis saat klik luar atau pergeseran kamera, dan integrasi ke `mountDefaultUi`.

- 99e743c: Open source di bawah lisensi Apache-2.0: setiap package menyertakan `LICENSE` dan `NOTICE` di tarball npm, serta `license`, `repository`, `homepage`, dan `bugs` di `package.json`. Package dipublikasikan dengan akses publik. Komentar JSDoc tema dan warna tidak lagi merujuk dokumen design system internal; nilai token tidak berubah.
- 374785f: Wrapper komponen UI untuk React dan Vue (BOARD-1410): `Toolbar`, `ZoomControl`, `HistoryControl`, `SelectionToolbar`, `Minimap`, `CommandPalette` (prop `source`), `ContextMenu`, `PresenceBar`, dan `ShortcutHelp` merender elemen `@kujam/ui` dengan prop bertipe. `board` diteruskan sebagai properti DOM dan dilepas saat unmount. React meneruskan `className`, `style`, `id`, dan `ref` ke elemen; Vue meneruskan `class` dan `style`, dengan properti `element` di instance komponen. Adapter tidak mengimpor `@kujam/ui` (aturan arah impor BOARD-106), jadi aplikasi memanggil `defineUiElements()` sekali; tanpa itu muncul peringatan di konsol. Aman untuk SSR. Panduan mengganti UI seluruhnya dengan hooks ada di `docs/custom-ui.md`.
- c8ff07c: Hook `onDocumentSaved`, resize preset handler, dan dukungan SSR aman untuk Next.js dan Nuxt (BOARD-1210, BOARD-1213, BOARD-1308):

  - Core: Hook `onDocumentSaved` pada plugin yang dipanggil setelah storage adapter berhasil menyimpan dokumen dengan snapshot dokumen (diisolasi sehingga error tidak membatalkan penyimpanan), metode `board.notifyDocumentSaved(doc)`, dan kode error `'plugin-error'`.
  - Core: Helper `createPresetResizeHandler(presets)` untuk memetakan dimensi resize ke preset ukuran diskrit (seperti `'s'`, `'m'`, `'l'`), serta pengujian komprehensif mode `fixed-ratio`, `none`, dan fungsi kustom.
  - React: Dukungan SSR aman dengan `getServerSnapshot` pada `useSyncExternalStore` di `<Board>` sehingga rendering di server (Node/Next.js) tidak melempar error dan renderer hanya dipasang di klien (`useEffect`).
  - Vue: Verifikasi SSR aman di server (Node/Nuxt) dengan pengujian `vue/server-renderer` dan renderer hanya dipasang di klien (`onMounted`).
  - Docs: Panduan `docs/ssr-nextjs-nuxt.md` untuk integrasi Next.js App/Pages Router dan Nuxt 3.

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
- Updated dependencies [99e743c]
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
- Updated dependencies [111e811]
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
