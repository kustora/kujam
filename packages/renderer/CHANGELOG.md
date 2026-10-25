# @kujam/renderer

## 0.2.0

### Minor Changes

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

- 20679c8: Live region untuk perubahan penting (BOARD-1903). Setiap view kini punya region `role="status"` tersembunyi yang membacakan elemen yang dibuat atau dihapus pengguna sendiri (termasuk undo/redo), kolaborator yang bergabung atau keluar, dan koneksi yang terputus, tersambung kembali, atau gagal. Pengumuman digabung dan dibatasi paling sering sekali per detik. Opsi baru `announcements: false` di `mountRenderer` mematikan pengumuman otomatis, dan `view.announce(message)` (beta) mengirim pesan aplikasi lewat region yang sama. Kamus core mendapat kunci `a11y.*` baru, dan `a11y.elementCreated` (id) kini berbunyi `{label} dibuat`.
- 9840646: `mountRenderer` dan kerangka tiga lapisan (BOARD-801).

  - `mountRenderer(board, container, options?)` menambahkan satu elemen root berisi Canvas utama, lapisan HTML, dan Canvas overlay yang bertumpuk. Hanya Canvas utama yang menerima input; lapisan di atasnya memakai `pointer-events: none`.
  - Ukuran mengikuti container lewat `ResizeObserver` (diamati pada root). Ukuran dalam piksel CSS dilaporkan ke `board.camera.setViewport`, dan ukuran backing canvas = ukuran CSS × `pixelRatio` (bawaan `devicePixelRatio` window milik container, bisa diganti lewat opsi `pixelRatio`).
  - `view.requestRender()` menggabungkan permintaan render menjadi satu `requestAnimationFrame`. Perubahan dokumen, kamera, seleksi, page, dan tool otomatis meminta render.
  - `view.unmount()` melepas DOM, `ResizeObserver`, semua listener board, dan frame yang tertunda; aman dipanggil berkali-kali dan berjalan otomatis saat board di-dispose.
  - `view.layers`, `view.size`, `view.pixelRatio`, dan `view.mounted` tersedia untuk tiket renderer berikutnya. Semua API browser diambil dari window milik container, tanpa state bersama, sehingga beberapa board di satu halaman tidak saling memengaruhi.
  - Menggambar elemen (BOARD-802), transform lapisan HTML (BOARD-804), overlay (BOARD-805), input (BOARD-806), dan batas ukuran canvas (BOARD-803) menyusul.

### Patch Changes

- 2b2f16a: Anchor komentar, snapshot versi, dan pengendalian ukuran dokumen Yjs (BOARD-1211, BOARD-1511, BOARD-1515):

  - `@kujam/core` (BOARD-1211): Tipe `Anchor` (`{ kind: 'point', x, y, pageId? }` atau `{ kind: 'element', elementId, offset }`) dan API `board.anchors`: `resolve`, `toScreen`, `fromPoint`, `forElement`, `track`/`untrack`/`get`/`list`, serta mode "tempatkan anchor" `place()` (satu klik di papan mengembalikan anchor, Esc/ganti tool membatalkan, tool sebelumnya dipulihkan, juga berjalan di papan baca saja). Event `anchor` (`move`, `remove`, `restore`) untuk anchor yang dilacak saat elemennya berpindah, dihapus, atau kembali (lokal, remote, undo, `loadDocument`). Helper `isAnchor` dan konstanta `ANCHOR_PLACE_TOOL_ID`. Package tetap tidak membuat sistem komentar.
  - `@kujam/renderer` (BOARD-1211): Lapisan slot `layers.anchors` di atas overlay dan `view.mountAnchor(element, anchor)` untuk pin aplikasi yang ikut kamera dan elemen, tetap berukuran layar, serta tersembunyi saat elemennya hilang atau berada di halaman lain.
  - `@kujam/sync-yjs` (BOARD-1511): `adapter.encodeSnapshot()`, `adapter.previewSnapshot(bytes)` (pratinjau baca saja tanpa memulihkan), dan `adapter.restoreSnapshot(bytes)` yang memulihkan papan sebagai satu perubahan lokal baru: tersinkron ke semua peer, satu langkah undo, tidak menghapus riwayat orang lain, dan ditolak pada klien baca saja. Helper mandiri `encodeSnapshot` dan `decodeSnapshot`.
  - `@kujam/sync-yjs` (BOARD-1515): `compactUpdate(updates)` memadatkan log update Yjs dengan encode ulang state pada `Y.Doc` ber-GC tanpa mengubah identitas CRDT. Dokumentasi garbage collection dan pemadatan berkala di server contoh, plus benchmark 10.000 operasi edit.

