# @kujam/shapes

## 0.2.0

### Minor Changes

- c49d99c: `defineBrush` dan registri kuas coretan (BOARD-603).

  - `defineBrush({ id, label?, strokeOptions?, blend? })` memvalidasi dan membekukan kuas. `strokeOptions` memetakan opsi perfect-freehand (`size`, `thinning`, `smoothing`, `streamline`, `taper`, `simulatePressure`) dengan rentang yang diperiksa; kunci lain dibuang. `blend` adalah salah satu `BRUSH_BLEND_MODES` (mode campur Canvas, bawaan `'source-over'`). Definisi tidak valid melempar `BrushError` berkode `invalid-brush`.
  - `board.brushes` (`register`, `get`, `list`, `resolve`): kuas dari `brushes` milik plugin didaftarkan saat pemasangan; ID kuas yang dipakai dua plugin melempar `BrushError` berkode `duplicate-brush`. `resolve(id)` mengembalikan kuas terdaftar, atau kuas pena (`DEFAULT_BRUSH_ID`) untuk ID yang tidak dikenal, sehingga coretan dari plugin yang tidak terpasang tetap tergambar dan ID kuasnya tetap tersimpan.
  - `ElementContext.resolveBrush(id)` dan parameter opsional kelima `ctx` di `render.canvas`, agar elemen bisa membaca registri kuas board.
  - `@kujam/shapes`: kuas bawaan `penBrush` (`pen`) dan `highlighterBrush` (`highlighter`, `multiply`) dipasang lewat `defaultElements`. Elemen `draw` memakai mode campur kuasnya; gambar perfect-freehand menyusul di BOARD-1002.

- 3a8d206: `defineElement` dan registri tipe elemen (BOARD-601).

  - `@kujam/core`: `defineElement` dengan kontrak 0.1 (`type`, `version`, `props`, `defaults`, `geometry`, `resize`, `render.canvas`, `onDoubleClick`, `migrate`, `a11y`, `export.text`) dan field 0.3 bertag `@beta` (`resolve`, `render.html`, `lod`, `actions`, `placeholder`). Tipe `el.props` diinferensi dari skema props di semua callback, dan `defaults` bertipe `Partial<props>`. Definisi divalidasi saat dibuat dan saat didaftarkan.
  - `@kujam/core`: `createElementRegistry()` dengan `register`, `get`, `has`, `list`, dan `validateElementProps`. Tipe ganda ditolak dengan `ElementDefinitionError` (`duplicate-type`). Registri belum tersambung ke `createBoard`.
  - `@kujam/core`: primitif geometri minimal `@beta` (`rect`, `ellipse`, `polygon`, `polyline`, tipe `Geometry`) dan antarmuka `ElementCanvasContext`, subset struktural Canvas 2D tanpa tipe DOM.
  - `@kujam/shapes`: elemen bawaan 0.1 (`stickyElement`, `drawElement`, `textElement`, `geoElement`) didefinisikan dengan `defineElement` dan diekspor sebagai `defaultElements`, bersama skema rich text ADR-008 (`richTextSchema`). `DEFAULT_ELEMENT_TYPES` kini hanya memuat elemen yang benar-benar tersedia (`sticky`, `draw`, `text`, `geo`).

- ef8e020: Pustaka geometri dan hit-test (BOARD-403, BOARD-404).

  - Primitif baru `path(points, width?, closed?)` untuk coretan, menerima titik `{ x, y }` atau tuple `[x, y, tekanan]`. Elemen `draw` di `@kujam/shapes` kini memakai `path`.
  - Transformasi: `rotatePoint`, `localToBoard`, `boardToLocal`, dan tipe `ElementTransform` (record elemen bisa langsung dipakai).
  - Operasi: `geometryBounds` (tepat untuk elips berotasi), `containsPoint` dengan toleransi, `distanceToEdge`, `intersectsBox`, `containedInBox`, `intersectsPolygon` (lasso), dan `snapPoints` (sudut, tepi, tengah). Semua bekerja di koordinat lokal, atau koordinat papan bila `element` diberikan.
  - `toBoardTolerance(px, zoom)` mengubah toleransi piksel layar ke satuan papan.
  - `board.hitTest(point, { tolerance, pageId, includeLocked })` memakai indeks spasial dan mengembalikan elemen teratas sesuai urutan gambar: saudara menurut index lapisan, anak frame atau grup di atas kontainernya. Elemen `locked` dilewati kecuali `includeLocked`. `tolerance` dalam piksel layar, dikonversi dengan zoom kamera.
  - `computeElementAABB` kini memakai pustaka yang sama, sehingga AABB elips berotasi lebih rapat, dan geometri yang tidak dikenal jatuh ke kotak `w × h` elemen.
  - Cakupan tes `geometry.ts` 100% dan dijaga lewat ambang coverage.

