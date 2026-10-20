---
'@kujam/core': patch
'@kujam/renderer': patch
'@kujam/shapes': patch
---

Teks tidak lagi tampil dobel saat diedit. Sejak ketikan langsung ditulis ke papan (BOARD-1503), canvas ikut menggambar teks di bawah editor inline dengan posisi sedikit bergeser; paling terlihat pada elemen teks, label shape, dan label konektor. `view.mountEditor(editor, bounds, elementId)` kini menerima ID elemen yang diedit, renderer meneruskan `lod.editingText: true` ke `render.canvas` elemen itu, dan elemen bawaan melewati gambar teksnya (bentuknya tetap digambar). Elemen kustom dengan teks sendiri bisa memakai flag yang sama.
