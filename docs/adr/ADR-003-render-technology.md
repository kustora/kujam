# ADR-003: Teknologi Render (Canvas 2D + Lapisan HTML)

- **Status:** Diusulkan (menunggu pengukuran Firefox dan Safari macOS; pengukuran iPad ditunda ke BOARD-2105)
- **Tanggal:** 2026-10-16
- **Tiket:** BOARD-003 (memblokir BOARD-801, BOARD-005)
- **Pemilik:** @riziq

## Konteks

PRD Package memilih renderer tiga lapisan: Canvas 2D untuk elemen bawaan, lapisan HTML yang ikut kamera untuk elemen kustom, dan overlay. Sebelum arsitektur renderer dikunci (BOARD-801), pilihan ini perlu dibuktikan terhadap target performa PRD:

| Skenario                                        | Target PRD                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Geser dan zoom papan 5.000 elemen bawaan        | 60 fps (frame di bawah 16 ms)                                    |
| 300 kartu kustom HTML                           | 60 fps di zoom < 40% (mode ringkas), minimal 45 fps di zoom 100% |
| Muat papan 5.000 elemen dari JSON sampai tampil | di bawah 1 detik                                                 |
| Memori papan 5.000 elemen                       | di bawah 150 MB                                                  |

## Metode

Prototipe sekali buang ada di [`spikes/board-003-render/`](../../spikes/board-003-render/README.md) dan bukan kode produksi. Ringkasnya:

- **Dokumen:** 5.000 elemen deterministik (seed tetap) di dunia 16.000 x 10.000. Isinya 60% kotak sticky berteks dan 40% coretan dengan 20 sampai 80 titik.
- **Kartu:** 300 kartu HTML (thumbnail gradien, judul, badge, avatar) berkelompok seperti papan perencanaan.
- **Mode yang dibandingkan:**
  - `canvas`: Canvas 2D, culling rbush, `Path2D` tercache, teks dilewati di zoom < 0,35.
  - `canvas-nocull`: sama, tanpa culling.
  - `svg`: SVG penuh, satu `<g transform>` untuk kamera.
  - `canvas+html`: canvas + 300 kartu di satu lapisan dengan satu `transform` CSS. Variannya: LOD (kartu digambar ringkas di canvas saat zoom < 0,4), tanpa LOD, culling per kartu, sembunyikan HTML selama zoom, dan tanpa `will-change`.
- **Jalur kamera:** deterministik per skenario. Durasi 6 detik setelah 1 detik pemanasan.
  - `pan-z1`: geser melingkar di zoom 100%.
  - `zoom-sweep`: zoom kontinu dari seluruh papan sampai 200%.
  - `fit-all`: seluruh 5.000 elemen terlihat, kasus terburuk bagi culling.
  - `zoom-steps`: zoom bertahap seperti wheel atau pinch, 200 ms animasi lalu 400 ms diam.
- **Metrik:**
  - fps rata-rata.
  - Interval frame p50, p95, dan maksimum dari selisih `requestAnimationFrame`. Angka ini mencakup style, layout, dan paint.
  - Waktu skrip p95 di dalam callback.
  - Persentase frame > 20 ms.
  - Waktu muat (dari `JSON.parse` sampai frame kedua) dan heap JS.
- **Mesin:** MacBook Air Apple M4, viewport 1440 x 900, DPR 2, layar 60 Hz. Browser dijalankan headed lewat Playwright 1.64:
  - Chromium 156.
  - WebKit 27.2 (engine Safari, belum Safari sendiri).
- **Pengganti laptop kelas menengah:** Chromium dengan CPU diperlambat 4x lewat CDP. Mode _uncapped_ (vsync dimatikan) dipakai untuk melihat sisa kapasitas, karena di mode biasa semua mode yang lolos terkunci di 60 fps.

Data mentah ada di `spikes/board-003-render/results/*.json`.

## Hasil

### 5.000 elemen bawaan

fps rata-rata. Angka dalam kurung adalah interval frame p95 / waktu skrip p95, dalam ms.

