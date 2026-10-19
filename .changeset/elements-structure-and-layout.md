---
'@kujam/core': patch
'@kujam/renderer': patch
'@kujam/shapes': patch
---

Implementasi Elemen Struktur (Group & Frame) dan Tata Letak (BOARD-E09, BOARD-E11):
- `BOARD-905`: Perintah susunan (`align.*`, `distribute.*`, `arrange.grid`, `arrange.row`), kalkulasi AABB rotasi, pengelompokan undo tunggal, dan integrasi keybinding/command registry.
- `BOARD-1104`: Elemen grup (`group`), auto-bounds berdasarkan gabungan batas anak, dan auto-deletion grup kosong saat anak dilepas/dihapus.
- `BOARD-909`: Manipulasi grup (`element.group` / `Mod+G`, `element.ungroup` / `Shift+Mod+G`), klik memilih grup terluar, double click untuk navigasi masuk anak grup (`enteredGroupId`), dan `Esc` untuk keluar.
- `BOARD-1105`: Elemen frame (`frame`, `frameTool`), auto-parenting elemen di dalam frame baru, reparenting dinamis saat drag/drop, batas kedalaman nesting 1 tingkat, label judul frame zoom-independent, clipping kanvas pada layer renderer, dan runtime `board.frames.list()`.
- `BOARD-914`: Pembuatan sticky berdampingan secara otomatis via tombol `Tab` (kanan) dan `Shift+Tab` (kiri) dengan `STICKY_TAB_GAP = 20`, pembungkusan baris baru saat batas viewport/frame penuh, dan aktivasi editor teks langsung.
