# Checklist Aksesibilitas Per Rilis (`BOARD-1908`)

Dokumen ini adalah daftar periksa (checklist) aksesibilitas wajib yang harus dijalankan dan ditandatangani sebelum setiap rilis `@kujam/*`. Pengujian mencakup **audit otomatis (`axe-core`)** di CI serta **pengujian manual** untuk navigasi keyboard, pembaca layar (VoiceOver & NVDA), zoom browser 200%, dan preferensi sistem.

---

## 1. Audit Otomatis (`axe-core` di Playwright)

Sebelum memulai pengujian manual, pastikan seluruh tes aksesibilitas otomatis lulus tanpa pelanggaran `serious` atau `critical`:

```bash
pnpm test:e2e e2e/a11y.spec.ts
```

- [ ] Skenario papan dengan `@kujam/ui` dan elemen `0.1.0/kitchen-sink` (tema terang, bahasa Indonesia) bebas dari pelanggaran `serious` / `critical`.
- [ ] Skenario papan dengan elemen terpilih (`<kujam-selection-toolbar>` terbuka, tema gelap, bahasa Inggris) bebas dari pelanggaran `serious` / `critical`.

---

## 2. Navigasi Keyboard Lengkap (`BOARD-1902`, `BOARD-1402`, `BOARD-1403`)

Uji menggunakan browser desktop (Chromium, Firefox, Safari) tanpa menggunakan mouse/trackpad:

- [ ] **Masuk & Keluar Papan (Tanpa Jebakan Fokus / *No Keyboard Trap*):**
  - [ ] Tekan `Tab` dari luar papan untuk memfokuskan region papan tulis (`role="region"`).
  - [ ] Bila ada satu elemen yang sedang terpilih saat masuk ke papan, fokus otomatis diarahkan ke item aksesibilitas elemen tersebut.
  - [ ] Tekan `Esc` hingga seleksi kosong, lalu tekan `Tab` untuk keluar dari papan ke kontrol berikutnya di halaman (tidak terjebak di dalam kanvas).
- [ ] **Berpindah Antar Elemen di Kanvas:**
  - [ ] `Tab` dan `Shift+Tab` berpindah antar elemen sesuai urutan baca deterministik (`getReadingOrder`: frame diurutkan posisi `y` lalu `x`, diikuti elemen di dalamnya, lalu elemen lepas).
  - [ ] Fokus keyboard menampilkan cincin fokus (`focus-ring` 2px dengan jarak 2px dari batas elemen).
