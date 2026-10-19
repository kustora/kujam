---
'@kujam/renderer': patch
'@kujam/ui': patch
---

Implementasi Tempel Konten Sistem, Command Palette, dan Minimap Kanvas (BOARD-907, BOARD-1405, BOARD-1406):
- `BOARD-907`: Penempelan konten sistem clipboard lengkap pada kanvas. Teks pendek (<= 120 karakter satu baris) otomatis ditempel sebagai sticky note; teks panjang atau multibaris ditempel sebagai elemen teks terformat; tautan/URL memanggil hook `onPasteUrl` jika disediakan atau menjadi elemen teks; dibungkus dalam batch undo `'clipboard.paste'`.
- `BOARD-1405`: Komponen command palette modal (`<kujam-command-palette>`), dipicu melalui tombol `/` (saat tidak dalam input teks) atau `Mod+K`, pencarian fuzzy perintah & tool dari registry, penyorotan status nonaktif (`aria-disabled`), navigasi keyboard (panah/Enter/Esc), dan dukungan sumber hasil kustom (`CommandPaletteSource`).
- `BOARD-1406`: Komponen minimap kanvas interaktif (`<kujam-minimap>`), menampilkan peta radar elemen kanvas, indikator kotak viewport kamera semi-transparan, interaksi klik untuk memusatkan kamera dan drag untuk panning lancar, tombol ciutkan/perluas, serta loop pembaruan hemat daya (~100ms throttle).
