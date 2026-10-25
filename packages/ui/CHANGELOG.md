# @kujam/ui

## 0.2.0

### Minor Changes

- 2b2f16a: Seleksi laso dan elemen embed iframe ber-sandbox (BOARD-910, BOARD-1107, BOARD-2003):

  - `@kujam/core`: `containedInPolygon(geometry, area, element?)` untuk uji "tercakup penuh" terhadap poligon cekung atau berpotongan sendiri (aturan even-odd), memperhitungkan ketebalan garis dan rotasi; pasangan dari `intersectsPolygon`. Label i18n `tool.lasso`.
  - `@kujam/shapes`: tool `lasso` (masuk `defaultTools`) dan mode Ctrl/Cmd+seret di ruang kosong pada tool `select`. Poligon bebas memilih elemen yang tercakup penuh menurut kontur elemen (termasuk `line`); Alt untuk yang tersentuh, Shift menambah, Esc memulihkan seleksi. Helper `elementsInLasso`.
  - `@kujam/shapes`: elemen `embed` lewat `createEmbedElement({ domains })` / `createEmbedPlugin(...)`, **tidak** terdaftar di `defaultElements`. Hanya URL `https:`/`http:` dengan origin di daftar (persis atau `*.domain`) yang dimuat; lainnya tampil sebagai kartu "diblokir". Atribut `sandbox` selalu ada (kosong secara bawaan); token tambahan, `allow`, dan `referrerpolicy` hanya dari konfigurasi per origin, `allow-top-navigation` ditolak, dan origin aplikasi sendiri dengan `allow-scripts` + `allow-same-origin` diblokir. Iframe baru menerima pointer setelah klik dua kali (atau Enter), berhenti saat menekan di luar atau Esc. Dimuat malas lewat virtualisasi lapisan HTML dan diganti kartu canvas statis di bawah zoom 0,5. Helper `resolveEmbed`.
  - `@kujam/renderer`: overlay menggambar laso (`toolData.lasso`) sebagai poligon terisi bergaris putus-putus.
  - `@kujam/ui`: tombol toolbar dan ikon `lasso`.

### Patch Changes

- 6394412: Implementasi Tempel Konten Sistem, Command Palette, dan Minimap Kanvas (BOARD-907, BOARD-1405, BOARD-1406):
  - `BOARD-907`: Penempelan konten sistem clipboard lengkap pada kanvas. Teks pendek (<= 120 karakter satu baris) otomatis ditempel sebagai sticky note; teks panjang atau multibaris ditempel sebagai elemen teks terformat; tautan/URL memanggil hook `onPasteUrl` jika disediakan atau menjadi elemen teks; dibungkus dalam batch undo `'clipboard.paste'`.
  - `BOARD-1405`: Komponen command palette modal (`<kujam-command-palette>`), dipicu melalui tombol `/` (saat tidak dalam input teks) atau `Mod+K`, pencarian fuzzy perintah & tool dari registry, penyorotan status nonaktif (`aria-disabled`), navigasi keyboard (panah/Enter/Esc), dan dukungan sumber hasil kustom (`CommandPaletteSource`).
  - `BOARD-1406`: Komponen minimap kanvas interaktif (`<kujam-minimap>`), menampilkan peta radar elemen kanvas, indikator kotak viewport kamera semi-transparan, interaksi klik untuk memusatkan kamera dan drag untuk panning lancar, tombol ciutkan/perluas, serta loop pembaruan hemat daya (~100ms throttle).
- 67cb589: Menu klik kanan (context menu) dan komponen `<kujam-context-menu>` (BOARD-912, BOARD-1408):

  - Core: Interface `ContextMenuEvent`, tipe `ContextMenuItem`, fungsi `buildContextMenuItems`, dan helper `createContextMenuEvent` dengan fallback clipboard in-memory saat Clipboard API browser tidak tersedia.
  - Renderer: Deteksi klik kanan (button 2), event browser DOM `contextmenu` dengan auto-selection elemen yang diklik kanan, timer long-press (500ms) untuk input sentuh/pena, serta opsi `onContextMenu` pada renderer.
  - UI: Komponen bawaan `<kujam-context-menu>` (`ContextMenuElement`) dengan Shadow DOM, CSS tokens, keyboard navigation (ArrowUp/Down, Home, End, Esc), auto-clamping ke batas viewport, dismiss otomatis saat klik luar atau pergeseran kamera, dan integrasi ke `mountDefaultUi`.