- 374785f: Perbaikan salin, potong, dan tempel papan di browser sungguhan (BOARD-906): saat tidak ada seleksi teks, browser mengirim event `copy`/`cut`/`paste` ke `<body>` meskipun fokus berada di papan, sehingga listener di root view tidak pernah menerimanya. Listener kini dipasang di dokumen dan menangani event yang ditujukan ke dalam view, atau ke `<body>` saat view ini yang memegang fokus. Dengan beberapa view dalam satu halaman, hanya view yang fokus yang menangani. Tempel antar tab diuji E2E lewat clipboard sistem.
- 6394412: Implementasi Tempel Konten Sistem, Command Palette, dan Minimap Kanvas (BOARD-907, BOARD-1405, BOARD-1406):
  - `BOARD-907`: Penempelan konten sistem clipboard lengkap pada kanvas. Teks pendek (<= 120 karakter satu baris) otomatis ditempel sebagai sticky note; teks panjang atau multibaris ditempel sebagai elemen teks terformat; tautan/URL memanggil hook `onPasteUrl` jika disediakan atau menjadi elemen teks; dibungkus dalam batch undo `'clipboard.paste'`.
  - `BOARD-1405`: Komponen command palette modal (`<kujam-command-palette>`), dipicu melalui tombol `/` (saat tidak dalam input teks) atau `Mod+K`, pencarian fuzzy perintah & tool dari registry, penyorotan status nonaktif (`aria-disabled`), navigasi keyboard (panah/Enter/Esc), dan dukungan sumber hasil kustom (`CommandPaletteSource`).
  - `BOARD-1406`: Komponen minimap kanvas interaktif (`<kujam-minimap>`), menampilkan peta radar elemen kanvas, indikator kotak viewport kamera semi-transparan, interaksi klik untuk memusatkan kamera dan drag untuk panning lancar, tombol ciutkan/perluas, serta loop pembaruan hemat daya (~100ms throttle).
- 67cb589: Menu klik kanan (context menu) dan komponen `<kujam-context-menu>` (BOARD-912, BOARD-1408):

  - Core: Interface `ContextMenuEvent`, tipe `ContextMenuItem`, fungsi `buildContextMenuItems`, dan helper `createContextMenuEvent` dengan fallback clipboard in-memory saat Clipboard API browser tidak tersedia.
  - Renderer: Deteksi klik kanan (button 2), event browser DOM `contextmenu` dengan auto-selection elemen yang diklik kanan, timer long-press (500ms) untuk input sentuh/pena, serta opsi `onContextMenu` pada renderer.
  - UI: Komponen bawaan `<kujam-context-menu>` (`ContextMenuElement`) dengan Shadow DOM, CSS tokens, keyboard navigation (ArrowUp/Down, Home, End, Esc), auto-clamping ke batas viewport, dismiss otomatis saat klik luar atau pergeseran kamera, dan integrasi ke `mountDefaultUi`.

