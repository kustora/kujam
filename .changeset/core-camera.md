---
'@kujam/core': minor
---

Kamera: posisi, zoom, viewport, dan konversi koordinat (BOARD-401).

- `board.camera` (`BoardCamera`): `get()`, `set({ x, y, zoom })`, dan `zoomRange`. `board.getCamera()` dan `board.setCamera()` tetap ada dan setara dengan `camera.get()`/`camera.set()`. Event `camera` hanya dipancarkan bila kamera benar-benar berubah.
- Model koordinat: `x, y` kamera adalah titik papan di sudut kiri atas viewport, `zoom` adalah piksel CSS per satuan papan.
- `camera.setViewport({ width, height })` diisi renderer; `camera.viewport` dan `camera.getViewportBounds()` memberi area papan yang terlihat.
- `camera.screenToBoard(point)` dan `camera.boardToScreen(point)` untuk titik layar relatif terhadap kontainer papan.
- `camera.zoomTo(zoom, anchor?)` dan `camera.zoomBy(factor, anchor?)`: zoom berpusat pada titik layar (kursor atau tengah pinch), bawaannya tengah viewport. Zoom tetap dijepit ke `zoomRange` (bawaan 10% sampai 400%, bisa diubah lewat `createBoard({ zoomRange })`).
- `ZoomRange` dan `DEFAULT_ZOOM_RANGE` dipindah ke modul `camera.ts`; ekspor publiknya tidak berubah.