- bc07ee4: Keybinding yang bisa diganti (BOARD-504).

  - Plugin mendeklarasikan `keybindings` (`{ [shortcut]: idPerintah | 'tool:<id>' }`), dan pemakai lewat `createBoard({ keybindings })`. Bila bentrok, pemakai menang; plugin yang dipasang belakangan menang atas yang lebih awal. Nilai `null` dari pemakai menghapus shortcut plugin.
  - Notasi lintas platform: `Mod` = Cmd di macOS dan Ctrl di platform lain (`createBoard({ platform })`, bawaan dideteksi dari `navigator`). Modifier harus cocok persis. Tombol yang karakternya berubah karena layout atau modifier (misalnya Shift+1 → `!`) dicocokkan lewat tombol fisiknya (`event.code`).
  - `board.keybindings`: `list`, `get`, `forTarget` (untuk tooltip dan command palette), `set` (ganti saat runtime), `match`, dan `format` (label tampilan, misalnya `⇧⌘L` di macOS).
  - `board.dispatch` menjalankan shortcut yang cocok saat tool diam. Selama interaksi tool berlangsung, tombol hanya diteruskan ke tool. Event tombol dengan `inTextInput: true` diabaikan kecuali Esc.
  - `@kujam/shapes`: `defaultTools` memasang `V` untuk tool Pilih dan `H` untuk tool Tangan.

- a83b660: `definePlugin` dan pemasangan plugin deterministik (BOARD-602).

  - `@kujam/core`: `definePlugin` dengan kontrak lengkap (`id`, `dependsOn`, `elements`, `tools`, `brushes`, `commands`, `keybindings`, `toolbarItems`, `exporters`, `migrations`, `permissions`, `onDocumentSaved`, `setup(board) => teardown`), `resolvePluginOrder`, dan `PluginError` (`invalid-plugin`, `duplicate-plugin`, `missing-dependency`, `circular-dependency`).
  - `@kujam/core`: opsi `createBoard({ plugins })`, `board.elements` (`ElementRegistry`), dan `board.plugins` (`get`, `has`, `list`). Pemasangan memvalidasi dan mengurutkan `dependsOn` secara deterministik, melakukan rollback bersih bila salah satu plugin gagal dipasang, serta menjalankan teardown dalam urutan terbalik saat `board.dispose()` (idempoten).
  - `@kujam/shapes`: `defaultElements` dan `defaultTools` didefinisikan sebagai plugin biasa memakai `definePlugin`.

- f927d7a: Validasi URL tautan dan gambar (BOARD-2002).

  - `isSafeUrl(url, allowedSchemes?)` dan `sanitizeUrl(url, allowedSchemes?)`: bawaan hanya `https:` dan `http:` (`DEFAULT_URL_SCHEMES`); pemakai bisa menambah skema, dengan atau tanpa titik dua. URL harus absolut; URL relatif dan tanpa skema ditolak. Batas panjang bawaan 2048 (`MAX_URL_LENGTH`).
  - `javascript:`, `vbscript:`, `file:`, dan `about:` selalu ditolak walau didaftarkan, termasuk variasi huruf besar, spasi atau karakter kontrol di depan, tab dan baris baru di tengah, serta skema yang di-encode (`%6Aavascript:`, `&#106;avascript:`). `data:` hanya untuk gambar raster base64 (png, jpeg, gif, webp, avif) bila `data:` didaftarkan; SVG ditolak.
  - `safeLinkAttributes(url)` mengembalikan `{ href, target: '_blank', rel: 'noopener noreferrer' }` (`SAFE_LINK_REL`) untuk renderer dan UI, atau `null` bila URL tidak aman.
  - Primitif skema baru `url({ schemes?, maxLength? })` dengan kode issue `unsafe_url` (ADR-007), agar elemen kustom memakai aturan yang sama.
  - `@kujam/shapes`: atribut `link` rich text kini divalidasi dengan `url()` dan hanya menerima `https:`, `http:`, dan `mailto:` (`LINK_URL_SCHEMES`, ADR-008).

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

### Patch Changes