- 9628238: Data luar untuk elemen kustom (BOARD-604, BOARD-605, BOARD-1201, BOARD-1202, BOARD-1203, BOARD-1206):

  - Core: runtime kontrak `resolve`. `board.getElementData(id, { load? })` menjalankan `resolve` elemen sekali dan menyimpan hasilnya; resolver di-cache per `(resolver, id)` dengan permintaan yang sedang berjalan dipakai bersama; `board.invalidate(resolver, id?)` hanya me-reset elemen yang memakai pasangan itu (event baru `data`); `board.reloadElementData(id)` untuk coba lagi. Kegagalan tidak di-cache dan dilaporkan sebagai `resolve-error`. `isResolveError` diekspor. `actions` dan `a11y` kini menerima data yang sudah siap; exception di `actions` hanya menghilangkan aksi elemen itu (`action-error`). `placeholder(reason)` kini juga dipanggil dengan `'loading'`.
  - Renderer: `render.html` dan `render.canvas` menerima data; `update` hanya dipanggil saat record atau data berubah, tidak saat kamera bergerak. Selama data dimuat, ditolak, tidak ditemukan, atau gagal, elemen menampilkan placeholder seukuran elemen (dengan tombol "Coba lagi" untuk error). Host HTML kini meneruskan event pointer ke tool papan; hanya node `data-board-interactive` yang menerima event sendiri.

  Panduan dan aturan keamanan untuk penulis plugin: `docs/custom-elements.md`.

- ef10de1: Klik dua kali kini berfungsi di Chromium dan Firefox. Browser tersebut mengirim `PointerEvent.detail` bernilai 0, sehingga `clickCount` selalu 1 dan klik dua kali pada shape, teks, atau sticky tidak pernah membuka editor teks. Renderer kini menghitung klik beruntun sendiri (jeda paling lama 500 ms, dalam ambang geser, jenis pointer sama) dan memakai `detail` hanya bila browser mengisinya.
- 45f4392: Teks tidak lagi tampil dobel saat diedit. Sejak ketikan langsung ditulis ke papan (BOARD-1503), canvas ikut menggambar teks di bawah editor inline dengan posisi sedikit bergeser; paling terlihat pada elemen teks, label shape, dan label konektor. `view.mountEditor(editor, bounds, elementId)` kini menerima ID elemen yang diedit, renderer meneruskan `lod.editingText: true` ke `render.canvas` elemen itu, dan elemen bawaan melewati gambar teksnya (bentuknya tetap digambar). Elemen kustom dengan teks sendiri bisa memakai flag yang sama.
- 47f4815: Implementasi Elemen Struktur (Group & Frame) dan Tata Letak (BOARD-E09, BOARD-E11):
  - `BOARD-905`: Perintah susunan (`align.*`, `distribute.*`, `arrange.grid`, `arrange.row`), kalkulasi AABB rotasi, pengelompokan undo tunggal, dan integrasi keybinding/command registry.
  - `BOARD-1104`: Elemen grup (`group`), auto-bounds berdasarkan gabungan batas anak, dan auto-deletion grup kosong saat anak dilepas/dihapus.
  - `BOARD-909`: Manipulasi grup (`element.group` / `Mod+G`, `element.ungroup` / `Shift+Mod+G`), klik memilih grup terluar, double click untuk navigasi masuk anak grup (`enteredGroupId`), dan `Esc` untuk keluar.
  - `BOARD-1105`: Elemen frame (`frame`, `frameTool`), auto-parenting elemen di dalam frame baru, reparenting dinamis saat drag/drop, batas kedalaman nesting 1 tingkat, label judul frame zoom-independent, clipping kanvas pada layer renderer, dan runtime `board.frames.list()`.
  - `BOARD-914`: Pembuatan sticky berdampingan secara otomatis via tombol `Tab` (kanan) dan `Shift+Tab` (kiri) dengan `STICKY_TAB_GAP = 20`, pembungkusan baris baru saat batas viewport/frame penuh, dan aktivasi editor teks langsung.
