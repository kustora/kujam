---
'@kujam/shapes': minor
'@kujam/core': minor
---

Tool Pilih (`select`) dan Tangan (`hand`) bawaan di `defaultTools` (BOARD-502).

- `selectTool`: klik memilih, Shift+klik menambah atau melepas, klik di ruang kosong mengosongkan seleksi; seret di ruang kosong menggambar kotak seleksi (elemen tercakup penuh, atau tersentuh sebagian dengan Alt, Shift menambah); seret elemen memindah seleksi dengan snap (Ctrl/Cmd mematikan snap); handle resize (Shift menjaga rasio) dan handle rotasi (Shift kelipatan 15 derajat); klik dua kali meneruskan ke `onDoubleClick` tipe elemen. Elemen terkunci tidak bisa dikenai, dipilih lewat kotak, atau ditransformasi.
- `handTool`: seret menggeser kamera. Kedua tool juga menangani wheel (geser; Ctrl/Cmd+wheel zoom di titik kursor) dan pinch.
- Esc atau `pointer-cancel` membatalkan interaksi: posisi elemen di-rollback, seleksi dan kamera dikembalikan ke keadaan awal. Satu seretan menjadi satu langkah undo.
- Core: `board.toolData` (data tool aktif untuk overlay, misalnya `SelectToolData.brush` dan `guides`), `board.elementContext` (konteks callback elemen; `emit` memancarkan event `action`), dan field opsional `clickCount` di event pointer untuk klik dua kali.
