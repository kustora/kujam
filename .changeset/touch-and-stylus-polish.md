---
'@kujam/core': patch
'@kujam/renderer': patch
'@kujam/shapes': patch
---

Polesan sentuh dan stylus (BOARD-911, ADR-004):

- `@kujam/renderer`: tolak telapak tangan. Saat pena menempel, sentuhan jari diabaikan; pena yang turun saat ada jari membatalkan aksi jari itu. Opsi `touch` di `mountRenderer` serta `view.setTouchOptions()`/`view.touchOptions`: `fingers` bernilai `auto` (bawaan; jari berhenti menggambar setelah pena terdeteksi, lihat `view.penDetected`), `pan` ("pena menggambar, jari menggeser"), atau `draw` (tanpa tolak telapak tangan). Ketuk dua jari untuk undo dan tiga jari untuk redo (`tapGestures`). Inersia setelah geser dan pinch sentuh (`inertia`, mati saat reduced motion). Tekan lama lalu seret di area kosong membuat kotak seleksi; tekan lama tanpa seret di area kosong membuka menu konteks saat jari diangkat. Editor teks digeser agar tetap terlihat di atas keyboard virtual (`visualViewport`). Pena yang melayang dikirim ke semua tool dan ujung kuasnya dipratinjau di overlay.
- `@kujam/core`: `ToolPointerEvent.predicted` berisi titik dari `getPredictedEvents()` dalam koordinat papan (tipe `PredictedPoint`), hanya untuk pratinjau.
- `@kujam/shapes`: tool pena menggambar titik prediksi tanpa menyimpannya (`ActiveStroke.predicted`) dan menerbitkan `tip` (`BrushTipPreview`) untuk pena yang melayang. Handle resize, rotasi, titik garis, dan konektor punya area sentuh minimal 24 px CSS (`TOUCH_HANDLE_TOLERANCE_PX`).