- 2b2f16a: Ekspor SVG, PNG, teks polos, API `exportImage` terpadu, dan thumbnail klien (BOARD-1702, BOARD-1703, BOARD-1704, BOARD-1707, BOARD-1708, BOARD-1212):

  - `BOARD-1702`: `exportSVG(board, { ids, frameId, pageId, padding, background, scale, images, fonts, fontFaces, customElements })` mengekspor seluruh halaman, seleksi (beserta turunannya), atau satu frame (dipotong ke frame). Elemen bawaan direkam dari `render.canvas` sebagai vektor lewat konteks perekam canvas-ke-SVG; teks tetap `<text>`. Elemen kustom memakai `export.svg` (disanitasi: tanpa skrip, event handler, `foreignObject`, `<style>`, animasi, atau referensi eksternal; ID diberi prefiks), atau tangkapan raster `render.canvas` bila tidak ada (`customElements: 'vector'` untuk merekam sebagai vektor). Gambar di-resolve lewat `AssetAdapter` lalu disematkan sebagai data URI (bawaan) atau dirujuk lewat URL; font dirujuk lewat nama keluarga atau dideklarasikan/disematkan via `@font-face`. Frame yang memotong isinya menghasilkan `clipPath`. Semua teks dan atribut di-escape oleh serializer.
  - `BOARD-1703`: `exportPNG(board, { scale: 1..4, background, padding, maxCanvasSide, maxCanvasPixels })` melukis elemen langsung ke canvas 2D dengan `render.canvas` masing-masing. Gambar dibaca dengan CORS lebih dulu sehingga canvas tidak tercemar; bila gagal diganti placeholder dengan peringatan `image-cors`. Batas ukuran canvas dihormati dengan menurunkan skala (peringatan `scale-reduced`); bila elemen kustom tetap mencemari canvas, gambar dilukis ulang dengan placeholder (peringatan `tainted`).
  - `BOARD-1704`: `exportText(board, { ids, frameId, pageId, separator })` menghasilkan teks polos dari `export.text` setiap elemen (termasuk elemen kustom beserta datanya), berurutan per frame lalu posisi baca (atas ke bawah, kiri ke kanan).
  - `BOARD-1707`: `exportImage(board, { format: 'png' | 'svg' | <format plugin>, ... })` dan `listExportFormats(board)`; eksportir plugin dari `definePlugin({ exporters })` dipanggil lewat API yang sama (format bawaan tidak dapat ditimpa).
  - `BOARD-1708`: `createThumbnail(board, { width, height, padding, background, type, quality })` membuat thumbnail di klien dengan render ringkas (`lod.compact: true`), tanpa jaringan dan tanpa menunggu data, sebagai fallback `renderThumbnail` di server.
  - `BOARD-1212`: pohon aksesibilitas memperbarui peran dan label `a11y(el, data)` saat data resolver tiba (event `data`); ekspor SVG memakai `export.svg` dan ekspor teks memakai `export.text`.
  - Peringatan per elemen (`ExportWarning`) dikembalikan di hasil; kesalahan fatal dilempar sebagai `ExportError`.
  - `@kujam/renderer`: `createDrawingContext` kini diekspor (`@beta`) agar `@kujam/export` memakai helper gambar yang sama (`roundRect`, `drawThumbnail`, dan lainnya).

