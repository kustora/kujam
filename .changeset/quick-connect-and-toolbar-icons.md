---
'@kujam/core': patch
'@kujam/renderer': patch
'@kujam/shapes': patch
'@kujam/ui': patch
---

Quick connect dan ikon toolbar seleksi:

- Saat satu elemen yang bisa dihubungkan (shape, sticky, teks, gambar) terpilih dengan tool pilih, empat titik muncul di luar tengah setiap sisi. Drag dari titik membuat konektor yang terikat ke sisi itu (dan ke shape lain bila dilepas di atasnya); klik titik menaruh salinan elemen di sisi itu, terhubung dengan konektor. Keduanya satu langkah undo.
- API baru: `connectable` di definisi elemen, `quickConnectHandles()` dan `QUICK_CONNECT_OFFSET_PX` di `@kujam/core`, serta `QUICK_CONNECT_RADIUS_PX` di `@kujam/renderer`. Gerakan hover kini juga diteruskan ke tool pilih.
- Toolbar seleksi diberi jarak lebih jauh dari elemen sehingga tidak menutupi handle rotasi dan titik quick connect.
- Isian shape, bentuk jalur konektor, dan ujung panah di toolbar seleksi kini tampil sebagai ikon, bukan teks.