| Skenario             | Chromium                   | Chromium CPU 4x                 | WebKit                          | Chromium uncapped         |
| -------------------- | -------------------------- | ------------------------------- | ------------------------------- | ------------------------- |
| canvas/pan-z1        | 60 (17,6 / 0,4)            | 60 (17,6 / 0,7)                 | 60 (17,4 / 0,6)                 | 686 sampai 852            |
| canvas/zoom-sweep    | 60 (17,6 / 1,6)            | 60 (17,5 / 5,6)                 | 60 (17,4 / 4,6)                 | 333 sampai 981            |
| canvas/fit-all       | 60 (17,6 / 1,8 sampai 2,3) | 60 (17,6 / 6,5)                 | 60 (17,0 / 5,3)                 | 113 sampai 333 (p95 15,4) |
| canvas-nocull/pan-z1 | 60 (17,6 / 3,8)            | 60 (17,6 / 6,2)                 | 60 (17,2 / 4,7)                 | 388 sampai 873            |
| svg/pan-z1           | 60                         | 60                              | **39** (27,0)                   | 454 sampai 1.148          |
| svg/zoom-sweep       | 58,8 sampai 60             | **15 sampai 17** (68 sampai 83) | **32 sampai 34** (37 sampai 40) | **34 sampai 83**          |
| svg/fit-all          | 60                         | 60                              | **27 sampai 29** (38 sampai 44) | **48 sampai 176**         |

Interval p95 sekitar 17,5 ms di layar 60 Hz berarti tiap frame tepat satu vsync. Rentang angka menunjukkan variasi antar run.

### 300 kartu HTML (di atas canvas 5.000 elemen)

| Skenario                 | Chromium CPU 4x | WebKit (run 2 dan 3)                         | Chromium uncapped |
| ------------------------ | --------------- | -------------------------------------------- | ----------------- |
| html/pan-z1              | 60              | 60                                           | 414               |
| html/pan-z035-lod        | 60              | 60                                           | 279               |
| html/pan-z035-nolod      | 60              | 60                                           | 206 (p95 9,2)     |
| html/zoom-sweep-lod      | 59,8            | 59,5 sampai 59,8                             | 230               |
| html/zoom-sweep-nolod    | 60              | 58,3 sampai 58,8 (4 sampai 5% frame > 20 ms) | 202 (p95 12,9)    |
| html/zoom-steps-lod      | 60              | 60                                           | 297               |
| html-cull/zoom-steps     | 60              | 59,8                                         | 441               |
| html-zoomhide/zoom-steps | 60              | 59,3 (2,8% frame > 20 ms)                    | 455               |
| html-nowc/zoom-steps     | 60              | 60                                           | 147 (p95 21)      |

**Outlier yang perlu dicatat:** di run WebKit pertama, `html/zoom-sweep-nolod` hanya 5,4 fps dan `html/zoom-sweep-lod` 29,5 fps (p95 180 sampai 230 ms). Hasil ini tidak muncul lagi di dua run berikutnya, baik run penuh maupun run khusus HTML. Dugaan kami, raster tile WebKit masih dingin di peluncuran pertama. Karena itu benchmark CI (BOARD-2102) harus memakai median beberapa run, dan perilaku ini wajib dicek ulang di Safari asli, lalu di iPad saat BOARD-2105.

### Muat dan memori

- **Muat sampai tampil:**
  - Canvas: 33 sampai 103 ms (CPU 4x).
  - Canvas + 300 kartu HTML: 43 sampai 200 ms.
  - SVG: 83 sampai 265 ms.
  - Semua jauh di bawah target 1 detik.
- **Heap JS:** 10 sampai 50 MB. Angka ini belum mencakup backing store canvas (sekitar 20 MB untuk 2880 x 1800 px), memori GPU, dan DOM, sehingga belum bisa dibandingkan langsung dengan target 150 MB. `performance.memory` di Chromium sengaja dibuat kasar, dan WebKit tidak punya API memori. Memori proses perlu diukur manual dengan Activity Monitor atau Web Inspector.

## Temuan

