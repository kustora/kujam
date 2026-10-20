---
'@kujam/core': patch
'@kujam/renderer': patch
'@kujam/shapes': patch
---

Konektor fleksibel dan kursor yang mengikuti hover:

- Konektor baru kini berjalur siku (`elbow`) secara bawaan, seperti FigJam, dan sudut jalur siku digambar membulat.
- Saat satu konektor siku terpilih, segmen tengahnya diberi pegangan berbentuk pil. Menggeser pegangan memindahkan segmen itu dan menyimpannya sebagai prop opsional baru `bend` (`{ axis, offset }`, offset dari titik tengah antara kedua ujung), sehingga segmen ikut bergeser saat shape yang terhubung dipindah. Segmen tetap di sisi luar sisi yang terikat, sehingga jalur tidak menembus shape. Dokumen lama tanpa `bend` tetap valid.
- Sorotan konektor terpilih kini mengikuti jalurnya, bukan garis lurus dari ujung ke ujung.
- Kursor papan kini mengikuti tool aktif (`board.cursor` diterapkan oleh renderer; sebelumnya selalu default). Tool pilih menampilkan kursor sesuai yang di-hover: panah resize mengikuti arah handle (termasuk elemen yang diputar), `grab` di handle rotasi, panah geser di pegangan segmen, dan crosshair di titik quick connect dan ujung konektor.
- API baru: `ctx.setCursor()` di konteks tool, `segmentHandles()` dan `SegmentHandle` di `@kujam/core`, `ConnectorBend` di `@kujam/shapes`.
