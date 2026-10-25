# @kujam/export

## 0.2.0

### Minor Changes

- 9099554: Ekspor dan impor JSON papan (BOARD-1701).

  - `exportJSON(board, { ids? })`: tanpa `ids` mengekspor seluruh dokumen (salinan, aman untuk `JSON.stringify`). Dengan `ids`, hanya elemen tersebut beserta anak-anaknya, binding di antara elemen yang diekspor, page tempat mereka berada, dan aset yang dirujuk props. Induk yang tidak ikut diekspor membuat elemen menjadi elemen akar.
  - `importJSON(board, json, { at? })`: menerima teks JSON atau objek dokumen. Isi melewati validasi, batas, dan migrasi yang sama dengan `loadDocument`; record tidak valid dibuang dan dilaporkan di `result.rejected`. Ke papan tanpa elemen, ID, page, dan index dipertahankan. Ke papan berisi, seperti tempel: semua record mendapat ID baru, elemen ditaruh di page aktif di atas elemen teratas dengan urutan tetap, dan induk serta binding dipetakan ulang (`result.idMap`). `at` menaruh titik tengah isi di titik papan tersebut.
  - Impor ditulis sebagai satu transaksi lokal berlabel `import` (satu langkah undo, ikut tersimpan otomatis). Gagal dengan `ImportError` (`read-only`, `document-too-new`, `limit-exceeded`, `forbidden`), `InvalidDocumentError`, atau `MigrationError` tanpa mengubah papan.
  - `@kujam/core`: `board.prepareDocument(doc)` menjalankan pipeline dokumen masuk yang sama dengan `loadDocument` (migrasi skema, validasi terhadap registri dan batas papan, migrasi elemen dan plugin) tanpa menyentuh papan, dan mengembalikan `{ document, rejected, tooNew }`.

### Patch Changes

- 01de2a1: Excalidraw JSON import (BOARD-1706): `excalidrawToDocument(input, options?)` converts a `.excalidraw` file or an `excalidraw/clipboard` payload into a board document, and `importExcalidraw(board, input, options?)` imports it into the current page as one undo step through `importJSON`. Rectangles, ellipses, and diamonds become `geo` shapes (bound text becomes their label), and `text`, `freedraw`, `line`, `image` (with a data URL asset), `frame`, and `magicframe` map to their built-in counterparts. Arrows become `connector`s with their bindings, or a `line` when they are free and have more than two points. `groupIds` become nested `group` elements, and colors map to the nearest theme color key. Elements that cannot be mapped are listed in `unsupported` with a reason, never dropped silently. Only the file format is read; no Excalidraw code is used.
- 2b2f16a: Ekspor SVG, PNG, teks polos, API `exportImage` terpadu, dan thumbnail klien (BOARD-1702, BOARD-1703, BOARD-1704, BOARD-1707, BOARD-1708, BOARD-1212):

  - `BOARD-1702`: `exportSVG(board, { ids, frameId, pageId, padding, background, scale, images, fonts, fontFaces, customElements })` mengekspor seluruh halaman, seleksi (beserta turunannya), atau satu frame (dipotong ke frame). Elemen bawaan direkam dari `render.canvas` sebagai vektor lewat konteks perekam canvas-ke-SVG; teks tetap `<text>`. Elemen kustom memakai `export.svg` (disanitasi: tanpa skrip, event handler, `foreignObject`, `<style>`, animasi, atau referensi eksternal; ID diberi prefiks), atau tangkapan raster `render.canvas` bila tidak ada (`customElements: 'vector'` untuk merekam sebagai vektor). Gambar di-resolve lewat `AssetAdapter` lalu disematkan sebagai data URI (bawaan) atau dirujuk lewat URL; font dirujuk lewat nama keluarga atau dideklarasikan/disematkan via `@font-face`. Frame yang memotong isinya menghasilkan `clipPath`. Semua teks dan atribut di-escape oleh serializer.
  - `BOARD-1703`: `exportPNG(board, { scale: 1..4, background, padding, maxCanvasSide, maxCanvasPixels })` melukis elemen langsung ke canvas 2D dengan `render.canvas` masing-masing. Gambar dibaca dengan CORS lebih dulu sehingga canvas tidak tercemar; bila gagal diganti placeholder dengan peringatan `image-cors`. Batas ukuran canvas dihormati dengan menurunkan skala (peringatan `scale-reduced`); bila elemen kustom tetap mencemari canvas, gambar dilukis ulang dengan placeholder (peringatan `tainted`).
  - `BOARD-1704`: `exportText(board, { ids, frameId, pageId, separator })` menghasilkan teks polos dari `export.text` setiap elemen (termasuk elemen kustom beserta datanya), berurutan per frame lalu posisi baca (atas ke bawah, kiri ke kanan).
  - `BOARD-1707`: `exportImage(board, { format: 'png' | 'svg' | <format plugin>, ... })` dan `listExportFormats(board)`; eksportir plugin dari `definePlugin({ exporters })` dipanggil lewat API yang sama (format bawaan tidak dapat ditimpa).
  - `BOARD-1708`: `createThumbnail(board, { width, height, padding, background, type, quality })` membuat thumbnail di klien dengan render ringkas (`lod.compact: true`), tanpa jaringan dan tanpa menunggu data, sebagai fallback `renderThumbnail` di server.
  - `BOARD-1212`: pohon aksesibilitas memperbarui peran dan label `a11y(el, data)` saat data resolver tiba (event `data`); ekspor SVG memakai `export.svg` dan ekspor teks memakai `export.text`.
  - Peringatan per elemen (`ExportWarning`) dikembalikan di hasil; kesalahan fatal dilempar sebagai `ExportError`.
  - `@kujam/renderer`: `createDrawingContext` kini diekspor (`@beta`) agar `@kujam/export` memakai helper gambar yang sama (`roundRect`, `drawThumbnail`, dan lainnya).

- 99e743c: Open source di bawah lisensi Apache-2.0: setiap package menyertakan `LICENSE` dan `NOTICE` di tarball npm, serta `license`, `repository`, `homepage`, dan `bugs` di `package.json`. Package dipublikasikan dengan akses publik. Komentar JSDoc tema dan warna tidak lagi merujuk dokumen design system internal; nilai token tidak berubah.
- 7edf0f4: PDF export, one frame per page (BOARD-1705): `exportPDF(board, options?)` writes every frame of the page as one PDF page, in `board.frames.list()` order (or the frames in `frameIds`, in that order). A page without frames becomes a one-page PDF of all its content. Each page is the frame's PNG export, sized like the frame (one board unit is 0.75 pt), with an invisible text layer taken from the SVG export's recorded text, so text stays selectable and searchable. Text the standard PDF font cannot encode (outside Windows-1252) stays visible in the image and is reported with the new `text-not-selectable` warning. `pdf-lib` (MIT) is a new dependency loaded with a dynamic `import()`, so it is not part of the main bundle. The playground export lab gains a PDF format.
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
