---
'@kujam/core': patch
---

`testElementContract(def, options)` (BOARD-1207): pemeriksaan kontrak elemen kustom yang bisa dipakai ulang tanpa framework tes. Fungsi ini menjalankan setiap callback definisi seperti papan dan renderer memanggilnya (props contoh lolos skema, geometri berisi titik tengah, `resolve` memanggil resolver, `render.canvas` dengan dan tanpa data, `render.html` dengan `{ update, destroy }` bila `createHost` diberikan, `placeholder` untuk setiap alasan, `actions`, `a11y`, dan `export.text`), lalu mengembalikan daftar masalah. Pakai sebagai `expect(testElementContract(def, { data })).toEqual([])`.
