---
'@kujam/renderer': patch
---

Perbaikan salin, potong, dan tempel papan di browser sungguhan (BOARD-906): saat tidak ada seleksi teks, browser mengirim event `copy`/`cut`/`paste` ke `<body>` meskipun fokus berada di papan, sehingga listener di root view tidak pernah menerimanya. Listener kini dipasang di dokumen dan menangani event yang ditujukan ke dalam view, atau ke `<body>` saat view ini yang memegang fokus. Dengan beberapa view dalam satu halaman, hanya view yang fokus yang menangani. Tempel antar tab diuji E2E lewat clipboard sistem.
