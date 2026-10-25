# @kujam/core

## 0.2.0

### Minor Changes

- 6348589: Implementasi API perubahan tingkat tinggi: `board.create`, `board.update`, `board.delete` (BOARD-205).

  - `board.create(partialElement, options)`: Mengisi nilai bawaan `id` (nanoid), `index` di atas elemen teratas di halaman target via fractional indexing (`indexAbove`), `props` digabung di atas nilai bawaan tipe (`defaults`), validasi skema tipe elemen via `validateElementProps`, serta validasi batas `limits.maxElements`.
  - `board.update(id, patch, options)`: Menggabungkan patch dangkal dengan `props` digabung per kunci (`Object.assign`), divalidasi dengan skema tipe elemen, dan menolak pengubahan elemen `locked` kecuali diberikan opsi `force: true`.
  - `board.delete(ids, options)`: Menghapus satu atau sekumpulan elemen, secara otomatis melakukan cascade penghapusan elemen anak (frame/grup) secara rekursif dan binding yang menempel, serta menolak penghapusan elemen `locked` tanpa `force: true`.
  - Penanganan error: Operasi yang tidak valid memancarkan event `error` berkode `invalid-props` atau `limit-exceeded` dan mengembalikan `undefined` tanpa merusak state dokumen.

- c197881: Fungsi `createBoard` dan `board.dispose` (BOARD-211).

  - Menambahkan opsi konfigurasi `CreateBoardOptions`: `resolvers`, `assets`, `user`, `limits`, `permissions`, `readOnly`, `locale`, `document`, `plugins`.
  - Menambahkan validasi ketat untuk seluruh opsi masukan di `createBoard`.
  - Mengekspos properti `resolvers`, `assets`, `user`, `limits`, `permissions`, `readOnly`, `locale`, dan `disposed` pada antarmuka `Board`.
  - Penegakan `readOnly: true` menolak seluruh mutasi lokal (melempar `ReadOnlyBoardError`, undo/redo return `false`), namun kamera dan `loadDocument` tetap diizinkan.
  - Pembersihan total pada `board.dispose()`: idempoten, melepas event listeners, command registry, tool registry, history, dan store; melempar error pada pemanggilan method aktif sesudahnya; serta menjalankan teardown plugin terbalik.
  - Uji kebocoran memori membuktikan 100 instance board dibersihkan sepenuhnya oleh GC setelah `dispose()`.

- 903766d: Implementasi API baca: `board.query`, indeks spasial R-tree, dan `BoardElementTypes` (BOARD-206, BOARD-404, BOARD-607).

  - `board.query(filter)`: Mencari dan memfilter elemen berdasarkan `type`, `pageId`, `parentId` (termasuk `null` untuk root kanvas), serta `inBounds` yang memanfaatkan indeks spasial R-tree (`rbush`), dengan hasil terurut deterministik sesuai urutan lapisan (_fractional index_).
  - Indeks Spasial (`SpatialIndex` / `rbush`): Menghitung AABB elemen dengan mempertimbangkan ukuran dasar, rotasi (`rotation` 0–360 derajat), dan geometri lokal (`geometry`). Indeks terbarui secara inkremental dari event `change` tanpa dibangun ulang. Benchmark viewport query pada 5.000 elemen tercapai < 0.02 ms (jauh melampaui target < 1 ms).
  - Declaration Merging `BoardElementTypes`: Menyediakan titik perluasan global untuk inferensi tipe props otomatis pada `board.getElement<'type'>`, `board.query<'type'>`, `board.create<'type'>`, dan `board.update<'type'>`.
  - Migrasi Dokumen pada `board.loadDocument`: Menjalankan rantai migrasi dokumen plugin (`PluginMigrations`) sebelum validasi dan penerapan state dengan origin `'load'`.

- 0d85a42: `board.sync` (beta): adapter yang sedang terpasang lewat `attachSync`, atau `undefined`. Event papan baru `sync` (`{ adapter }`) dipancarkan saat adapter dipasang (sebelum `connect`, sehingga listener menerima perubahan status pertama) dan saat dilepas (setelah `disconnect`, termasuk lewat `board.dispose()`). Melepas attachment lama tidak menghapus adapter yang lebih baru.
- c49d99c: `defineBrush` dan registri kuas coretan (BOARD-603).

  - `defineBrush({ id, label?, strokeOptions?, blend? })` memvalidasi dan membekukan kuas. `strokeOptions` memetakan opsi perfect-freehand (`size`, `thinning`, `smoothing`, `streamline`, `taper`, `simulatePressure`) dengan rentang yang diperiksa; kunci lain dibuang. `blend` adalah salah satu `BRUSH_BLEND_MODES` (mode campur Canvas, bawaan `'source-over'`). Definisi tidak valid melempar `BrushError` berkode `invalid-brush`.
  - `board.brushes` (`register`, `get`, `list`, `resolve`): kuas dari `brushes` milik plugin didaftarkan saat pemasangan; ID kuas yang dipakai dua plugin melempar `BrushError` berkode `duplicate-brush`. `resolve(id)` mengembalikan kuas terdaftar, atau kuas pena (`DEFAULT_BRUSH_ID`) untuk ID yang tidak dikenal, sehingga coretan dari plugin yang tidak terpasang tetap tergambar dan ID kuasnya tetap tersimpan.
  - `ElementContext.resolveBrush(id)` dan parameter opsional kelima `ctx` di `render.canvas`, agar elemen bisa membaca registri kuas board.
  - `@kujam/shapes`: kuas bawaan `penBrush` (`pen`) dan `highlighterBrush` (`highlighter`, `multiply`) dipasang lewat `defaultElements`. Elemen `draw` memakai mode campur kuasnya; gambar perfect-freehand menyusul di BOARD-1002.

- bd12697: Kamera: `zoomToFit`, `zoomToSelection`, `zoomToBounds`, dan animasi (BOARD-402).

  - `board.camera.zoomToBounds(bounds, options?)` menampilkan kotak (format `BoxBounds` atau `{ x, y, w, h }`) di tengah viewport dengan padding (bawaan 32 px per sisi). `zoomToFit()` mencakup semua elemen page aktif, `zoomToSelection()` mencakup elemen terpilih. Ketiganya mengembalikan `false` bila tidak ada yang bisa dicakup atau ukuran viewport belum dilaporkan.
  - Opsi `maxZoom` membatasi zoom hasil fit; bawaannya 100% untuk `zoomToFit` dan `zoomToSelection` agar konten kecil tidak diperbesar berlebihan, dan batas `zoomRange` untuk `zoomToBounds`.
  - Animasi opsional lewat `animate: true` atau `{ duration, easing }` (bawaan 300 ms, ease-in-out). Pusat viewport diinterpolasi linear dan zoom secara geometris. Animasi dibatalkan oleh perubahan kamera lain, fit baru, `camera.stopAnimation()`, atau `board.dispose()`.
  - `reducedMotion`: opsi `createBoard({ reducedMotion })` dan `board.camera.setReducedMotion(value)`; bila aktif, animasi langsung melompat ke tujuan. Renderer mengisinya dari `prefers-reduced-motion` (BOARD-1905).
  - Opsi `createBoard({ frameScheduler })` untuk sumber frame dan waktu animasi; bawaannya `requestAnimationFrame` (atau `setTimeout` bila tidak ada) dan `performance.now()`, sehingga core tetap tanpa DOM.

- b51d845: Kamera: posisi, zoom, viewport, dan konversi koordinat (BOARD-401).

  - `board.camera` (`BoardCamera`): `get()`, `set({ x, y, zoom })`, dan `zoomRange`. `board.getCamera()` dan `board.setCamera()` tetap ada dan setara dengan `camera.get()`/`camera.set()`. Event `camera` hanya dipancarkan bila kamera benar-benar berubah.
  - Model koordinat: `x, y` kamera adalah titik papan di sudut kiri atas viewport, `zoom` adalah piksel CSS per satuan papan.
  - `camera.setViewport({ width, height })` diisi renderer; `camera.viewport` dan `camera.getViewportBounds()` memberi area papan yang terlihat.
  - `camera.screenToBoard(point)` dan `camera.boardToScreen(point)` untuk titik layar relatif terhadap kontainer papan.
  - `camera.zoomTo(zoom, anchor?)` dan `camera.zoomBy(factor, anchor?)`: zoom berpusat pada titik layar (kursor atau tengah pinch), bawaannya tengah viewport. Zoom tetap dijepit ke `zoomRange` (bawaan 10% sampai 400%, bisa diubah lewat `createBoard({ zoomRange })`).
  - `ZoomRange` dan `DEFAULT_ZOOM_RANGE` dipindah ke modul `camera.ts`; ekspor publiknya tidak berubah.

- 5efe9cd: Registri perintah per board (BOARD-503).

  - `board.run(id, args?)` menjalankan perintah terdaftar dan mengembalikan `false` bila `isEnabled` menolak. ID yang tidak terdaftar melempar `CommandError` (`unknown-command`).
  - `board.commands` dengan `register` (`@beta`, mengembalikan fungsi pelepas), `get`, `has`, `list`, dan `isEnabled`. ID ganda ditolak dengan `CommandError` (`duplicate-command`).
  - `defineCommand` memvalidasi definisi (`id` bernamespace seperti `'layer.bring-forward'`, `label` kunci i18n, `run`, `isEnabled` opsional) dan membekukannya. Tipe argumen perintah diinferensi di `run` dan `isEnabled`.

- 5ac555e: Migrasi per tipe elemen dan migrasi dokumen plugin (BOARD-702).

  - `ElementRecord.typeVersion` (opsional, kosong berarti 1) menyimpan versi tipe tempat props ditulis. `board.create` mengisinya dengan `version` definisi elemen.
  - Saat memuat (`loadDocument` dan `createBoard({ document })`), langkah `migrate` di `defineElement` dijalankan untuk setiap elemen yang `typeVersion`-nya lebih rendah dari `version` definisinya, lalu `typeVersion` diperbarui. Tipe yang tidak terdaftar tidak disentuh.
  - `BoardDocument.pluginVersions` (opsional) mencatat versi dokumen per plugin. Langkah `migrations` di `definePlugin` kini berkunci versi milik plugin itu sendiri (bukan `schemaVersion`), dijalankan setelah migrasi inti dan migrasi props, sesuai urutan pemasangan plugin. Papan baru langsung memakai versi terbaru, sehingga langkah plugin hanya berjalan pada dokumen yang dimuat.
  - Hasil migrasi diterapkan sebagai transaksi terpisah berasal `migration`, sehingga tidak masuk riwayat undo. Semua langkah menerima salinan beku; langkah yang gagal melempar `MigrationError` (dengan `source`) tanpa mengubah state papan. Bila gagal saat `createBoard`, papan di-dispose lalu error dilempar.