- [ ] **Manipulasi Elemen via Keyboard:**
  - [ ] Tombol panah (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`) menggeser elemen terpilih sejauh `1px`.
  - [ ] `Shift + Panah` menggeser elemen terpilih sejauh `10px`.
  - [ ] `Enter` pada elemen teks/sticky/bentuk membuka editor teks; `Escape` menutup editor dan mengembalikan fokus ke elemen di papan.
  - [ ] `Delete` / `Backspace` menghapus elemen terpilih dan menjaga fokus tetap berada di dalam papan (tidak jatuh ke `document.body`).
- [ ] **Toolbar Utama (`<kujam-toolbar>`) & Selection Toolbar (`<kujam-selection-toolbar>`):**
  - [ ] Toolbar adalah satu *tab stop* (*roving tabindex*): `ArrowRight` / `ArrowLeft` berpindah antar tombol, `Home` / `End` melompat ke awal/akhir.
  - [ ] `ArrowUp` atau `Alt+ArrowDown` pada tombol ber-menu membuka pop-up menu (`role="menu"`), panah atas/bawah memilih opsi, `Enter`/`Space` mengaktifkan, dan `Escape` menutup menu serta mengembalikan fokus ke tombol pemicu.

---

## 3. Pembaca Layar — VoiceOver (macOS & iPadOS Safari) (`BOARD-1901`)

Aktifkan VoiceOver (`Cmd + F5` di macOS, atau pengaturan Aksesibilitas di iPadOS) pada halaman playground `/s/all-elements`:

- [ ] **Landmark & Bantuan Papan:**
  - [ ] Papan dikenali sebagai region dengan deskripsi peran `"papan tulis"` (`id`) atau `"whiteboard"` (`en`) dan nama `"Papan tulis"` / `"Whiteboard"`.
  - [ ] Deskripsi bantuan (`aria-describedby`) dibacakan saat fokus masuk ke papan.
- [ ] **Pohon Aksesibilitas Paralel (`role="list"`):**
  - [ ] Daftar elemen (`"Elemen papan"` / `"Board elements"`) melaporkan jumlah total elemen (`aria-setsize`) dan indeks posisi (`aria-posinset`) secara akurat, termasuk ketika papan memiliki >200 elemen.
  - [ ] Setiap tipe elemen membacakan peran dan label yang bermakna (isi teks pada sticky/teks/bentuk, titik awal-akhir pada konektor, jumlah elemen dalam grup/frame).
  - [ ] Elemen yang dikunci (`locked: true`) menyertakan keterangan `"Terkunci"` / `"Locked"` pada deskripsi aksesibilitasnya.
- [ ] **Live Region Perubahan Penting (`BOARD-1903`):**
  - [ ] Membuat atau menghapus elemen (termasuk undo/redo) dibacakan, misalnya `"Sticky kuning dibuat"` atau `"3 elemen dihapus"`. Perubahan dari orang lain tidak dibacakan.
  - [ ] Di `/s/sync-lab`, kolaborator yang bergabung atau keluar dibacakan (`"Budi bergabung"`), begitu juga koneksi terputus dan tersambung kembali, tanpa daftar orang yang "keluar" karena koneksi sendiri putus.
  - [ ] Banyak perubahan beruntun digabung jadi satu kalimat dan dibacakan paling sering sekali per detik; status koneksi tidak dibacakan dua kali oleh `<kujam-presence-bar>`.
- [ ] **Eksplorasi Sentuh iPadOS (*Touch Exploration*):**
  - [ ] Menyeret jari di atas kanvas pada iPadOS dengan VoiceOver aktif menemukan item elemen pada koordinat layar yang sesuai (mengikuti transformasi kamera pan/zoom).

---

## 4. Pembaca Layar — NVDA (Windows Firefox & Chrome) (`BOARD-1901`, `BOARD-1902`)

Aktifkan NVDA di Windows dan buka halaman playground `/s/all-elements`:

- [ ] **Interaksi Mode Fokus & Browse:**
  - [ ] Saat berpindah dengan `Tab` di dalam papan, NVDA membacakan label elemen, peran, posisi dalam daftar (`X of Y`), dan status terkunci.
  - [ ] Saat mengedit teks di dalam elemen (`contenteditable`), NVDA membaca perubahan karakter/baris tanpa terganggu oleh pintasan alat satu huruf (`V`, `H`, `S`, `P`, `R`, `O`, `C`, `T`, `E`).
- [ ] **Kontrol UI (`@kujam/ui`):**
  - [ ] Semua tombol pada `<kujam-toolbar>`, `<kujam-selection-toolbar>`, `<kujam-zoom-control>`, dan `<kujam-history-control>` memiliki nama aksesibel yang menyertakan nama alat/aksi beserta pintasan keyboardnya.
  - [ ] Status tombol aktif (`aria-pressed="true"`) dan status menu (`aria-expanded`, `aria-checked`) diumumkan dengan benar.

---

## 5. Zoom Browser 200%, Kontras, & Gerak Dikurangi (`BOARD-1904`, `BOARD-1905`)

- [ ] **Zoom Browser 200%:**
  - [ ] Atur tingkat zoom browser ke **200%** pada viewport `1280×800`.
  - [ ] Pastikan `<kujam-toolbar>`, `<kujam-zoom-control>`, `<kujam-history-control>`, dan `<kujam-selection-toolbar>` tetap terlihat utuh, tidak saling bertumpuk, tidak terpotong di tepi layar, dan semua menu pop-up tetap dapat dijangkau.
  - [ ] Pastikan koordinat pointer pada kanvas tetap presisi saat menggambar atau memilih elemen pada zoom browser 200%.
- [ ] **Kontras Warna (WCAG 2.1 AA):**
  - [ ] Teks UI pada tema terang (`light`) dan gelap (`dark`) memenuhi rasio kontras minimum **4.5:1**.
  - [ ] Ikon UI, batas kontrol, dan indikator fokus memenuhi rasio kontras minimum **3:1**.
- [ ] **Gerak Dikurangi (`prefers-reduced-motion`):**
  - [ ] Aktifkan *Reduce motion* di pengaturan OS (atau emulasi DevTools `prefers-reduced-motion: reduce`).
  - [ ] Pastikan `camera.animateTo` / `camera.zoomToFit` berpindah secara instan tanpa animasi perantara, dan transisi CSS pada `@kujam/ui` dinonaktifkan (`--kujam-ui-motion: 0ms`).
  - [ ] Pastikan opsi `reducedMotion: false` pada `mountRenderer` atau `view.reducedMotion = false` dapat menimpa preferensi sistem bila diminta secara eksplisit.

---

## 6. Catatan Sign-Off Rilis

Isi baris baru pada tabel di bawah ini setiap kali menyiapkan rilis baru:

| Versi Rilis | Tanggal | Penguji | `axe-core` (CI) | Keyboard | VoiceOver | NVDA | Zoom 200% & Reduced Motion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `0.1.0-alpha.0` | 2026-10-19 | Tim Kujam | Lulus | Lulus | Siap diuji | Siap diuji | Lulus | Baseline awal |