- 45f4392: Teks tidak lagi tampil dobel saat diedit. Sejak ketikan langsung ditulis ke papan (BOARD-1503), canvas ikut menggambar teks di bawah editor inline dengan posisi sedikit bergeser; paling terlihat pada elemen teks, label shape, dan label konektor. `view.mountEditor(editor, bounds, elementId)` kini menerima ID elemen yang diedit, renderer meneruskan `lod.editingText: true` ke `render.canvas` elemen itu, dan elemen bawaan melewati gambar teksnya (bentuknya tetap digambar). Elemen kustom dengan teks sendiri bisa memakai flag yang sama.
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
- ed73de0: Implementasi Kolaborasi Teks Realtime dan Presence Awareness (Epic BOARD-E15: BOARD-1503 & BOARD-1504):
  - `BOARD-1503`: Teks sticky dan teks sebagai `Y.Text` dengan format attributes di `@kujam/sync-yjs` dan `@kujam/shapes`.
    - Pemetaan properti teks (`props.text` pada sticky/text dan `props.label` pada geo/connector) ke instance `Y.Text` dengan diffing awalan/akhiran karakter (`syncRichTextToYText`) dan sinkronisasi atribut format (tebal, miring, tautan).
    - Kolaborasi teks realtime: dua pengguna dapat mengetik bersamaan pada catatan sticky atau teks yang sama tanpa saling menimpa karakter.
    - Editor inline (`attachTextEditor` di `@kujam/shapes`): sinkronisasi langsung input lokal (`mergeKey: edit:<id>`) dan preservasi posisi kursor/caret (`getCaretCharacterOffset` & `setCaretCharacterOffset`) saat pembaruan teks remote tiba.
  - `BOARD-1504`: Presence lewat awareness (kursor, seleksi, kamera, pengguna) di `@kujam/sync-yjs` dan `@kujam/core`.
    - Penyebaran state awareness pengguna (`user`), kursor (`cursor` dengan throttling ~30 Hz / 33ms), seleksi elemen (`selection`), kamera (`camera`), dan tool aktif (`tool`).
    - Event `peer-join`, `peer-leave`, dan `change` untuk pelacakan kolaborator aktif.
    - Expose `board.presence` di instance `Board` melalui pendelegasian otomatis saat `attachSync`.
- 1413dfd: Menambahkan sistem i18n dengan kamus lengkap `id`/`en` (`board.t`, `board.i18n`, `createBoard({ messages })`, `definePlugin({ messages })`), sinkronisasi `prefers-reduced-motion` dan opsi `reducedMotion` di `mountRenderer`, pengamanan XSS tanpa `innerHTML` beserta aturan ESLint di seluruh package, serta audit `axe-core` di Playwright dan `docs/a11y-checklist.md` (`BOARD-1905`, `BOARD-1908`, `BOARD-1909`, `BOARD-2001`).
- e8d5d28: Perbaikan gaya shape dan alur tool shape:

  - Memilih warna isian pada shape tanpa isian kini juga mengubah isian menjadi penuh, sehingga warnanya langsung terlihat (sebelumnya tidak ada perubahan visual). Gaya ini diingat untuk shape berikutnya.
  - Popover warna di toolbar seleksi tampil sebagai grid swatch 5 kolom berjudul grup, bukan daftar vertikal yang bisa terpotong di atas layar.
  - Tool shape geometri (persegi, elips, dan lainnya) kembali ke mode pilih setelah satu shape digambar, dengan shape baru terpilih. Opsi baru `returnToSelect` di `createBoxTool` mengatur perilaku ini; sticky dan teks tetap aktif sampai Esc.

- 374785f: Polesan sentuh dan stylus (BOARD-911, ADR-004):

  - `@kujam/renderer`: tolak telapak tangan. Saat pena menempel, sentuhan jari diabaikan; pena yang turun saat ada jari membatalkan aksi jari itu. Opsi `touch` di `mountRenderer` serta `view.setTouchOptions()`/`view.touchOptions`: `fingers` bernilai `auto` (bawaan; jari berhenti menggambar setelah pena terdeteksi, lihat `view.penDetected`), `pan` ("pena menggambar, jari menggeser"), atau `draw` (tanpa tolak telapak tangan). Ketuk dua jari untuk undo dan tiga jari untuk redo (`tapGestures`). Inersia setelah geser dan pinch sentuh (`inertia`, mati saat reduced motion). Tekan lama lalu seret di area kosong membuat kotak seleksi; tekan lama tanpa seret di area kosong membuka menu konteks saat jari diangkat. Editor teks digeser agar tetap terlihat di atas keyboard virtual (`visualViewport`). Pena yang melayang dikirim ke semua tool dan ujung kuasnya dipratinjau di overlay.
  - `@kujam/core`: `ToolPointerEvent.predicted` berisi titik dari `getPredictedEvents()` dalam koordinat papan (tipe `PredictedPoint`), hanya untuk pratinjau.
  - `@kujam/shapes`: tool pena menggambar titik prediksi tanpa menyimpannya (`ActiveStroke.predicted`) dan menerbitkan `tip` (`BrushTipPreview`) untuk pena yang melayang. Handle resize, rotasi, titik garis, dan konektor punya area sentuh minimal 24 px CSS (`TOUCH_HANDLE_TOLERANCE_PX`).

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