- 4c8f116: Bentuk flowchart seperti FigJam. Elemen `geo` mendapat dua bentuk baru: `triangle-down` (segitiga terbalik) dan `pill` (kotak dengan ujung membulat penuh, untuk mulai/selesai). Tool baru `diamond`, `triangle`, `triangle-down`, dan `pill` terdaftar di `defaultTools` (diekspor sebagai `diamondTool`, `triangleTool`, `triangleDownTool`, `pillTool`). Menu Bentuk di toolbar kini menampilkan keenam bentuk (kotak, elips, belah ketupat, segitiga, segitiga terbalik, pil) sebagai satu baris ikon, dengan nama dan shortcut di tooltip. Menu popup mendukung tata letak baru `layout: 'icons'`.
- 25afdd9: Interaksi bawaan 0.1 (BOARD-901 sampai BOARD-904).

  - `@kujam/core`: perintah `camera.zoom-in`, `camera.zoom-out` (`Mod+=`, `Mod++`, `Mod+-`), dan `camera.zoom-reset` (`Mod+0`) di `defaultCommands`. `ZOOM_STEPS` dan `nextZoomStep` kini diekspor dari core.
  - `@kujam/shapes`: Alt+seret di tool pilih memindahkan salinan seleksi (dengan turunan dan binding internal) sebagai satu langkah undo. Klik elemen terkunci memilihnya tanpa handle; seret dari elemen terkunci menggambar kotak seleksi.
  - `@kujam/renderer`: elemen terkunci yang terpilih digambar dengan outline putus-putus tanpa handle.
  - `@kujam/ui`: `ZOOM_STEPS` dan `nextZoomStep` diekspor ulang dari core; tombol zoom menampilkan pintasannya.

- 99e743c: Open source di bawah lisensi Apache-2.0: setiap package menyertakan `LICENSE` dan `NOTICE` di tarball npm, serta `license`, `repository`, `homepage`, dan `bugs` di `package.json`. Package dipublikasikan dengan akses publik. Komentar JSDoc tema dan warna tidak lagi merujuk dokumen design system internal; nilai token tidak berubah.
- 0a31d08: Quick connect dan ikon toolbar seleksi:

  - Saat satu elemen yang bisa dihubungkan (shape, sticky, teks, gambar) terpilih dengan tool pilih, empat titik muncul di luar tengah setiap sisi. Drag dari titik membuat konektor yang terikat ke sisi itu (dan ke shape lain bila dilepas di atasnya); klik titik menaruh salinan elemen di sisi itu, terhubung dengan konektor. Keduanya satu langkah undo.
  - API baru: `connectable` di definisi elemen, `quickConnectHandles()` dan `QUICK_CONNECT_OFFSET_PX` di `@kujam/core`, serta `QUICK_CONNECT_RADIUS_PX` di `@kujam/renderer`. Gerakan hover kini juga diteruskan ke tool pilih.
  - Toolbar seleksi diberi jarak lebih jauh dari elemen sehingga tidak menutupi handle rotasi dan titik quick connect.
  - Isian shape, bentuk jalur konektor, dan ujung panah di toolbar seleksi kini tampil sebagai ikon, bukan teks.

- 253a82c: Transformasi elemen, render ringkas Canvas LOD, dan toolbar kontekstual untuk elemen kustom (BOARD-606, BOARD-1204, BOARD-1205):

  - Core: implementasi `board.replaceElements(ids, factory, options)` untuk mengganti elemen dengan posisi, ukuran, parent, dan indeks layer yang sama secara atomik dalam satu transaksi; connector bindings yang menempel dialihkan otomatis ke ID baru; riwayat undo/redo mengembalikan elemen lama dan binding persis. Mendukung factory sync dan async disertai pelacakan status transien `board.isReplacing(id)`.
  - Renderer: implementasi `LodManager` dengan histeresis zoom 5% untuk beralih antara render DOM HTML dan render Canvas ringkas (`lod.compact: true`) saat zoom di bawah ambang `compactBelowZoom`; drawing context wrapper dengan helper gambar (`roundRect`, `dot`/`colorDot`, `drawText`, `drawThumbnail` dengan `ThumbnailCache`); transisi bebas kedip dalam frame loop `mountRenderer`.
  - UI: `<kujam-selection-toolbar>` merender grup aksi multi-item dan tombol aksi tunggal untuk elemen kustom bersama kontrol gaya bawaan; penempatan otomatis menghindari tepi viewport dan membalik posisi ke bawah saat dekat tepi atas kanvas; terintegrasi dengan `board.runAction` dan auto-update via event `data`.

- 1413dfd: Menambahkan sistem i18n dengan kamus lengkap `id`/`en` (`board.t`, `board.i18n`, `createBoard({ messages })`, `definePlugin({ messages })`), sinkronisasi `prefers-reduced-motion` dan opsi `reducedMotion` di `mountRenderer`, pengamanan XSS tanpa `innerHTML` beserta aturan ESLint di seluruh package, serta audit `axe-core` di Playwright dan `docs/a11y-checklist.md` (`BOARD-1905`, `BOARD-1908`, `BOARD-1909`, `BOARD-2001`).
- e8d5d28: Perbaikan gaya shape dan alur tool shape:

  - Memilih warna isian pada shape tanpa isian kini juga mengubah isian menjadi penuh, sehingga warnanya langsung terlihat (sebelumnya tidak ada perubahan visual). Gaya ini diingat untuk shape berikutnya.
  - Popover warna di toolbar seleksi tampil sebagai grid swatch 5 kolom berjudul grup, bukan daftar vertikal yang bisa terpotong di atas layar.
  - Tool shape geometri (persegi, elips, dan lainnya) kembali ke mode pilih setelah satu shape digambar, dengan shape baru terpilih. Opsi baru `returnToSelect` di `createBoxTool` mengatur perilaku ini; sticky dan teks tetap aktif sampai Esc.