- 45efc0d: Konektor fleksibel dan kursor yang mengikuti hover:

  - Konektor baru kini berjalur siku (`elbow`) secara bawaan, seperti FigJam, dan sudut jalur siku digambar membulat.
  - Saat satu konektor siku terpilih, segmen tengahnya diberi pegangan berbentuk pil. Menggeser pegangan memindahkan segmen itu dan menyimpannya sebagai prop opsional baru `bend` (`{ axis, offset }`, offset dari titik tengah antara kedua ujung), sehingga segmen ikut bergeser saat shape yang terhubung dipindah. Segmen tetap di sisi luar sisi yang terikat, sehingga jalur tidak menembus shape. Dokumen lama tanpa `bend` tetap valid.
  - Sorotan konektor terpilih kini mengikuti jalurnya, bukan garis lurus dari ujung ke ujung.
  - Kursor papan kini mengikuti tool aktif (`board.cursor` diterapkan oleh renderer; sebelumnya selalu default). Tool pilih menampilkan kursor sesuai yang di-hover: panah resize mengikuti arah handle (termasuk elemen yang diputar), `grab` di handle rotasi, panah geser di pegangan segmen, dan crosshair di titik quick connect dan ujung konektor.
  - API baru: `ctx.setCursor()` di konteks tool, `segmentHandles()` dan `SegmentHandle` di `@kujam/core`, `ConnectorBend` di `@kujam/shapes`.

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

- 1a1cffd: Overlay Kolaborasi Remote (BOARD-808):
  - `BOARD-808`: Kursor dan seleksi orang lain di overlay.
    - Kursor berwarna dengan label nama pengguna remote, dihaluskan dengan interpolasi posisi (lerp) di antara update awareness.
    - Garis pembatas seleksi remote digambar sesuai warna collaborator dengan label nama di sudut kiri atas.
    - Goresan live remote dari awareness digambar sementara di lapisan overlay menggunakan `perfect-freehand` dengan eliminasi visual tanpa kedip (_zero-flicker deduplication_) ketika elemen permanen telah hadir di dokumen.
    - Timeout inaktivitas kursor otomatis (bawaan ~6 detik) yang memudarkan kursor bila tidak ada pergerakan terbaru.
- 434e8ad: Perbaiki `Illegal invocation` saat elemen mengubah properti canvas bawaan (misalnya `fillStyle`) lewat konteks gambar `render.canvas`; semua sticky gagal dirender di browser karena bug ini.
- 0d85a42: Posisi kursor lokal kini dikirim ke kolaborator lewat `board.presence` (BOARD-1504, ditemukan di BOARD-2410). Sebelumnya tidak ada lapisan yang mengisi `cursor` di presence, sehingga kursor remote tidak pernah tampil. Renderer memperbarui `cursor` (koordinat papan) pada setiap `pointermove`, termasuk saat hover, dan mengosongkannya saat pointer keluar dari kanvas. Throttle tetap ditangani lapisan presence.
- 253a82c: Transformasi elemen, render ringkas Canvas LOD, dan toolbar kontekstual untuk elemen kustom (BOARD-606, BOARD-1204, BOARD-1205):

  - Core: implementasi `board.replaceElements(ids, factory, options)` untuk mengganti elemen dengan posisi, ukuran, parent, dan indeks layer yang sama secara atomik dalam satu transaksi; connector bindings yang menempel dialihkan otomatis ke ID baru; riwayat undo/redo mengembalikan elemen lama dan binding persis. Mendukung factory sync dan async disertai pelacakan status transien `board.isReplacing(id)`.
  - Renderer: implementasi `LodManager` dengan histeresis zoom 5% untuk beralih antara render DOM HTML dan render Canvas ringkas (`lod.compact: true`) saat zoom di bawah ambang `compactBelowZoom`; drawing context wrapper dengan helper gambar (`roundRect`, `dot`/`colorDot`, `drawText`, `drawThumbnail` dengan `ThumbnailCache`); transisi bebas kedip dalam frame loop `mountRenderer`.
  - UI: `<kujam-selection-toolbar>` merender grup aksi multi-item dan tombol aksi tunggal untuk elemen kustom bersama kontrol gaya bawaan; penempatan otomatis menghindari tepi viewport dan membalik posisi ke bawah saat dekat tepi atas kanvas; terintegrasi dengan `board.runAction` dan auto-update via event `data`.

