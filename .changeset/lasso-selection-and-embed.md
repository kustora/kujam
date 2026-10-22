---
'@kujam/core': minor
'@kujam/renderer': minor
'@kujam/shapes': minor
'@kujam/ui': minor
---

Seleksi laso dan elemen embed iframe ber-sandbox (BOARD-910, BOARD-1107, BOARD-2003):

- `@kujam/core`: `containedInPolygon(geometry, area, element?)` untuk uji "tercakup penuh" terhadap poligon cekung atau berpotongan sendiri (aturan even-odd), memperhitungkan ketebalan garis dan rotasi; pasangan dari `intersectsPolygon`. Label i18n `tool.lasso`.
- `@kujam/shapes`: tool `lasso` (masuk `defaultTools`) dan mode Ctrl/Cmd+seret di ruang kosong pada tool `select`. Poligon bebas memilih elemen yang tercakup penuh menurut kontur elemen (termasuk `line`); Alt untuk yang tersentuh, Shift menambah, Esc memulihkan seleksi. Helper `elementsInLasso`.
- `@kujam/shapes`: elemen `embed` lewat `createEmbedElement({ domains })` / `createEmbedPlugin(...)`, **tidak** terdaftar di `defaultElements`. Hanya URL `https:`/`http:` dengan origin di daftar (persis atau `*.domain`) yang dimuat; lainnya tampil sebagai kartu "diblokir". Atribut `sandbox` selalu ada (kosong secara bawaan); token tambahan, `allow`, dan `referrerpolicy` hanya dari konfigurasi per origin, `allow-top-navigation` ditolak, dan origin aplikasi sendiri dengan `allow-scripts` + `allow-same-origin` diblokir. Iframe baru menerima pointer setelah klik dua kali (atau Enter), berhenti saat menekan di luar atau Esc. Dimuat malas lewat virtualisasi lapisan HTML dan diganti kartu canvas statis di bawah zoom 0,5. Helper `resolveEmbed`.
- `@kujam/renderer`: overlay menggambar laso (`toolData.lasso`) sebagai poligon terisi bergaris putus-putus.
- `@kujam/ui`: tombol toolbar dan ikon `lasso`.
