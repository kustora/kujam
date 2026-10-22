---
'@kujam/core': minor
'@kujam/shapes': minor
'@kujam/renderer': patch
'@kujam/ui': patch
---

Elemen garis (polyline) yang bisa diedit per titik (BOARD-1106):
- `@kujam/shapes`:
  - Elemen baru `line` (`lineElement`, `linePropsSchema`, `LineProps`, `MAX_LINE_POINTS`) terdaftar di `defaultElements`: titik disimpan relatif terhadap kotak elemen, hit-testing mengikuti segmen, dan gaya garis (warna, ketebalan, putus-putus) serta kepala panah sama dengan konektor (pola dash dan `drawArrowhead` dipakai bersama).
  - Alat baru `line` (`lineTool`, pintasan `Shift+L`) di `defaultTools`: klik demi klik menambah titik, seret menambah titik awal dan akhir, klik dua kali atau Enter menyelesaikan (satu langkah undo), Backspace/Delete menghapus titik terakhir, Shift mengunci sudut 45°, dan Esc membatalkan. Pratinjau memakai `connectorPreview` yang sudah digambar overlay.
  - Alat `select` mendapat mode edit untuk satu garis terpilih: seret titik (`line-point`), klik atau seret pegangan di tengah segmen untuk menambah titik (`line-insert`), serta klik dua kali atau Alt+klik titik untuk menghapusnya (minimal 2 titik). Setiap gestur adalah satu langkah undo; rotasi garis dibakukan ke titik saat diedit.
  - Aksi gaya `line`: warna, ketebalan, gaya garis, ujung awal, dan ujung akhir; gaya diingat untuk alat `line`.
- `@kujam/core`: helper `midpointHandles(points, minLength)` dan tipe `MidpointHandle`; string i18n `tool.line` dan `element.line`.
- `@kujam/renderer`: overlay menggambar jalur, pegangan tiap titik, dan pegangan sisip di tengah segmen untuk garis terpilih; gerakan hover diteruskan ke alat `line` untuk pratinjau segmen berikutnya.
- `@kujam/ui`: tombol `line` di toolbar utama setelah konektor, dengan pilihan warna dan ikon baru.
