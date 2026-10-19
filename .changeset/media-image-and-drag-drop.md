---
'@kujam/core': patch
'@kujam/shapes': patch
'@kujam/renderer': patch
---

Implementasi Media Gambar, AssetResolver, dan Drag & Drop (BOARD-1103, BOARD-1906, BOARD-908):
- `BOARD-1103`: Elemen gambar (`image`) dengan props `assetId` dan `crop`, delegasi resolusi biner ke `AssetAdapter` (`resolve` & `upload`), rendering kanvas dengan clipping rounded corners & kalkulasi koordinat sumber crop, pemuatan malas dengan `createImageBitmap` off-thread decoding, validasi URL (`isSafeUrl` / `sanitizeUrl` untuk `https:`, `http:`, `blob:`, `data:`), dan mode crop interaktif pada double click.
- `BOARD-1906`: Teks alternatif gambar (`props.alt`), aksi kontekstual `image.alt`, dan pohon aksesibilitas dwibahasa (`a11y`) dengan label fallback dwibahasa (`Image` / `Gambar`).
- `BOARD-908`: Drag and drop berkas gambar dari desktop serta paste gambar clipboard (`attachDragDrop`), penataan multi-gambar berdampingan dengan jarak 24px pada titik jatuh, penanganan siklus upload (`uploadStatus`: `'uploading'` -> `'ready'` / `'error'`), placeholder loading progress & error retry, serta penerusan berkas non-gambar ke `options.acceptDrop` atau `options.onDropRejected`.
