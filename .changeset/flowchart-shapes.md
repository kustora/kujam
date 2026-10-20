---
'@kujam/core': patch
'@kujam/shapes': patch
'@kujam/ui': patch
---

Bentuk flowchart seperti FigJam. Elemen `geo` mendapat dua bentuk baru: `triangle-down` (segitiga terbalik) dan `pill` (kotak dengan ujung membulat penuh, untuk mulai/selesai). Tool baru `diamond`, `triangle`, `triangle-down`, dan `pill` terdaftar di `defaultTools` (diekspor sebagai `diamondTool`, `triangleTool`, `triangleDownTool`, `pillTool`). Menu Bentuk di toolbar kini menampilkan keenam bentuk (kotak, elips, belah ketupat, segitiga, segitiga terbalik, pil) sebagai satu baris ikon, dengan nama dan shortcut di tooltip. Menu popup mendukung tata letak baru `layout: 'icons'`.
