---
'@kujam/ui': patch
---

Komponen UI kini memasang style lewat Constructable Stylesheets (`adoptedStyleSheets`), satu lembar per jenis komponen, sehingga berjalan dengan Content Security Policy ketat tanpa `style-src 'unsafe-inline'` (BOARD-2006). Browser tanpa `adoptedStyleSheets` tetap memakai elemen `<style>`. Lihat `docs/csp.md`.