- 1413dfd: Menambahkan sistem i18n dengan kamus lengkap `id`/`en` (`board.t`, `board.i18n`, `createBoard({ messages })`, `definePlugin({ messages })`), sinkronisasi `prefers-reduced-motion` dan opsi `reducedMotion` di `mountRenderer`, pengamanan XSS tanpa `innerHTML` beserta aturan ESLint di seluruh package, serta audit `axe-core` di Playwright dan `docs/a11y-checklist.md` (`BOARD-1905`, `BOARD-1908`, `BOARD-1909`, `BOARD-2001`).
- 5f5d801: Migrasi dokumen massal, thumbnail Node, dan tes server di Node murni (BOARD-705, BOARD-1804, BOARD-1806):

  - Server: `migrateServerDocument` (JSON dan Yjs biner, pipeline sama dengan klien) dan `migrateServerBatch` (mode dry-run, callback `onMigrated`, laporan per dokumen).
  - Server: `renderThumbnail(doc, { width, plugins, canvasFactory })` menghasilkan PNG; `@napi-rs/canvas` opsional dengan error yang jelas bila tidak terpasang.
  - Renderer: `CanvasRenderer.render` menerima antarmuka `CanvasLike` (bukan `HTMLCanvasElement`), sehingga bisa berjalan di Node; `CanvasRenderer` dan `CanvasLike` kini diekspor.
  - Server kini boleh mengimpor `@kujam/renderer`.

- 434e8ad: Elemen garis (polyline) yang bisa diedit per titik (BOARD-1106):
  - `@kujam/shapes`:
    - Elemen baru `line` (`lineElement`, `linePropsSchema`, `LineProps`, `MAX_LINE_POINTS`) terdaftar di `defaultElements`: titik disimpan relatif terhadap kotak elemen, hit-testing mengikuti segmen, dan gaya garis (warna, ketebalan, putus-putus) serta kepala panah sama dengan konektor (pola dash dan `drawArrowhead` dipakai bersama).
    - Alat baru `line` (`lineTool`, pintasan `Shift+L`) di `defaultTools`: klik demi klik menambah titik, seret menambah titik awal dan akhir, klik dua kali atau Enter menyelesaikan (satu langkah undo), Backspace/Delete menghapus titik terakhir, Shift mengunci sudut 45°, dan Esc membatalkan. Pratinjau memakai `connectorPreview` yang sudah digambar overlay.
    - Alat `select` mendapat mode edit untuk satu garis terpilih: seret titik (`line-point`), klik atau seret pegangan di tengah segmen untuk menambah titik (`line-insert`), serta klik dua kali atau Alt+klik titik untuk menghapusnya (minimal 2 titik). Setiap gestur adalah satu langkah undo; rotasi garis dibakukan ke titik saat diedit.
    - Aksi gaya `line`: warna, ketebalan, gaya garis, ujung awal, dan ujung akhir; gaya diingat untuk alat `line`.
  - `@kujam/core`: helper `midpointHandles(points, minLength)` dan tipe `MidpointHandle`; string i18n `tool.line` dan `element.line`.
  - `@kujam/renderer`: overlay menggambar jalur, pegangan tiap titik, dan pegangan sisip di tengah segmen untuk garis terpilih; gerakan hover diteruskan ke alat `line` untuk pratinjau segmen berikutnya.
  - `@kujam/ui`: tombol `line` di toolbar utama setelah konektor, dengan pilihan warna dan ikon baru.
