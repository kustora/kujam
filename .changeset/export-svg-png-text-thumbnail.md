---
'@kujam/export': patch
'@kujam/renderer': patch
---

Ekspor SVG, PNG, teks polos, API `exportImage` terpadu, dan thumbnail klien (BOARD-1702, BOARD-1703, BOARD-1704, BOARD-1707, BOARD-1708, BOARD-1212):

- `BOARD-1702`: `exportSVG(board, { ids, frameId, pageId, padding, background, scale, images, fonts, fontFaces, customElements })` mengekspor seluruh halaman, seleksi (beserta turunannya), atau satu frame (dipotong ke frame). Elemen bawaan direkam dari `render.canvas` sebagai vektor lewat konteks perekam canvas-ke-SVG; teks tetap `<text>`. Elemen kustom memakai `export.svg` (disanitasi: tanpa skrip, event handler, `foreignObject`, `<style>`, animasi, atau referensi eksternal; ID diberi prefiks), atau tangkapan raster `render.canvas` bila tidak ada (`customElements: 'vector'` untuk merekam sebagai vektor). Gambar di-resolve lewat `AssetAdapter` lalu disematkan sebagai data URI (bawaan) atau dirujuk lewat URL; font dirujuk lewat nama keluarga atau dideklarasikan/disematkan via `@font-face`. Frame yang memotong isinya menghasilkan `clipPath`. Semua teks dan atribut di-escape oleh serializer.
- `BOARD-1703`: `exportPNG(board, { scale: 1..4, background, padding, maxCanvasSide, maxCanvasPixels })` melukis elemen langsung ke canvas 2D dengan `render.canvas` masing-masing. Gambar dibaca dengan CORS lebih dulu sehingga canvas tidak tercemar; bila gagal diganti placeholder dengan peringatan `image-cors`. Batas ukuran canvas dihormati dengan menurunkan skala (peringatan `scale-reduced`); bila elemen kustom tetap mencemari canvas, gambar dilukis ulang dengan placeholder (peringatan `tainted`).
- `BOARD-1704`: `exportText(board, { ids, frameId, pageId, separator })` menghasilkan teks polos dari `export.text` setiap elemen (termasuk elemen kustom beserta datanya), berurutan per frame lalu posisi baca (atas ke bawah, kiri ke kanan).
- `BOARD-1707`: `exportImage(board, { format: 'png' | 'svg' | <format plugin>, ... })` dan `listExportFormats(board)`; eksportir plugin dari `definePlugin({ exporters })` dipanggil lewat API yang sama (format bawaan tidak dapat ditimpa).
- `BOARD-1708`: `createThumbnail(board, { width, height, padding, background, type, quality })` membuat thumbnail di klien dengan render ringkas (`lod.compact: true`), tanpa jaringan dan tanpa menunggu data, sebagai fallback `renderThumbnail` di server.
- `BOARD-1212`: pohon aksesibilitas memperbarui peran dan label `a11y(el, data)` saat data resolver tiba (event `data`); ekspor SVG memakai `export.svg` dan ekspor teks memakai `export.text`.
- Peringatan per elemen (`ExportWarning`) dikembalikan di hasil; kesalahan fatal dilempar sebagai `ExportError`.
- `@kujam/renderer`: `createDrawingContext` kini diekspor (`@beta`) agar `@kujam/export` memakai helper gambar yang sama (`roundRect`, `drawThumbnail`, dan lainnya).