- 0106e46: `board.create` menolak `pageId` yang bukan page yang ada (BOARD-208).

  - Bila `pageId` (atau page aktif bawaan) tidak menunjuk ke record `page` di dokumen, `create` mengembalikan `undefined` dan memancarkan event `error` dengan kode baru `page-not-found` (`cause`: `{ pageId }`). Sebelumnya elemen tetap dibuat di page yang tidak ada, sehingga tidak pernah terlihat dan tidak ikut terhapus saat page dihapus.
  - `board.update` dengan `patch.pageId` ke page yang tidak ada juga ditolak dengan `page-not-found` (seluruh patch dibatalkan). Hanya perpindahan page yang diperiksa, sehingga elemen yang sudah berada di page yang tidak ada tetap bisa diubah atau dipindahkan ke page yang valid.
  - Dokumen tanpa record page sama sekali tidak bisa ditambah elemen sampai page dibuat lewat `board.pages.create`.

- e20dbd7: Perintah bawaan lewat plugin `defaultCommands` (BOARD-505).

  - Lapisan: `layer.bring-forward` (Mod+]), `layer.send-backward` (Mod+[), `layer.bring-to-front` (Shift+Mod+]), `layer.send-to-back` (Shift+Mod+[). Hanya index elemen yang berpindah yang diubah, di antara saudara dengan page dan induk yang sama; elemen terkunci tidak dipindah.
  - Kunci: `element.toggle-lock` (Shift+Mod+L), `element.lock`, dan `element.unlock`.
  - `element.duplicate` (Mod+D): menyalin elemen terpilih beserta turunannya dengan offset (bawaan 16, 16; bisa lewat argumen `{ offset }`), menaruh salinan di atas, dan memilih salinan. `element.delete` (Delete/Backspace) menghapus seleksi kecuali elemen terkunci. `selection.all` (Mod+A) memilih elemen tingkat atas yang tidak terkunci di page aktif.
  - Kamera: `camera.zoom-to-fit` (Shift+1) dan `camera.zoom-to-selection` (Shift+2) memakai `board.camera.zoomToFit` dan `zoomToSelection` (BOARD-402): konten dipusatkan dengan padding 32 px dan zoom paling besar 100%.
  - Setiap perintah yang mengubah dokumen adalah satu langkah undo. Perintah dinonaktifkan (`isEnabled`) bila tidak ada yang bisa diproses atau papan baca saja.
  - Pasang lewat `createBoard({ plugins: [defaultCommands, defaultElements, defaultTools] })`.

- 3a8d206: `defineElement` dan registri tipe elemen (BOARD-601).

  - `@kujam/core`: `defineElement` dengan kontrak 0.1 (`type`, `version`, `props`, `defaults`, `geometry`, `resize`, `render.canvas`, `onDoubleClick`, `migrate`, `a11y`, `export.text`) dan field 0.3 bertag `@beta` (`resolve`, `render.html`, `lod`, `actions`, `placeholder`). Tipe `el.props` diinferensi dari skema props di semua callback, dan `defaults` bertipe `Partial<props>`. Definisi divalidasi saat dibuat dan saat didaftarkan.
  - `@kujam/core`: `createElementRegistry()` dengan `register`, `get`, `has`, `list`, dan `validateElementProps`. Tipe ganda ditolak dengan `ElementDefinitionError` (`duplicate-type`). Registri belum tersambung ke `createBoard`.
  - `@kujam/core`: primitif geometri minimal `@beta` (`rect`, `ellipse`, `polygon`, `polyline`, tipe `Geometry`) dan antarmuka `ElementCanvasContext`, subset struktural Canvas 2D tanpa tipe DOM.
  - `@kujam/shapes`: elemen bawaan 0.1 (`stickyElement`, `drawElement`, `textElement`, `geoElement`) didefinisikan dengan `defineElement` dan diekspor sebagai `defaultElements`, bersama skema rich text ADR-008 (`richTextSchema`). `DEFAULT_ELEMENT_TYPES` kini hanya memuat elemen yang benar-benar tersedia (`sticky`, `draw`, `text`, `geo`).

- 01285d2: Dokumen dari versi lebih baru dibuka baca saja (BOARD-703).

  - Bila `schemaVersion` dokumen, `typeVersion` sebuah elemen terdaftar, atau versi dokumen sebuah plugin terpasang lebih tinggi dari yang dikenal, `loadDocument` dan `createBoard({ document })` tidak lagi melempar: dokumen dimuat apa adanya, papan masuk mode baca saja (`board.readOnly` bernilai `true`), dan event `error` berkode `document-too-new` dipancarkan dengan `cause` bertipe `DocumentTooNewReason`.
  - Dalam kondisi ini dokumen tidak pernah ditulis ulang: tidak ada migrasi yang dijalankan dan transaksi lokal ditolak, termasuk dari `setup` plugin.
  - Untuk dokumen awal `createBoard`, event dipancarkan secara asinkron agar listener yang didaftarkan tepat setelah `createBoard` menerimanya.
  - Memuat dokumen yang didukung mencabut mode baca saja paksa ini; opsi `readOnly` tetap berlaku.
  - `validateDocument` publik tetap menolak `schemaVersion` yang lebih baru.

- 51b29c9: Validasi dokumen masuk dan batas ukuran papan (BOARD-210).

  - `validateDocument(doc, registry?, { limits })` kini memeriksa props elemen terhadap skema tipe terdaftar (tipe tidak terdaftar dibiarkan, BOARD-209) serta batas ukuran: byte dokumen (UTF-8 JSON), jumlah elemen, dan titik per coretan (`props.points`). Hasilnya punya `invalidRecords` per ID record di samping `errors`. Fungsi yang sama dipakai klien (`createBoard`, `loadDocument`) dan server (`@kujam/server`).
  - `BoardLimits` dan `DEFAULT_BOARD_LIMITS` (10 MB, 5.000 elemen, 5.000 titik) dipakai bersama; semuanya bisa dikonfigurasi lewat `limits`. `board.create`/`board.update` menolak coretan yang melebihi `maxDrawPoints` dengan event `limit-exceeded`.
  - Record tidak valid dari dokumen masuk ditolak satu per satu dan dilaporkan sebagai event `error` berkode `invalid-record` (setelah event `change`); sisanya tetap dimuat. Untuk `createBoard({ document })`, laporan dikirim pada microtask berikutnya agar listener yang dipasang tepat setelah `createBoard` ikut menerimanya; tanpa listener `error`, laporan ditulis ke `console.error`.
  - Masalah tingkat dokumen (bentuk, versi skema, ukuran byte, jumlah elemen) tetap melempar `InvalidDocumentError` tanpa mengubah state.

- 3a8d206: Sistem event `board.on` lengkap dan riwayat undo/redo lokal (BOARD-207, BOARD-301).

  - `BoardEventMap` kini berisi `change`, `selection`, `camera`, `tool`, `action`, `error`, dan `history`, dengan tipe isi `CameraEvent`, `BoardErrorEvent`, `HistoryEvent`, serta `SelectionEvent`, `ToolEvent`, `ActionEvent` (`@beta`, sumbernya menyusul).
  - `setCamera` memancarkan event `camera` (`{ camera, previous }`) hanya bila kamera benar-benar berubah.
  - Event `error` membawa kode stabil (`BoardErrorCode`: `listener-error`, `invalid-props`, `invalid-record`, `forbidden`, `limit-exceeded`, `document-too-new`) dan `cause`.
  - **Perubahan perilaku:** listener yang melempar tidak lagi membuat `transact` melempar ulang error-nya. Error dipancarkan sebagai event `error` berkode `listener-error`; bila tidak ada listener `error`, atau listener `error` sendiri melempar, error dilaporkan ke `console.error` tanpa rekursi.
  - `board.undo()`, `board.redo()`, dan `board.history` (`canUndo`, `canRedo`, `limit`, `clear()`). Hanya transaksi `local` yang dicatat; undo/redo memakai origin `undo`/`redo` dengan label transaksi asli; perubahan lokal baru membuang tumpukan redo; `loadDocument` mengosongkan riwayat. Batas bawaan 200 langkah (`DEFAULT_HISTORY_LIMIT`), diubah lewat `createBoard({ history: { limit } })`.
  - Record yang diubah pihak lain (misalnya `remote`) setelah sebuah langkah dicatat tidak ikut dibalik oleh undo/redo; langkah yang tidak bisa dibalik sama sekali dibuang.
  - Event `history` (`{ canUndo, canRedo }`) dipancarkan saat salah satu nilainya berubah.

- ef8e020: Pustaka geometri dan hit-test (BOARD-403, BOARD-404).

  - Primitif baru `path(points, width?, closed?)` untuk coretan, menerima titik `{ x, y }` atau tuple `[x, y, tekanan]`. Elemen `draw` di `@kujam/shapes` kini memakai `path`.
  - Transformasi: `rotatePoint`, `localToBoard`, `boardToLocal`, dan tipe `ElementTransform` (record elemen bisa langsung dipakai).
  - Operasi: `geometryBounds` (tepat untuk elips berotasi), `containsPoint` dengan toleransi, `distanceToEdge`, `intersectsBox`, `containedInBox`, `intersectsPolygon` (lasso), dan `snapPoints` (sudut, tepi, tengah). Semua bekerja di koordinat lokal, atau koordinat papan bila `element` diberikan.
  - `toBoardTolerance(px, zoom)` mengubah toleransi piksel layar ke satuan papan.
  - `board.hitTest(point, { tolerance, pageId, includeLocked })` memakai indeks spasial dan mengembalikan elemen teratas sesuai urutan gambar: saudara menurut index lapisan, anak frame atau grup di atas kontainernya. Elemen `locked` dilewati kecuali `includeLocked`. `tolerance` dalam piksel layar, dikonversi dengan zoom kamera.
  - `computeElementAABB` kini memakai pustaka yang sama, sehingga AABB elips berotasi lebih rapat, dan geometri yang tidak dikenal jatuh ke kotak `w × h` elemen.
  - Cakupan tes `geometry.ts` 100% dan dijaga lewat ambang coverage.

- 7adf898: Penggabungan langkah undo (coalescing) untuk interaksi kontinu (BOARD-302).

  - Satu seret lewat tool (pindah, resize, rotasi) tetap menjadi satu langkah undo walau menghasilkan banyak transaksi (mekanisme interaksi BOARD-501).
  - Opsi `mergeKey` di `board.transact`, `board.create`, `board.update`, dan `board.delete`: transaksi lokal dengan kunci yang sama digabung ke langkah terakhir selama jeda antartransaksi tidak melebihi `history.mergeWindowMs` (bawaan `DEFAULT_MERGE_WINDOW_MS`, 1 detik). Cocok untuk mengetik di teks; ganti kunci untuk memecah langkah, misalnya per kata.
  - `board.history.batch(key, fn)`: semua transaksi lokal di dalam `fn` digabung menjadi satu langkah, apa pun kuncinya dan berapa pun jedanya. Batch bersarang ikut batch terluar.
  - Penggabungan berhenti di undo, redo, perubahan pihak lain (remote), interaksi tool, dan `history.clear()`. Bila perubahan yang digabung saling meniadakan, langkahnya dihapus.
  - Opsi `createBoard({ history: { mergeWindowMs } })`, properti `board.history.mergeWindowMs`, dan field `mergeKey` di event `change`.

- bc07ee4: Keybinding yang bisa diganti (BOARD-504).

  - Plugin mendeklarasikan `keybindings` (`{ [shortcut]: idPerintah | 'tool:<id>' }`), dan pemakai lewat `createBoard({ keybindings })`. Bila bentrok, pemakai menang; plugin yang dipasang belakangan menang atas yang lebih awal. Nilai `null` dari pemakai menghapus shortcut plugin.
  - Notasi lintas platform: `Mod` = Cmd di macOS dan Ctrl di platform lain (`createBoard({ platform })`, bawaan dideteksi dari `navigator`). Modifier harus cocok persis. Tombol yang karakternya berubah karena layout atau modifier (misalnya Shift+1 → `!`) dicocokkan lewat tombol fisiknya (`event.code`).
  - `board.keybindings`: `list`, `get`, `forTarget` (untuk tooltip dan command palette), `set` (ganti saat runtime), `match`, dan `format` (label tampilan, misalnya `⇧⌘L` di macOS).
  - `board.dispatch` menjalankan shortcut yang cocok saat tool diam. Selama interaksi tool berlangsung, tombol hanya diteruskan ke tool. Event tombol dengan `inTextInput: true` diabaikan kecuali Esc.
  - `@kujam/shapes`: `defaultTools` memasang `V` untuk tool Pilih dan `H` untuk tool Tangan.

- efaf321: Dukungan page di model data (BOARD-208).

  - `board.pages`: `list()` (terurut menurut `index`), `get(id)`, `create(page?)`, `rename(id, name)`, `delete(id)`, `setCurrent(id)`, dan `current`. Nama bawaan page baru `Halaman N`, ditaruh setelah page terakhir.
  - Menghapus page menghapus semua elemennya (termasuk yang terkunci) beserta binding yang menempel dalam satu transaksi, jadi satu langkah undo memulihkan semuanya. Page terakhir tidak bisa dihapus.
  - Page aktif adalah state lokal (tidak disimpan dan tidak masuk undo). Bila page aktif terhapus (lokal, remote, atau `loadDocument`), papan pindah ke page tetangga. Event baru `page` dipancarkan saat page aktif berganti.
  - `board.query`, `board.hitTest`, dan `board.create` memakai page aktif bila `pageId` tidak diisi. Opsi baru `allPages: true` mencari di semua page.
  - Seleksi hanya berisi elemen di page aktif: berganti page mengosongkan seleksi, dan elemen yang dipindah ke page lain keluar dari seleksi.
  - Perubahan page melewati hook izin dengan aksi `'page.create'`, `'page.rename'`, dan `'page.delete'`; menghapus page juga memeriksa izin `'delete'` untuk setiap elemennya.

- e95a3cd: Hook izin `permissions(action, element, user)` (BOARD-212).

  - Hook izin aplikasi (`createBoard({ permissions })`) dan hook dari plugin (`definePlugin({ permissions })`) digabung dengan logika AND. Hook yang melempar exception dianggap menolak (_fail closed_).
  - Diperiksa sebelum `board.create`, `board.update`, dan `board.delete`. Bila ditolak, operasi dibatalkan dan event `error` berkode `forbidden` dipancarkan. Penghapusan batch dan kaskade bersifat atomik: satu elemen ditolak berarti tidak ada yang terhapus.
  - `board.can(action, element?)`: menguji izin tanpa memancarkan event, cocok untuk menonaktifkan tombol di UI.
  - `board.runAction(action, element)`: menjalankan aksi kontekstual elemen dengan pemeriksaan izin `'action'`.
  - `BoardUser.role` (opsional) untuk aturan berbasis peran. `board.permissions` kini mengembalikan hook gabungan.
  - Dokumentasi menegaskan hook ini hanya untuk kenyamanan UI; penegakan izin wajib di server.

- a83b660: `definePlugin` dan pemasangan plugin deterministik (BOARD-602).

  - `@kujam/core`: `definePlugin` dengan kontrak lengkap (`id`, `dependsOn`, `elements`, `tools`, `brushes`, `commands`, `keybindings`, `toolbarItems`, `exporters`, `migrations`, `permissions`, `onDocumentSaved`, `setup(board) => teardown`), `resolvePluginOrder`, dan `PluginError` (`invalid-plugin`, `duplicate-plugin`, `missing-dependency`, `circular-dependency`).
  - `@kujam/core`: opsi `createBoard({ plugins })`, `board.elements` (`ElementRegistry`), dan `board.plugins` (`get`, `has`, `list`). Pemasangan memvalidasi dan mengurutkan `dependsOn` secara deterministik, melakukan rollback bersih bila salah satu plugin gagal dipasang, serta menjalankan teardown dalam urutan terbalik saat `board.dispose()` (idempoten).
  - `@kujam/shapes`: `defaultElements` dan `defaultTools` didefinisikan sebagai plugin biasa memakai `definePlugin`.

- 0b11ca5: Store record bertransaksi, pembuat ID, dan fractional indexing (BOARD-201, BOARD-202, BOARD-204).

  - `board.transact(fn, { label, origin })`: semua perubahan record lewat transaksi. Transaksi bersarang digabung ke transaksi terluar, `fn` yang melempar membatalkan semua perubahan, dan satu transaksi memancarkan satu event `change` berisi `{ added, updated: { before, after }, removed, origin, label }`. Origin: `local`, `remote`, `undo`, `redo`, `load`, `migration` (`CHANGE_ORIGINS`).
  - `board.on('change', fn)` mengembalikan fungsi unsubscribe; listener tidak dibagi antar board.
  - Handle transaksi tingkat rendah `tx.get`, `tx.has`, `tx.put`, `tx.remove` (`@beta`); `create`/`update`/`delete` menyusul.
  - Papan `readOnly` menolak transaksi `local` dengan `ReadOnlyBoardError`; `loadDocument` tetap diizinkan dan kini memancarkan event `change` berasal `load`.
  - Snapshot memakai structural sharing; opsi `createBoard({ freezeSnapshots })` (bawaan `true`) mengatur pembekuan snapshot.
  - `createId()` (nanoid dibundel, memakai `crypto.getRandomValues` global) dan opsi `createBoard({ createId })` serta `board.createId()` untuk ID deterministik di tes.
  - Helper urutan `indexBetween`, `indexAbove`, `indexBelow`, `indicesBetween`, dan `compareIndex`.
  - `deepClone` kini menyalin kunci `__proto__` sebagai data biasa.

- f927d7a: Validasi URL tautan dan gambar (BOARD-2002).

  - `isSafeUrl(url, allowedSchemes?)` dan `sanitizeUrl(url, allowedSchemes?)`: bawaan hanya `https:` dan `http:` (`DEFAULT_URL_SCHEMES`); pemakai bisa menambah skema, dengan atau tanpa titik dua. URL harus absolut; URL relatif dan tanpa skema ditolak. Batas panjang bawaan 2048 (`MAX_URL_LENGTH`).
  - `javascript:`, `vbscript:`, `file:`, dan `about:` selalu ditolak walau didaftarkan, termasuk variasi huruf besar, spasi atau karakter kontrol di depan, tab dan baris baru di tengah, serta skema yang di-encode (`%6Aavascript:`, `&#106;avascript:`). `data:` hanya untuk gambar raster base64 (png, jpeg, gif, webp, avif) bila `data:` didaftarkan; SVG ditolak.
  - `safeLinkAttributes(url)` mengembalikan `{ href, target: '_blank', rel: 'noopener noreferrer' }` (`SAFE_LINK_REL`) untuk renderer dan UI, atau `null` bila URL tidak aman.
  - Primitif skema baru `url({ schemes?, maxLength? })` dengan kode issue `unsafe_url` (ADR-007), agar elemen kustom memakai aturan yang sama.
  - `@kujam/shapes`: atribut `link` rich text kini divalidasi dengan `url()` dan hanya menerima `https:`, `http:`, dan `mailto:` (`LINK_URL_SCHEMES`, ADR-008).

- b73f4a4: Migrasi skema inti bernomor (BOARD-701).

  - `CORE_MIGRATIONS`: daftar langkah `{ [versiAsal]: (doc) => doc }` milik package ini. Setiap versi dari 1 sampai `CURRENT_SCHEMA_VERSION - 1` wajib punya langkah.
  - `migrateSchema(doc, migrations?, targetVersion?)`: menjalankan langkah berurutan sampai `CURRENT_SCHEMA_VERSION`. Input tidak pernah diubah (langkah menerima salinan beku), dan `schemaVersion` hasil diisi oleh runner.
  - `MigrationError` (dengan `fromVersion`) dilempar bila langkah tidak ada, melempar, atau tidak mengembalikan objek.
  - `createBoard({ document })` dan `board.loadDocument` menjalankan migrasi inti sebelum validasi struktur.

- b3442b8: Tambah mini-lib skema validasi props dengan inferensi tipe (BOARD-203, ADR-007): `schema`, `object`, `string`, `number`, `boolean`, `literal`, `enumOf`, `array`, `optional`, `nullable`, `validate`, dan tipe `Infer`.
- 2eb9463: State seleksi lokal (BOARD-405).

  - `board.select(ids)`, `board.addToSelection(ids)`, `board.removeFromSelection(ids)`, dan `board.clearSelection()`, menerima satu ID atau array ID (`SelectionInput`). ID yang bukan elemen diabaikan dan duplikat dibuang; urutan seleksi dipertahankan.
  - `board.selection`: array ID beku yang tetap objek yang sama sampai seleksi berubah. `board.selectionBounds`: AABB gabungan elemen terpilih yang memperhitungkan rotasi dan geometri elemen, atau `null`.
  - Seleksi bukan bagian dokumen, tidak disimpan, dan tidak masuk riwayat undo. Tetap bisa dipakai di papan `readOnly`.
  - Elemen yang dihapus dari asal mana pun (lokal, remote, undo, `loadDocument`) otomatis keluar dari seleksi, setelah event `change`.
  - Event `selection` hanya dipancarkan bila seleksi benar-benar berubah.

- 4266b56: Snap ke elemen lain dan grid saat menyeret (BOARD-407).

  - `computeSnap(moving, targets, { threshold, grid })`: fungsi murni yang mencocokkan titik snap seleksi yang digeser dengan titik target dan grid, terpisah per sumbu x dan y. Kandidat terdekat dalam ambang menang; bila seri, elemen mengalahkan grid. Hasilnya berisi offset dan `guides` (garis panduan berkoordinat papan untuk overlay).
  - `snapTranslation(board, elements, delta, { modifiers })`: snap ke tepi, titik tengah tepi, dan pusat elemen yang terlihat di viewport pada page yang sama, serta ke grid. Ambang dalam piksel layar dikonversi dengan zoom kamera.
  - Pengaturan papan lewat `createBoard({ snap })`, `board.snapOptions`, dan `board.setSnapOptions(patch)`: `enabled`, `grid` (bawaan 8, `null` untuk mematikan), dan `threshold` (bawaan 8 px).
  - Ctrl/Cmd saat menyeret mematikan snap sementara (`isSnapSuppressed`).

- f43f589: Pemuatan dan penyimpanan otomatis berdebounce lewat `StorageAdapter` (BOARD-1601).

  - `attachStorage(board, adapter, { boardId })`: memuat dokumen dari `adapter.load` lalu menyimpan otomatis dengan debounce (bawaan 1.000 ms, bisa diatur lewat opsi `debounceMs` atau `adapter.debounceMs`). Penyimpanan otomatis baru aktif setelah pemuatan berhasil, sehingga gagal memuat tidak pernah menimpa data tersimpan dengan papan kosong.
  - Hanya perubahan berasal `local`, `undo`, `redo`, dan `migration` yang disimpan; `remote` dan `load` tidak.
  - Simpan terakhir dijalankan saat `board.dispose()` dan saat `pagehide` (target bisa diganti lewat opsi `lifecycle`).
  - Event `save:start`, `save:success`, dan `save:error` di handle `StorageAttachment`, dengan coba ulang backoff eksponensial (`retry: { maxAttempts, baseDelayMs, maxDelayMs }`, bawaan 5 percobaan, 1 s sampai 30 s).
  - Handle juga menyediakan `ready`, `status`, `dirty`, `flush()`, dan `detach()`.
  - Event papan baru `dispose`, dipancarkan sekali di awal `board.dispose()` sebelum teardown plugin.

- ca67ac1: State machine tool dan `defineTool` (BOARD-501), semuanya `@beta`.

  - `defineTool({ id, cursor, oneShot, initial, states, data })`. Nama state diinferensi dari kunci `states`, sehingga handler hanya boleh mengembalikan state yang ada, dan `ctx.data` bertipe sesuai `data`.
  - Event input ternormalisasi untuk renderer (`BoardInputEvent`): pointer (`pointerId`, `pointerType`, koordinat papan dan layar, tekanan, kemiringan, tombol, pengubah), keyboard, wheel, dan pinch. Renderer mengirimnya lewat `board.dispatch(event)`.
  - `board.tools`, `board.setTool(id)`, `board.tool`, `board.toolState`, `board.cursor`, event `tool`, dan opsi `createBoard({ defaultTool })`.
  - Interaksi tool: perubahan lewat `ctx.change` langsung terlihat, lalu menjadi satu langkah undo saat tool kembali ke state awal, atau di-rollback saat `cancel` (pointer-cancel, Esc, ganti tool, undo, atau handler yang melempar), sesuai ADR-004.
  - Esc kembali ke tool bawaan, tool `oneShot` kembali setelah satu interaksi, dan spasi ditahan mengaktifkan tool `hand` sementara.
  - `ToolEvent.id` kini `string | null`.

- f44ed04: Transformasi elemen sebagai fungsi murni: pindah, resize, dan rotasi (BOARD-406).

  - `moveElements`, `resizeElements(elements, handle, start, current, { keepRatio, registry })`, dan `rotateElements(elements, start, current, { snap, center, registry })` mengembalikan `TransformResult` (`x`, `y`, `w`, `h`, `rotation`, `flipX`, `flipY`) tanpa mengubah papan, sehingga tool bisa menghitung ulang dari snapshot awal di setiap gerakan pointer.
  - 8 handle (`RESIZE_HANDLES`): satu elemen di-resize dalam bingkai berotasinya sendiri dengan handle seberang tetap; banyak elemen diskalakan lewat batas gabungan seleksi (`selectionFrame`), dan `transformHandles` memberi posisi handle beserta handle rotasi.
  - Mode resize dari definisi elemen (`free`, `fixed-ratio`, `none`, atau fungsi kustom) dan ukuran minimum per tipe lewat field baru `minSize` di `defineElement` (bawaan 1 × 1).
  - Shift: `keepRatio` untuk resize, `snap: ROTATION_SNAP_DEGREES` (15 derajat) untuk rotasi. Resize melewati nol membalik kotak dan melaporkan `flipX`/`flipY`.

- 38bbf01: Elemen bertipe tidak terdaftar tetap disimpan utuh (BOARD-209).

  - Record elemen yang tipenya belum terpasang dimuat apa adanya (dokumen awal maupun `loadDocument`) tanpa validasi props, ikut terindeks spasial dan `board.query` sebagai kotak biasa.
  - Elemen tersebut bisa dipindah, di-resize, diputar, dikunci, dan dihapus (termasuk undo/redo) tanpa mengubah props. Patch `props` lewat `board.update` ditolak dengan event `error` berkode `invalid-props`, karena props tidak bisa divalidasi.
  - `board.create` untuk tipe tidak terdaftar tetap ditolak.
  - Tes round-trip memastikan simpan ulang menghasilkan props identik.

- 2b2f16a: Elemen sebagai drop target dan hook `onPasteUrl` untuk plugin (BOARD-1208, BOARD-1209):

  - `@kujam/core`:
    - `defineElement({ dropTarget: { accepts(dropped, target), onDrop(target, dropped, point, ctx) } })`: elemen bisa menerima elemen lain yang dijatuhkan ke atasnya. `ctx.updateProps(patch)` mengubah props target dan `ctx.removeDropped()` menghapus elemen yang dijatuhkan; tanpa itu elemen tetap dipertahankan di posisi lepasnya.
    - Fungsi `findDropTarget(board, ids, point)` dan `dropOnTarget(board, ids, point)`; seluruh `onDrop` berjalan dalam satu transaksi berlabel `element.drop`. Error di `accepts`/`onDrop` diisolasi menjadi event `error` berkode `plugin-error`, dan `onDrop` yang melempar error membatalkan seluruh perubahan drop.
    - Hook plugin `onPasteUrl(url, point, board) => ElementInput | null` (`PasteUrlHook`): plugin pertama menurut urutan pemasangan yang mengembalikan elemen menang. Fungsi `createElementFromUrl(board, url, point)` membuat elemen itu sebagai satu langkah undo (`clipboard.paste-url`), dan `isPastableUrl(text)` hanya meloloskan satu URL `http:`/`https:`. Package tidak pernah mengambil URL; metadata pratinjau diisi lewat `resolve` elemen dan resolver host, sehingga elemen langsung tampil dalam status memuat. Hook yang melempar error, mengembalikan Promise, atau mengembalikan nilai tidak valid dilaporkan sebagai `plugin-error` dan plugin berikutnya dicoba.
  - `@kujam/renderer`:
    - Tempel URL menjalankan hook `onPasteUrl` plugin (setelah opsi `onPasteUrl` renderer bila ada) dan memilih elemen yang dibuat; bila tidak ada plugin yang menangani, URL tetap ditempel sebagai teks.
    - Overlay menyorot elemen drop target (`toolData.dropTargetId`) dengan isian tipis dan garis tepi tebal; `OverlayRenderStats.dropTargetId`.
  - `@kujam/shapes`:
    - Tool select menghitung drop target di bawah pointer saat menggeser (`SelectToolData.dropTargetId`) dan menjalankan `dropOnTarget` saat dilepas di dalam interaksi yang sama, sehingga geser + drop = satu langkah undo. Bila target menyerap semua elemen yang diseret, target yang dipilih.

- 9099554: Ekspor dan impor JSON papan (BOARD-1701).

  - `exportJSON(board, { ids? })`: tanpa `ids` mengekspor seluruh dokumen (salinan, aman untuk `JSON.stringify`). Dengan `ids`, hanya elemen tersebut beserta anak-anaknya, binding di antara elemen yang diekspor, page tempat mereka berada, dan aset yang dirujuk props. Induk yang tidak ikut diekspor membuat elemen menjadi elemen akar.
  - `importJSON(board, json, { at? })`: menerima teks JSON atau objek dokumen. Isi melewati validasi, batas, dan migrasi yang sama dengan `loadDocument`; record tidak valid dibuang dan dilaporkan di `result.rejected`. Ke papan tanpa elemen, ID, page, dan index dipertahankan. Ke papan berisi, seperti tempel: semua record mendapat ID baru, elemen ditaruh di page aktif di atas elemen teratas dengan urutan tetap, dan induk serta binding dipetakan ulang (`result.idMap`). `at` menaruh titik tengah isi di titik papan tersebut.
  - Impor ditulis sebagai satu transaksi lokal berlabel `import` (satu langkah undo, ikut tersimpan otomatis). Gagal dengan `ImportError` (`read-only`, `document-too-new`, `limit-exceeded`, `forbidden`), `InvalidDocumentError`, atau `MigrationError` tanpa mengubah papan.
  - `@kujam/core`: `board.prepareDocument(doc)` menjalankan pipeline dokumen masuk yang sama dengan `loadDocument` (migrasi skema, validasi terhadap registri dan batas papan, migrasi elemen dan plugin) tanpa menyentuh papan, dan mengembalikan `{ document, rejected, tooNew }`.

- 25afdd9: Interaksi bawaan 0.1 (BOARD-901 sampai BOARD-904).

  - `@kujam/core`: perintah `camera.zoom-in`, `camera.zoom-out` (`Mod+=`, `Mod++`, `Mod+-`), dan `camera.zoom-reset` (`Mod+0`) di `defaultCommands`. `ZOOM_STEPS` dan `nextZoomStep` kini diekspor dari core.
  - `@kujam/shapes`: Alt+seret di tool pilih memindahkan salinan seleksi (dengan turunan dan binding internal) sebagai satu langkah undo. Klik elemen terkunci memilihnya tanpa handle; seret dari elemen terkunci menggambar kotak seleksi.
  - `@kujam/renderer`: elemen terkunci yang terpilih digambar dengan outline putus-putus tanpa handle.
  - `@kujam/ui`: `ZOOM_STEPS` dan `nextZoomStep` diekspor ulang dari core; tombol zoom menampilkan pintasannya.

- 2b2f16a: Seleksi laso dan elemen embed iframe ber-sandbox (BOARD-910, BOARD-1107, BOARD-2003):

  - `@kujam/core`: `containedInPolygon(geometry, area, element?)` untuk uji "tercakup penuh" terhadap poligon cekung atau berpotongan sendiri (aturan even-odd), memperhitungkan ketebalan garis dan rotasi; pasangan dari `intersectsPolygon`. Label i18n `tool.lasso`.
  - `@kujam/shapes`: tool `lasso` (masuk `defaultTools`) dan mode Ctrl/Cmd+seret di ruang kosong pada tool `select`. Poligon bebas memilih elemen yang tercakup penuh menurut kontur elemen (termasuk `line`); Alt untuk yang tersentuh, Shift menambah, Esc memulihkan seleksi. Helper `elementsInLasso`.
  - `@kujam/shapes`: elemen `embed` lewat `createEmbedElement({ domains })` / `createEmbedPlugin(...)`, **tidak** terdaftar di `defaultElements`. Hanya URL `https:`/`http:` dengan origin di daftar (persis atau `*.domain`) yang dimuat; lainnya tampil sebagai kartu "diblokir". Atribut `sandbox` selalu ada (kosong secara bawaan); token tambahan, `allow`, dan `referrerpolicy` hanya dari konfigurasi per origin, `allow-top-navigation` ditolak, dan origin aplikasi sendiri dengan `allow-scripts` + `allow-same-origin` diblokir. Iframe baru menerima pointer setelah klik dua kali (atau Enter), berhenti saat menekan di luar atau Esc. Dimuat malas lewat virtualisasi lapisan HTML dan diganti kartu canvas statis di bawah zoom 0,5. Helper `resolveEmbed`.
  - `@kujam/renderer`: overlay menggambar laso (`toolData.lasso`) sebagai poligon terisi bergaris putus-putus.
  - `@kujam/ui`: tombol toolbar dan ikon `lasso`.

- 434e8ad: Elemen garis (polyline) yang bisa diedit per titik (BOARD-1106):
  - `@kujam/shapes`:
    - Elemen baru `line` (`lineElement`, `linePropsSchema`, `LineProps`, `MAX_LINE_POINTS`) terdaftar di `defaultElements`: titik disimpan relatif terhadap kotak elemen, hit-testing mengikuti segmen, dan gaya garis (warna, ketebalan, putus-putus) serta kepala panah sama dengan konektor (pola dash dan `drawArrowhead` dipakai bersama).
    - Alat baru `line` (`lineTool`, pintasan `Shift+L`) di `defaultTools`: klik demi klik menambah titik, seret menambah titik awal dan akhir, klik dua kali atau Enter menyelesaikan (satu langkah undo), Backspace/Delete menghapus titik terakhir, Shift mengunci sudut 45°, dan Esc membatalkan. Pratinjau memakai `connectorPreview` yang sudah digambar overlay.
    - Alat `select` mendapat mode edit untuk satu garis terpilih: seret titik (`line-point`), klik atau seret pegangan di tengah segmen untuk menambah titik (`line-insert`), serta klik dua kali atau Alt+klik titik untuk menghapusnya (minimal 2 titik). Setiap gestur adalah satu langkah undo; rotasi garis dibakukan ke titik saat diedit.
    - Aksi gaya `line`: warna, ketebalan, gaya garis, ujung awal, dan ujung akhir; gaya diingat untuk alat `line`.
  - `@kujam/core`: helper `midpointHandles(points, minLength)` dan tipe `MidpointHandle`; string i18n `tool.line` dan `element.line`.
  - `@kujam/renderer`: overlay menggambar jalur, pegangan tiap titik, dan pegangan sisip di tengah segmen untuk garis terpilih; gerakan hover diteruskan ke alat `line` untuk pratinjau segmen berikutnya.
  - `@kujam/ui`: tombol `line` di toolbar utama setelah konektor, dengan pilihan warna dan ikon baru.
- d224253: Tool Pilih (`select`) dan Tangan (`hand`) bawaan di `defaultTools` (BOARD-502).

  - `selectTool`: klik memilih, Shift+klik menambah atau melepas, klik di ruang kosong mengosongkan seleksi; seret di ruang kosong menggambar kotak seleksi (elemen tercakup penuh, atau tersentuh sebagian dengan Alt, Shift menambah); seret elemen memindah seleksi dengan snap (Ctrl/Cmd mematikan snap); handle resize (Shift menjaga rasio) dan handle rotasi (Shift kelipatan 15 derajat); klik dua kali meneruskan ke `onDoubleClick` tipe elemen. Elemen terkunci tidak bisa dikenai, dipilih lewat kotak, atau ditransformasi.
  - `handTool`: seret menggeser kamera. Kedua tool juga menangani wheel (geser; Ctrl/Cmd+wheel zoom di titik kursor) dan pinch.
  - Esc atau `pointer-cancel` membatalkan interaksi: posisi elemen di-rollback, seleksi dan kamera dikembalikan ke keadaan awal. Satu seretan menjadi satu langkah undo.
  - Core: `board.toolData` (data tool aktif untuk overlay, misalnya `SelectToolData.brush` dan `guides`), `board.elementContext` (konteks callback elemen; `emit` memancarkan event `action`), dan field opsional `clickCount` di event pointer untuk klik dua kali.

- 9632069: Menambahkan helper runtime `deprecate(message)` (warn-once di mode development) pada `@kujam/core` (`BOARD-2301`), melengkapi tag rilis TSDoc (`@public`, `@beta`, `@internal`) serta laporan API publik `*.api.md` berbasis `@microsoft/api-extractor` untuk seluruh package (`BOARD-111`), pemeriksa CI changeset versi serentak (`BOARD-110`), serta `CHANGELOG.md` dan panduan migrasi `docs/MIGRATION.md` (`BOARD-2206`).

### Patch Changes

- 2b2f16a: Anchor komentar, snapshot versi, dan pengendalian ukuran dokumen Yjs (BOARD-1211, BOARD-1511, BOARD-1515):

  - `@kujam/core` (BOARD-1211): Tipe `Anchor` (`{ kind: 'point', x, y, pageId? }` atau `{ kind: 'element', elementId, offset }`) dan API `board.anchors`: `resolve`, `toScreen`, `fromPoint`, `forElement`, `track`/`untrack`/`get`/`list`, serta mode "tempatkan anchor" `place()` (satu klik di papan mengembalikan anchor, Esc/ganti tool membatalkan, tool sebelumnya dipulihkan, juga berjalan di papan baca saja). Event `anchor` (`move`, `remove`, `restore`) untuk anchor yang dilacak saat elemennya berpindah, dihapus, atau kembali (lokal, remote, undo, `loadDocument`). Helper `isAnchor` dan konstanta `ANCHOR_PLACE_TOOL_ID`. Package tetap tidak membuat sistem komentar.
  - `@kujam/renderer` (BOARD-1211): Lapisan slot `layers.anchors` di atas overlay dan `view.mountAnchor(element, anchor)` untuk pin aplikasi yang ikut kamera dan elemen, tetap berukuran layar, serta tersembunyi saat elemennya hilang atau berada di halaman lain.
  - `@kujam/sync-yjs` (BOARD-1511): `adapter.encodeSnapshot()`, `adapter.previewSnapshot(bytes)` (pratinjau baca saja tanpa memulihkan), dan `adapter.restoreSnapshot(bytes)` yang memulihkan papan sebagai satu perubahan lokal baru: tersinkron ke semua peer, satu langkah undo, tidak menghapus riwayat orang lain, dan ditolak pada klien baca saja. Helper mandiri `encodeSnapshot` dan `decodeSnapshot`.
  - `@kujam/sync-yjs` (BOARD-1515): `compactUpdate(updates)` memadatkan log update Yjs dengan encode ulang state pada `Y.Doc` ber-GC tanpa mengubah identitas CRDT. Dokumentasi garbage collection dan pemadatan berkala di server contoh, plus benchmark 10.000 operasi edit.

- d50bfa6: Implementasi camera.follow(userId) dengan animasi transisi halus dan auto-unfollow (BOARD-1506):
  - `@kujam/core`:
    - Menambahkan method `camera.follow(userId, options?)` dan `camera.unfollow()` serta properti `camera.following: string | null`.
    - Pelacakan kamera kolaborator yang berpusat pada layar (_center-compensated viewport tracking_) yang menyelaraskan titik tengah papan secara akurat lintas ukuran layar/resolusi perangkat yang berbeda.
    - Dukungan transisi perpindahan halus (_smooth camera transition animation_) dengan opsi `animate` dan opsi penyamaan zoom `syncZoom`.
    - Otomatis berhenti mengikuti (_auto-unfollow_) saat pengguna lokal melakukan interaksi manual (pan, zoom, fit) atau saat peer terputus/keluar.
    - Memancarkan event `'camera-follow'` dan `'follow'` (`CameraFollowEvent`) saat status target follow berubah.
  - `@kujam/sync-yjs`:
    - Menyertakan dimensi viewport pada state kamera ephemeral awareness sehingga adapter follower dapat mengompensasi perbedaan rasio dan resolusi layar secara presisi.
- 67cb589: Menu klik kanan (context menu) dan komponen `<kujam-context-menu>` (BOARD-912, BOARD-1408):

  - Core: Interface `ContextMenuEvent`, tipe `ContextMenuItem`, fungsi `buildContextMenuItems`, dan helper `createContextMenuEvent` dengan fallback clipboard in-memory saat Clipboard API browser tidak tersedia.
  - Renderer: Deteksi klik kanan (button 2), event browser DOM `contextmenu` dengan auto-selection elemen yang diklik kanan, timer long-press (500ms) untuk input sentuh/pena, serta opsi `onContextMenu` pada renderer.
  - UI: Komponen bawaan `<kujam-context-menu>` (`ContextMenuElement`) dengan Shadow DOM, CSS tokens, keyboard navigation (ArrowUp/Down, Home, End, Esc), auto-clamping ke batas viewport, dismiss otomatis saat klik luar atau pergeseran kamera, dan integrasi ke `mountDefaultUi`.

- ee9a96c: `attachStorage` tidak lagi mencoba ulang simpan yang gagal dengan error ber-`retryable: false` (misalnya `403` atau konflik versi dari `@kujam/storage-http`); `save:error` melaporkan `willRetry: false` dan status menjadi `'error'`. Helper baru `isRetryableStorageError(error)` (BOARD-1604).
- 796a735: `validateBoardRecord(record, registry?, { limits })` (beta): memvalidasi satu record dari sumber tidak tepercaya dengan aturan per record yang sama seperti `validateDocument` (struktur, props terhadap skema tipe terdaftar, batas titik coretan). Dipakai `@kujam/sync-yjs` untuk data dari peer (BOARD-2004).
- 9628238: Data luar untuk elemen kustom (BOARD-604, BOARD-605, BOARD-1201, BOARD-1202, BOARD-1203, BOARD-1206):

  - Core: runtime kontrak `resolve`. `board.getElementData(id, { load? })` menjalankan `resolve` elemen sekali dan menyimpan hasilnya; resolver di-cache per `(resolver, id)` dengan permintaan yang sedang berjalan dipakai bersama; `board.invalidate(resolver, id?)` hanya me-reset elemen yang memakai pasangan itu (event baru `data`); `board.reloadElementData(id)` untuk coba lagi. Kegagalan tidak di-cache dan dilaporkan sebagai `resolve-error`. `isResolveError` diekspor. `actions` dan `a11y` kini menerima data yang sudah siap; exception di `actions` hanya menghilangkan aksi elemen itu (`action-error`). `placeholder(reason)` kini juga dipanggil dengan `'loading'`.
  - Renderer: `render.html` dan `render.canvas` menerima data; `update` hanya dipanggil saat record atau data berubah, tidak saat kamera bergerak. Selama data dimuat, ditolak, tidak ditemukan, atau gagal, elemen menampilkan placeholder seukuran elemen (dengan tombol "Coba lagi" untuk error). Host HTML kini meneruskan event pointer ke tool papan; hanya node `data-board-interactive` yang menerima event sendiri.

  Panduan dan aturan keamanan untuk penulis plugin: `docs/custom-elements.md`.

- 45f4392: Teks tidak lagi tampil dobel saat diedit. Sejak ketikan langsung ditulis ke papan (BOARD-1503), canvas ikut menggambar teks di bawah editor inline dengan posisi sedikit bergeser; paling terlihat pada elemen teks, label shape, dan label konektor. `view.mountEditor(editor, bounds, elementId)` kini menerima ID elemen yang diedit, renderer meneruskan `lod.editingText: true` ke `render.canvas` elemen itu, dan elemen bawaan melewati gambar teksnya (bentuknya tetap digambar). Elemen kustom dengan teks sendiri bisa memakai flag yang sama.
- 0f37059: `testElementContract(def, options)` (BOARD-1207): pemeriksaan kontrak elemen kustom yang bisa dipakai ulang tanpa framework tes. Fungsi ini menjalankan setiap callback definisi seperti papan dan renderer memanggilnya (props contoh lolos skema, geometri berisi titik tengah, `resolve` memanggil resolver, `render.canvas` dengan dan tanpa data, `render.html` dengan `{ update, destroy }` bila `createHost` diberikan, `placeholder` untuk setiap alasan, `actions`, `a11y`, dan `export.text`), lalu mengembalikan daftar masalah. Pakai sebagai `expect(testElementContract(def, { data })).toEqual([])`.
- 47f4815: Implementasi Elemen Struktur (Group & Frame) dan Tata Letak (BOARD-E09, BOARD-E11):
  - `BOARD-905`: Perintah susunan (`align.*`, `distribute.*`, `arrange.grid`, `arrange.row`), kalkulasi AABB rotasi, pengelompokan undo tunggal, dan integrasi keybinding/command registry.
  - `BOARD-1104`: Elemen grup (`group`), auto-bounds berdasarkan gabungan batas anak, dan auto-deletion grup kosong saat anak dilepas/dihapus.
  - `BOARD-909`: Manipulasi grup (`element.group` / `Mod+G`, `element.ungroup` / `Shift+Mod+G`), klik memilih grup terluar, double click untuk navigasi masuk anak grup (`enteredGroupId`), dan `Esc` untuk keluar.
  - `BOARD-1105`: Elemen frame (`frame`, `frameTool`), auto-parenting elemen di dalam frame baru, reparenting dinamis saat drag/drop, batas kedalaman nesting 1 tingkat, label judul frame zoom-independent, clipping kanvas pada layer renderer, dan runtime `board.frames.list()`.
  - `BOARD-914`: Pembuatan sticky berdampingan secara otomatis via tombol `Tab` (kanan) dan `Shift+Tab` (kiri) dengan `STICKY_TAB_GAP = 20`, pembungkusan baris baru saat batas viewport/frame penuh, dan aktivasi editor teks langsung.
- 45efc0d: Konektor fleksibel dan kursor yang mengikuti hover:

  - Konektor baru kini berjalur siku (`elbow`) secara bawaan, seperti FigJam, dan sudut jalur siku digambar membulat.
  - Saat satu konektor siku terpilih, segmen tengahnya diberi pegangan berbentuk pil. Menggeser pegangan memindahkan segmen itu dan menyimpannya sebagai prop opsional baru `bend` (`{ axis, offset }`, offset dari titik tengah antara kedua ujung), sehingga segmen ikut bergeser saat shape yang terhubung dipindah. Segmen tetap di sisi luar sisi yang terikat, sehingga jalur tidak menembus shape. Dokumen lama tanpa `bend` tetap valid.
  - Sorotan konektor terpilih kini mengikuti jalurnya, bukan garis lurus dari ujung ke ujung.
  - Kursor papan kini mengikuti tool aktif (`board.cursor` diterapkan oleh renderer; sebelumnya selalu default). Tool pilih menampilkan kursor sesuai yang di-hover: panah resize mengikuti arah handle (termasuk elemen yang diputar), `grab` di handle rotasi, panah geser di pegangan segmen, dan crosshair di titik quick connect dan ujung konektor.
  - API baru: `ctx.setCursor()` di konteks tool, `segmentHandles()` dan `SegmentHandle` di `@kujam/core`, `ConnectorBend` di `@kujam/shapes`.

- 4c8f116: Bentuk flowchart seperti FigJam. Elemen `geo` mendapat dua bentuk baru: `triangle-down` (segitiga terbalik) dan `pill` (kotak dengan ujung membulat penuh, untuk mulai/selesai). Tool baru `diamond`, `triangle`, `triangle-down`, dan `pill` terdaftar di `defaultTools` (diekspor sebagai `diamondTool`, `triangleTool`, `triangleDownTool`, `pillTool`). Menu Bentuk di toolbar kini menampilkan keenam bentuk (kotak, elips, belah ketupat, segitiga, segitiga terbalik, pil) sebagai satu baris ikon, dengan nama dan shortcut di tooltip. Menu popup mendukung tata letak baru `layout: 'icons'`.
- afb001d: Switching tools (toolbar, `V`, or any other shortcut) while placing a line no longer throws away the points placed so far: the line tool finishes the line (2 points or more) and selects it, as one undo step. Esc still drops the unfinished line.

  In the tool runtime, the initial state's `onExit` of the tool being switched away from may now save unfinished work with `ctx.change`; the change is committed as its own undo step. Esc resets the tool's data before switching to the default tool, so nothing is saved then.

- 374e083: Implementasi Media Gambar, AssetResolver, dan Drag & Drop (BOARD-1103, BOARD-1906, BOARD-908):
  - `BOARD-1103`: Elemen gambar (`image`) dengan props `assetId` dan `crop`, delegasi resolusi biner ke `AssetAdapter` (`resolve` & `upload`), rendering kanvas dengan clipping rounded corners & kalkulasi koordinat sumber crop, pemuatan malas dengan `createImageBitmap` off-thread decoding, validasi URL (`isSafeUrl` / `sanitizeUrl` untuk `https:`, `http:`, `blob:`, `data:`), dan mode crop interaktif pada double click.
  - `BOARD-1906`: Teks alternatif gambar (`props.alt`), aksi kontekstual `image.alt`, dan pohon aksesibilitas dwibahasa (`a11y`) dengan label fallback dwibahasa (`Image` / `Gambar`).
  - `BOARD-908`: Drag and drop berkas gambar dari desktop serta paste gambar clipboard (`attachDragDrop`), penataan multi-gambar berdampingan dengan jarak 24px pada titik jatuh, penanganan siklus upload (`uploadStatus`: `'uploading'` -> `'ready'` / `'error'`), placeholder loading progress & error retry, serta penerusan berkas non-gambar ke `options.acceptDrop` atau `options.onDropRejected`.
- 99e743c: Open source di bawah lisensi Apache-2.0: setiap package menyertakan `LICENSE` dan `NOTICE` di tarball npm, serta `license`, `repository`, `homepage`, dan `bugs` di `package.json`. Package dipublikasikan dengan akses publik. Komentar JSDoc tema dan warna tidak lagi merujuk dokumen design system internal; nilai token tidak berubah.
- 0a31d08: Quick connect dan ikon toolbar seleksi:

  - Saat satu elemen yang bisa dihubungkan (shape, sticky, teks, gambar) terpilih dengan tool pilih, empat titik muncul di luar tengah setiap sisi. Drag dari titik membuat konektor yang terikat ke sisi itu (dan ke shape lain bila dilepas di atasnya); klik titik menaruh salinan elemen di sisi itu, terhubung dengan konektor. Keduanya satu langkah undo.
  - API baru: `connectable` di definisi elemen, `quickConnectHandles()` dan `QUICK_CONNECT_OFFSET_PX` di `@kujam/core`, serta `QUICK_CONNECT_RADIUS_PX` di `@kujam/renderer`. Gerakan hover kini juga diteruskan ke tool pilih.
  - Toolbar seleksi diberi jarak lebih jauh dari elemen sehingga tidak menutupi handle rotasi dan titik quick connect.
  - Isian shape, bentuk jalur konektor, dan ujung panah di toolbar seleksi kini tampil sebagai ikon, bukan teks.

- 32fe211: Implementasi Goresan Live Lewat Awareness (BOARD-1505):
  - `BOARD-1505`: Streaming titik goresan aktif bebas via Yjs Awareness (ephemeral) tanpa mencemari dokumen Y.Doc.
    - Streaming goresan live dengan throttling ~30 Hz (33ms) dan pengiriman seketika pada sapuan awal (_instant leading-edge flush_).
    - Satu kali commit permanen ke Y.Doc saat goresan selesai (`pointerUp`) dan pembersihan seketika dari awareness (`setLiveStroke(null)`).
    - Alokasi ID elemen di muka (`data.elementId` pada `DrawTool`) dan helper `getLiveStrokes` dengan eliminasi duplikasi visual saat elemen permanen tiba di store remote (_zero-flicker deduplication_).
    - Pembersihan seketika saat pembatalan sapuan (tombol Escape).
- fcc4ef9: Implementasi Realtime Collaboration Foundation (Epic BOARD-E15: BOARD-1501 & BOARD-1502):
  - `BOARD-1501`: Antarmuka sinkronisasi dan kolaborasi terpadu di `@kujam/core`.
    - Definisi tipe `SyncStatus` ('offline' | 'connecting' | 'synced' | 'error'), `PresenceUser`, `PresencePeerState`, `PresenceApi`, `HistoryApi`, `SyncEventMap`, dan `SyncAdapter`.
    - Fungsi `attachSync(board, adapter)` yang mengelola siklus hidup adapter, mengarahkan delegasi `board.undo()`, `board.redo()`, `board.history.canUndo`, `board.history.canRedo` ke `adapter.history`, dan mengembalikan `SyncAttachment` dengan `disconnect()`.
    - Implementasi in-memory sync bus (`createMemorySyncBus`) dan adapter (`createMemorySyncAdapter`) untuk pengujian konvergensi multi-papan tanpa server/backend eksternal. Perubahan remote diterapkan dengan `{ origin: 'remote', label: 'sync.remote' }` yang dilewati oleh undo lokal.
  - `BOARD-1502`: Binding store ke `Y.Doc` (record sebagai `Y.Map`) di `@kujam/sync-yjs`.
    - Pemetaan dua arah `BoardRecord` (elemen, page, binding, asset) ke `Y.Map<unknown>` di dalam peta dokumen `records`. Properti elemen `props` disimpan sebagai child `Y.Map` sehingga pembaruan concurrent pada properti berbeda menyatu di tingkat properti.
    - Penulisan perubahan lokal ke `Y.Doc` dalam satu transaksi atomik per transaksi papan dengan origin klien unik.
    - Penerimaan pembaruan remote via `observeDeep` dengan pencegahan echo (mengabaikan transaksi dari origin klien sendiri), validasi skema peer, dan penolakan record korup dengan pelaporan event error.
    - Inisialisasi dokumen kosong vs berpenghuni yang deterministik dan idempoten tanpa duplikasi record saat dibuka bersamaan oleh banyak klien.
- ed73de0: Implementasi Kolaborasi Teks Realtime dan Presence Awareness (Epic BOARD-E15: BOARD-1503 & BOARD-1504):
  - `BOARD-1503`: Teks sticky dan teks sebagai `Y.Text` dengan format attributes di `@kujam/sync-yjs` dan `@kujam/shapes`.
    - Pemetaan properti teks (`props.text` pada sticky/text dan `props.label` pada geo/connector) ke instance `Y.Text` dengan diffing awalan/akhiran karakter (`syncRichTextToYText`) dan sinkronisasi atribut format (tebal, miring, tautan).
    - Kolaborasi teks realtime: dua pengguna dapat mengetik bersamaan pada catatan sticky atau teks yang sama tanpa saling menimpa karakter.
    - Editor inline (`attachTextEditor` di `@kujam/shapes`): sinkronisasi langsung input lokal (`mergeKey: edit:<id>`) dan preservasi posisi kursor/caret (`getCaretCharacterOffset` & `setCaretCharacterOffset`) saat pembaruan teks remote tiba.
  - `BOARD-1504`: Presence lewat awareness (kursor, seleksi, kamera, pengguna) di `@kujam/sync-yjs` dan `@kujam/core`.
    - Penyebaran state awareness pengguna (`user`), kursor (`cursor` dengan throttling ~30 Hz / 33ms), seleksi elemen (`selection`), kamera (`camera`), dan tool aktif (`tool`).
    - Event `peer-join`, `peer-leave`, dan `change` untuk pelacakan kolaborator aktif.
    - Expose `board.presence` di instance `Board` melalui pendelegasian otomatis saat `attachSync`.
- 20679c8: Live region untuk perubahan penting (BOARD-1903). Setiap view kini punya region `role="status"` tersembunyi yang membacakan elemen yang dibuat atau dihapus pengguna sendiri (termasuk undo/redo), kolaborator yang bergabung atau keluar, dan koneksi yang terputus, tersambung kembali, atau gagal. Pengumuman digabung dan dibatasi paling sering sekali per detik. Opsi baru `announcements: false` di `mountRenderer` mematikan pengumuman otomatis, dan `view.announce(message)` (beta) mengirim pesan aplikasi lewat region yang sama. Kamus core mendapat kunci `a11y.*` baru, dan `a11y.elementCreated` (id) kini berbunyi `{label} dibuat`.
- 253a82c: Transformasi elemen, render ringkas Canvas LOD, dan toolbar kontekstual untuk elemen kustom (BOARD-606, BOARD-1204, BOARD-1205):

  - Core: implementasi `board.replaceElements(ids, factory, options)` untuk mengganti elemen dengan posisi, ukuran, parent, dan indeks layer yang sama secara atomik dalam satu transaksi; connector bindings yang menempel dialihkan otomatis ke ID baru; riwayat undo/redo mengembalikan elemen lama dan binding persis. Mendukung factory sync dan async disertai pelacakan status transien `board.isReplacing(id)`.
  - Renderer: implementasi `LodManager` dengan histeresis zoom 5% untuk beralih antara render DOM HTML dan render Canvas ringkas (`lod.compact: true`) saat zoom di bawah ambang `compactBelowZoom`; drawing context wrapper dengan helper gambar (`roundRect`, `dot`/`colorDot`, `drawText`, `drawThumbnail` dengan `ThumbnailCache`); transisi bebas kedip dalam frame loop `mountRenderer`.
  - UI: `<kujam-selection-toolbar>` merender grup aksi multi-item dan tombol aksi tunggal untuk elemen kustom bersama kontrol gaya bawaan; penempatan otomatis menghindari tepi viewport dan membalik posisi ke bawah saat dekat tepi atas kanvas; terintegrasi dengan `board.runAction` dan auto-update via event `data`.

- 1413dfd: Menambahkan sistem i18n dengan kamus lengkap `id`/`en` (`board.t`, `board.i18n`, `createBoard({ messages })`, `definePlugin({ messages })`), sinkronisasi `prefers-reduced-motion` dan opsi `reducedMotion` di `mountRenderer`, pengamanan XSS tanpa `innerHTML` beserta aturan ESLint di seluruh package, serta audit `axe-core` di Playwright dan `docs/a11y-checklist.md` (`BOARD-1905`, `BOARD-1908`, `BOARD-1909`, `BOARD-2001`).
- 374785f: Panel bantuan shortcut (BOARD-1409): elemen `<kujam-shortcut-help>` (`UI_TAGS.shortcutHelp`, ikut dipasang `mountDefaultUi`) dibuka dengan `?` di luar input teks dan ditutup dengan Esc, tombol Tutup, klik latar, atau `?` lagi. Daftarnya dibaca ulang dari `board.keybindings` setiap kali dibuka, jadi selalu mengikuti binding pemakai. Isinya dikelompokkan per target (tool dulu sesuai urutan registrasi, lalu perintah urut label) dan diformat per platform. Helper `buildShortcutHelp(board)` tersedia untuk UI buatan sendiri. Kamus `shortcuts.*` (id/en) ditambahkan di `@kujam/core`. Label 28 perintah bawaan (`command.history.*`, `command.layer.*`, `command.element.*`, `command.selection.*`, `command.camera.*`) kini ada di kamus id/en, sehingga command palette dan panel ini tidak lagi menampilkan key mentah.
- c8ff07c: Hook `onDocumentSaved`, resize preset handler, dan dukungan SSR aman untuk Next.js dan Nuxt (BOARD-1210, BOARD-1213, BOARD-1308):

  - Core: Hook `onDocumentSaved` pada plugin yang dipanggil setelah storage adapter berhasil menyimpan dokumen dengan snapshot dokumen (diisolasi sehingga error tidak membatalkan penyimpanan), metode `board.notifyDocumentSaved(doc)`, dan kode error `'plugin-error'`.
  - Core: Helper `createPresetResizeHandler(presets)` untuk memetakan dimensi resize ke preset ukuran diskrit (seperti `'s'`, `'m'`, `'l'`), serta pengujian komprehensif mode `fixed-ratio`, `none`, dan fungsi kustom.
  - React: Dukungan SSR aman dengan `getServerSnapshot` pada `useSyncExternalStore` di `<Board>` sehingga rendering di server (Node/Next.js) tidak melempar error dan renderer hanya dipasang di klien (`useEffect`).
  - Vue: Verifikasi SSR aman di server (Node/Nuxt) dengan pengujian `vue/server-renderer` dan renderer hanya dipasang di klien (`onMounted`).
  - Docs: Panduan `docs/ssr-nextjs-nuxt.md` untuk integrasi Next.js App/Pages Router dan Nuxt 3.

- 111e811: Mode Baca Saja per Klien di Sinkronisasi (BOARD-1512):
  - `BOARD-1512`: Klien mode _read-only_ pada adapter sinkronisasi.
    - Klien dengan `readOnly: true` (pada `createYjsSyncAdapter` maupun `createMemorySyncAdapter`) menerima seluruh pembaruan dokumen jarak jauh (remote updates) dan menyiarkan presence awareness (posisi kursor, kamera, seleksi).
    - Mencegah inisialisasi/seeding `recordsMap` kosong pada Y.Doc saat koneksi awal pengguna baca saja.
    - Memblokir pengiriman perubahan dokumen lokal ke Y.Doc (`recordsMap`) dan menonaktifkan streaming goresan live.
    - Mengatur `board.setReadOnly(true)` secara otomatis saat adapter terhubung ke papan tulis.
    - Menyediakan getter `adapter.readOnly` dan metode `adapter.setReadOnly(readOnly: boolean)` untuk mengganti mode secara dinamis saat runtime.
- 4536acf: Status Koneksi, Backoff Eksponensial, dan Isolasi Error Autentikasi (BOARD-1509):
  - `BOARD-1509`: Kontrol siklus status koneksi dan event rekoneksi pada adapter sinkronisasi.
    - Implementasi retry rekoneksi dengan backoff eksponensial (`calculateBackoffDelay` & `ReconnectController`) yang mendukung `initialDelayMs`, `maxDelayMs`, `backoffFactor`, serta random jitter.
    - Pembedaan event error autentikasi (`SyncAuthError`, status/kode 401/403/4401/4403, `{ reason: 'auth' }`) vs terputusnya jaringan (`{ reason: 'network' }`).
    - Kegagalan autentikasi memancarkan event `auth-error` dan membatalkan auto-retry untuk mencegah flood request ke server.
    - Putus jaringan beralih ke status `'connecting'` dan secara otomatis menjadwalkan rekoneksi bertahap.
    - Menambahkan tipe `SyncErrorDetail` pada `@kujam/core` dan event `'auth-error'` pada `SyncEventMap`.
- 374785f: Polesan sentuh dan stylus (BOARD-911, ADR-004):

  - `@kujam/renderer`: tolak telapak tangan. Saat pena menempel, sentuhan jari diabaikan; pena yang turun saat ada jari membatalkan aksi jari itu. Opsi `touch` di `mountRenderer` serta `view.setTouchOptions()`/`view.touchOptions`: `fingers` bernilai `auto` (bawaan; jari berhenti menggambar setelah pena terdeteksi, lihat `view.penDetected`), `pan` ("pena menggambar, jari menggeser"), atau `draw` (tanpa tolak telapak tangan). Ketuk dua jari untuk undo dan tiga jari untuk redo (`tapGestures`). Inersia setelah geser dan pinch sentuh (`inertia`, mati saat reduced motion). Tekan lama lalu seret di area kosong membuat kotak seleksi; tekan lama tanpa seret di area kosong membuka menu konteks saat jari diangkat. Editor teks digeser agar tetap terlihat di atas keyboard virtual (`visualViewport`). Pena yang melayang dikirim ke semua tool dan ujung kuasnya dipratinjau di overlay.
  - `@kujam/core`: `ToolPointerEvent.predicted` berisi titik dari `getPredictedEvents()` dalam koordinat papan (tipe `PredictedPoint`), hanya untuk pratinjau.
  - `@kujam/shapes`: tool pena menggambar titik prediksi tanpa menyimpannya (`ActiveStroke.predicted`) dan menerbitkan `tip` (`BrushTipPreview`) untuk pena yang melayang. Handle resize, rotasi, titik garis, dan konektor punya area sentuh minimal 24 px CSS (`TOUCH_HANDLE_TOLERANCE_PX`).

- 4536acf: Daftar Avatar Presence dan Indikator Status Koneksi (BOARD-1407):
  - `BOARD-1407`: Komponen Web Component `<kujam-presence-bar>` di `@kujam/ui`.
    - Menampilkan daftar avatar collaborator aktif dari `board.sync.presence.peers` (latar warna peer, avatar foto atau inisial nama, serta tooltip nama pengguna).
    - Interaksi follow: klik avatar memicu `board.camera.follow(userId)` dengan animasi transisi halus; klik kembali pada user yang sama membatalkan follow (`board.camera.unfollow()`).
    - Indikator visual cincin fokus dan badge aktif saat sedang mengikuti kolaborator remote.
    - Indikator visual status koneksi (`offline`, `connecting`, `synced`, `error`) dengan dot berwarna dan label teks yang dapat diterjemahkan (i18n).
    - Terintegrasi di `mountDefaultUi` pada pojok kanan atas kanvas.
- 14a905d: Hook efek samping transaksi onUndo/onRedo, inferensi tipe props elemen, dan pendaftaran drag-drop objek aplikasi (BOARD-303, BOARD-607, BOARD-608):

  - Core: `tx.onUndo` & `tx.onRedo` untuk mendaftarkan hook efek samping dalam `board.transact`, dipanggil saat undo/redo dibalik/diaplikasikan ulang dengan context `{ label, origin }`. Callback async tidak memblokir kanvas dan error dilaporkan via event `error` (`undo-hook-error`).
  - Core: antarmuka declaration merging `BoardElementTypes` dan generic `board.getElement<T>()` serta `board.create<T>()` untuk membawa tipe props yang kuat di TypeScript.
  - Core & Renderer: `board.acceptDrop(type, handler)` untuk mendaftarkan custom/MIME drag types dan `board.dropAt(point, type, payload)` untuk drop terprogram. Terintegrasi penuh dengan HTML5 drag-and-drop di renderer kanvas beserta visual drop indicator di layer overlay.

- 202a842: Adapter elemen kustom Vue, hook/composable useResolved, validasi server, dan ekstraksi referensi (BOARD-1305, BOARD-1306, BOARD-1801, BOARD-1802):

  - Vue: render elemen kustom dengan komponen Vue via prop `elements` pada `<Board>` menggunakan `<Teleport>`, mewarisi `provide`/`inject` aplikasi, menangani passthrough event `data-board-interactive`, serta helper `defineVueElement`.
  - React & Vue: hook dan composable `useResolved(board, resolver, id)` untuk membaca data resolver luar kanvas secara reaktif terhadap invalidasi.
  - Core: penambahan kontrak `references?(el)` pada `ElementDefinition` untuk deklarasi referensi eksternal elemen.
  - Server: `validateServerDocument` (validasi dokumen JSON dan biner Yjs tanpa DOM di Node 20 dengan mode strict) dan `extractReferences` (ekstraksi penempatan kartu untuk sinkronisasi database server).

- 5f94a1f: Implementasi Undo per orang dengan Yjs UndoManager (BOARD-1507):
  - `@kujam/sync-yjs`:
    - Menambahkan modul `createYjsHistory` yang mengimplementasikan `HistoryApi` berbasis `Y.UndoManager`.
    - Pelacakan origin terbatas pada origin klien sendiri (`trackedOrigins: new Set([clientOrigin])`) sehingga operasi undo/redo kolaborator hanya membalik perubahannya sendiri tanpa membatalkan perubahan kolaborator lain.
    - Preservasi penggabungan langkah (_coalescing_) berkelanjutan menggunakan `mergeKey` dan `captureTimeout` (1000ms), serta pemisahan langkah yang tepat dengan `stopCapturing()`.
    - Dukungan pelabelan transaksi pada `undoStack` dan `redoStack`.
    - Dukungan callback `tx.onUndo` dan `tx.onRedo` (BOARD-303) dengan konteks transaksi saat langkah dibatalkan atau diterapkan ulang.
    - Pemulihan seleksi elemen (_selection restoration_) setelah undo bila elemen yang terdampak masih ada di dokumen.
  - `@kujam/core`:
    - Menambahkan method `tx.onUndo(hook)` dan `tx.onRedo(hook)` pada antarmuka `Transaction`.
    - Memperluas `HistoryApi` dengan dukungan opsional untuk `batch`, `undoStack`, dan `redoStack`.
    - Mendelegasikan pemanggilan `board.history.batch()`, `board.history.undoStack`, dan `board.history.redoStack` ke adapter history yang terpasang.