1. **Canvas 2D dengan culling rbush memenuhi target 60 fps untuk 5.000 elemen** di semua skenario dan engine yang diuji, termasuk CPU 4x lebih lambat. Kasus terburuk adalah seluruh papan terlihat, dengan waktu skrip p95 6,5 ms di CPU 4x. Sisa anggaran frame masih sekitar 10 ms.
2. **Culling rbush memangkas waktu skrip 4 sampai 10 kali** di zoom 100%: 0,4 sampai 0,7 ms dibanding 3,8 sampai 6,2 ms. Saat seluruh papan terlihat, culling tidak membantu, jadi penghematan di zoom kecil harus datang dari LOD (teks dilewati, elemen sangat kecil digambar sebagai titik).
3. **SVG penuh tidak lolos.** WebKit hanya mencapai 27 sampai 39 fps bahkan saat geser biasa di M4, dan Chromium jatuh ke 15 sampai 17 fps saat zoom dengan CPU 4x. Biaya SVG ada di style dan paint browser, bukan di skrip, sehingga tidak bisa dioptimalkan dari kode kita.
4. **Lapisan HTML dengan satu `transform` CSS lolos untuk 300 kartu** di Chromium (termasuk CPU 4x) dan WebKit. LOD dan culling per kartu menambah sisa kapasitas. Pertahankan `will-change: transform`: tanpanya, kapasitas Chromium uncapped turun dari 297 ke 147 fps di zoom bertahap.
5. **Zoom kontinu adalah kasus paling rawan bagi lapisan HTML** (lihat outlier WebKit). Teknik "sembunyikan HTML selama zoom dan gambar kartu ringkas di canvas" murah dan siap dipakai sebagai cadangan bila iPad bermasalah.

## Keputusan

**Tetap memakai Canvas 2D + lapisan HTML + overlay** sesuai PRD. Alternatif (WebGL, atau SVG penuh) tidak perlu dikejar. SVG penuh ditolak.

Aturan yang dibawa ke BOARD-801 dan tiket renderer berikutnya:

- Indeks rbush untuk culling viewport dan hit-test, `Path2D` tercache per coretan, serta teks dan elemen sub-piksel dilewati di zoom kecil (LOD).
- Ukuran canvas dibatasi sekitar 16 juta piksel dengan menurunkan DPR efektif, karena iPad Safari punya batas area canvas.
- Lapisan HTML memakai satu `transform` matrix di elemen pembungkus dengan `will-change: transform`. Elemen kustom punya LOD (render canvas ringkas di bawah zoom 0,4) dan culling per elemen di luar viewport.
- Opsi renderer `hideHtmlWhileZooming` disiapkan, aktifnya diputuskan setelah pengukuran iPad (BOARD-2105).
- Benchmark CI (BOARD-2101, BOARD-2102, BOARD-2105) memakai median minimal 3 run per engine dan menjalankan WebKit, bukan hanya Chromium.

## Yang masih terbuka sebelum status menjadi "Disetujui"

- [ ] **Firefox:** build Firefox Playwright (1.64) gagal diluncurkan di macOS 27. Jalankan halaman bench di Firefox rilis secara manual.
- [ ] **Safari macOS** (Safari asli, bukan WebKit Playwright).
- **iPad Safari** (target PRD: iPad generasi 9): **ditunda** (keputusan 2026-10-16), tidak lagi memblokir ADR ini. Pengukuran pertama dilakukan di BOARD-2105 sebelum rilis 0.1, dengan halaman bench yang sama. Bila iPad gagal target, mitigasinya ada di renderer (LOD, `hideHtmlWhileZooming`, batas DPR), bukan penggantian teknologi.
- [ ] Memori proses untuk papan 5.000 elemen (Activity Monitor atau Web Inspector).
- [ ] Laptop kelas menengah sungguhan (Core i5 generasi 11 atau setara), bila ada, untuk memvalidasi pengganti CPU 4x.

Cara menjalankannya ada di README spike. Hasil dari browser mana pun otomatis tersimpan ke `spikes/board-003-render/results/`.

## Konsekuensi

- BOARD-801 bisa dimulai dengan arsitektur tiga lapisan tanpa menunggu poin terbuka di atas. Poin itu hanya bisa menambah mitigasi, bukan mengganti teknologi.
- BOARD-005 dapat memakai 5.000 elemen sebagai batas awal. Kasus seluruh papan terlihat masih punya sisa kapasitas sekitar 2 sampai 3 kali di CPU 4x, sehingga batas bisa dievaluasi naik setelah benchmark rilis 0.1.
- Folder `spikes/board-003-render/` boleh dihapus setelah BOARD-2101 (kerangka benchmark) mengambil alih skenarionya.
