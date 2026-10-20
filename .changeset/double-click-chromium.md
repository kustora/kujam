---
'@kujam/renderer': patch
---

Klik dua kali kini berfungsi di Chromium dan Firefox. Browser tersebut mengirim `PointerEvent.detail` bernilai 0, sehingga `clickCount` selalu 1 dan klik dua kali pada shape, teks, atau sticky tidak pernah membuka editor teks. Renderer kini menghitung klik beruntun sendiri (jeda paling lama 500 ms, dalam ambang geser, jenis pointer sama) dan memakai `detail` hanya bila browser mengisinya.
