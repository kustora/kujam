---
'@kujam/renderer': patch
---

Perbaiki `Illegal invocation` saat elemen mengubah properti canvas bawaan (misalnya `fillStyle`) lewat konteks gambar `render.canvas`; semua sticky gagal dirender di browser karena bug ini.
