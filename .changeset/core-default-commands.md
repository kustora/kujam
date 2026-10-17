---
'@kujam/core': minor
---

Perintah bawaan lewat plugin `defaultCommands` (BOARD-505).

- Lapisan: `layer.bring-forward` (Mod+]), `layer.send-backward` (Mod+[), `layer.bring-to-front` (Shift+Mod+]), `layer.send-to-back` (Shift+Mod+[). Hanya index elemen yang berpindah yang diubah, di antara saudara dengan page dan induk yang sama; elemen terkunci tidak dipindah.
- Kunci: `element.toggle-lock` (Shift+Mod+L), `element.lock`, dan `element.unlock`.
- `element.duplicate` (Mod+D): menyalin elemen terpilih beserta turunannya dengan offset (bawaan 16, 16; bisa lewat argumen `{ offset }`), menaruh salinan di atas, dan memilih salinan. `element.delete` (Delete/Backspace) menghapus seleksi kecuali elemen terkunci. `selection.all` (Mod+A) memilih elemen tingkat atas yang tidak terkunci di page aktif.
- Kamera: `camera.zoom-to-fit` (Shift+1) dan `camera.zoom-to-selection` (Shift+2) memakai `board.camera.zoomToFit` dan `zoomToSelection` (BOARD-402): konten dipusatkan dengan padding 32 px dan zoom paling besar 100%.
- Setiap perintah yang mengubah dokumen adalah satu langkah undo. Perintah dinonaktifkan (`isEnabled`) bila tidak ada yang bisa diproses atau papan baca saja.
- Pasang lewat `createBoard({ plugins: [defaultCommands, defaultElements, defaultTools] })`.