- 374785f: Polesan sentuh dan stylus (BOARD-911, ADR-004):

  - `@kujam/renderer`: tolak telapak tangan. Saat pena menempel, sentuhan jari diabaikan; pena yang turun saat ada jari membatalkan aksi jari itu. Opsi `touch` di `mountRenderer` serta `view.setTouchOptions()`/`view.touchOptions`: `fingers` bernilai `auto` (bawaan; jari berhenti menggambar setelah pena terdeteksi, lihat `view.penDetected`), `pan` ("pena menggambar, jari menggeser"), atau `draw` (tanpa tolak telapak tangan). Ketuk dua jari untuk undo dan tiga jari untuk redo (`tapGestures`). Inersia setelah geser dan pinch sentuh (`inertia`, mati saat reduced motion). Tekan lama lalu seret di area kosong membuat kotak seleksi; tekan lama tanpa seret di area kosong membuka menu konteks saat jari diangkat. Editor teks digeser agar tetap terlihat di atas keyboard virtual (`visualViewport`). Pena yang melayang dikirim ke semua tool dan ujung kuasnya dipratinjau di overlay.
  - `@kujam/core`: `ToolPointerEvent.predicted` berisi titik dari `getPredictedEvents()` dalam koordinat papan (tipe `PredictedPoint`), hanya untuk pratinjau.
  - `@kujam/shapes`: tool pena menggambar titik prediksi tanpa menyimpannya (`ActiveStroke.predicted`) dan menerbitkan `tip` (`BrushTipPreview`) untuk pena yang melayang. Handle resize, rotasi, titik garis, dan konektor punya area sentuh minimal 24 px CSS (`TOUCH_HANDLE_TOLERANCE_PX`).

- 5e3a417: A drag, selection box, or click no longer rolls back when a macOS trackpad reports a move with no button down before the release (Chromium then drops the pointer capture before `pointerup`). A lost capture or buttonless mouse move with no button pressed now ends the gesture as a release; a capture lost while a button is still down still cancels.
- 14a905d: Hook efek samping transaksi onUndo/onRedo, inferensi tipe props elemen, dan pendaftaran drag-drop objek aplikasi (BOARD-303, BOARD-607, BOARD-608):

  - Core: `tx.onUndo` & `tx.onRedo` untuk mendaftarkan hook efek samping dalam `board.transact`, dipanggil saat undo/redo dibalik/diaplikasikan ulang dengan context `{ label, origin }`. Callback async tidak memblokir kanvas dan error dilaporkan via event `error` (`undo-hook-error`).
  - Core: antarmuka declaration merging `BoardElementTypes` dan generic `board.getElement<T>()` serta `board.create<T>()` untuk membawa tipe props yang kuat di TypeScript.
  - Core & Renderer: `board.acceptDrop(type, handler)` untuk mendaftarkan custom/MIME drag types dan `board.dropAt(point, type, payload)` untuk drop terprogram. Terintegrasi penuh dengan HTML5 drag-and-drop di renderer kanvas beserta visual drop indicator di layer overlay.

- 9632069: Menambahkan helper runtime `deprecate(message)` (warn-once di mode development) pada `@kujam/core` (`BOARD-2301`), melengkapi tag rilis TSDoc (`@public`, `@beta`, `@internal`) serta laporan API publik `*.api.md` berbasis `@microsoft/api-extractor` untuk seluruh package (`BOARD-111`), pemeriksa CI changeset versi serentak (`BOARD-110`), serta `CHANGELOG.md` dan panduan migrasi `docs/MIGRATION.md` (`BOARD-2206`).
- Updated dependencies [2b2f16a]
- Updated dependencies [d50bfa6]
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
- Updated dependencies [45f4392]
- Updated dependencies [0f37059]
- Updated dependencies [2b2f16a]
- Updated dependencies [47f4815]
- Updated dependencies [9099554]
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
- Updated dependencies [20679c8]
- Updated dependencies [253a82c]
- Updated dependencies [1413dfd]
- Updated dependencies [434e8ad]
- Updated dependencies [d224253]
- Updated dependencies [374785f]
- Updated dependencies [c8ff07c]
- Updated dependencies [111e811]
- Updated dependencies [4536acf]
- Updated dependencies [374785f]
- Updated dependencies [4536acf]
- Updated dependencies [14a905d]
- Updated dependencies [9632069]
- Updated dependencies [202a842]
- Updated dependencies [5f94a1f]
  - @kujam/core@0.2.0