- 434e8ad: Elemen garis (polyline) yang bisa diedit per titik (BOARD-1106):
  - `@kujam/shapes`:
    - Elemen baru `line` (`lineElement`, `linePropsSchema`, `LineProps`, `MAX_LINE_POINTS`) terdaftar di `defaultElements`: titik disimpan relatif terhadap kotak elemen, hit-testing mengikuti segmen, dan gaya garis (warna, ketebalan, putus-putus) serta kepala panah sama dengan konektor (pola dash dan `drawArrowhead` dipakai bersama).
    - Alat baru `line` (`lineTool`, pintasan `Shift+L`) di `defaultTools`: klik demi klik menambah titik, seret menambah titik awal dan akhir, klik dua kali atau Enter menyelesaikan (satu langkah undo), Backspace/Delete menghapus titik terakhir, Shift mengunci sudut 45°, dan Esc membatalkan. Pratinjau memakai `connectorPreview` yang sudah digambar overlay.
    - Alat `select` mendapat mode edit untuk satu garis terpilih: seret titik (`line-point`), klik atau seret pegangan di tengah segmen untuk menambah titik (`line-insert`), serta klik dua kali atau Alt+klik titik untuk menghapusnya (minimal 2 titik). Setiap gestur adalah satu langkah undo; rotasi garis dibakukan ke titik saat diedit.
    - Aksi gaya `line`: warna, ketebalan, gaya garis, ujung awal, dan ujung akhir; gaya diingat untuk alat `line`.
  - `@kujam/core`: helper `midpointHandles(points, minLength)` dan tipe `MidpointHandle`; string i18n `tool.line` dan `element.line`.
  - `@kujam/renderer`: overlay menggambar jalur, pegangan tiap titik, dan pegangan sisip di tengah segmen untuk garis terpilih; gerakan hover diteruskan ke alat `line` untuk pratinjau segmen berikutnya.
  - `@kujam/ui`: tombol `line` di toolbar utama setelah konektor, dengan pilihan warna dan ikon baru.
- 374785f: Panel bantuan shortcut (BOARD-1409): elemen `<kujam-shortcut-help>` (`UI_TAGS.shortcutHelp`, ikut dipasang `mountDefaultUi`) dibuka dengan `?` di luar input teks dan ditutup dengan Esc, tombol Tutup, klik latar, atau `?` lagi. Daftarnya dibaca ulang dari `board.keybindings` setiap kali dibuka, jadi selalu mengikuti binding pemakai. Isinya dikelompokkan per target (tool dulu sesuai urutan registrasi, lalu perintah urut label) dan diformat per platform. Helper `buildShortcutHelp(board)` tersedia untuk UI buatan sendiri. Kamus `shortcuts.*` (id/en) ditambahkan di `@kujam/core`. Label 28 perintah bawaan (`command.history.*`, `command.layer.*`, `command.element.*`, `command.selection.*`, `command.camera.*`) kini ada di kamus id/en, sehingga command palette dan panel ini tidak lagi menampilkan key mentah.
- b35baff: Komponen UI kini memasang style lewat Constructable Stylesheets (`adoptedStyleSheets`), satu lembar per jenis komponen, sehingga berjalan dengan Content Security Policy ketat tanpa `style-src 'unsafe-inline'` (BOARD-2006). Browser tanpa `adoptedStyleSheets` tetap memakai elemen `<style>`. Lihat `docs/csp.md`.
- 4536acf: Daftar Avatar Presence dan Indikator Status Koneksi (BOARD-1407):
  - `BOARD-1407`: Komponen Web Component `<kujam-presence-bar>` di `@kujam/ui`.
    - Menampilkan daftar avatar collaborator aktif dari `board.sync.presence.peers` (latar warna peer, avatar foto atau inisial nama, serta tooltip nama pengguna).
    - Interaksi follow: klik avatar memicu `board.camera.follow(userId)` dengan animasi transisi halus; klik kembali pada user yang sama membatalkan follow (`board.camera.unfollow()`).
    - Indikator visual cincin fokus dan badge aktif saat sedang mengikuti kolaborator remote.
    - Indikator visual status koneksi (`offline`, `connecting`, `synced`, `error`) dengan dot berwarna dan label teks yang dapat diterjemahkan (i18n).
    - Terintegrasi di `mountDefaultUi` pada pojok kanan atas kanvas.
- 20679c8: Indikator status `<kujam-presence-bar>` tidak lagi menjadi live region, karena perubahan koneksi kini diumumkan oleh live region renderer (BOARD-1903). Tanpa ini pembaca layar membacakan status dua kali.
- 0d85a42: `<kujam-presence-bar>` kini memakai `board.sync` dan mengikat ulang pada event `sync`, sehingga status koneksi dan avatar kolaborator tampil benar walaupun `attachSync` dipanggil setelah UI dipasang. Sebelumnya bar membaca properti `board.sync` yang tidak pernah diisi `attachSync` dan selalu menampilkan "Offline".
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
