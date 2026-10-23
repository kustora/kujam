# Aksesibilitas `@kujam/*` untuk Pemakai Package

Panduan untuk developer yang memasang papan dan menulis plugin (BOARD-2208). Dokumen ini menjelaskan apa yang sudah disediakan package, apa yang wajib diisi penulis elemen kustom, daftar shortcut bawaan, dan keterbatasan yang masih ada. Checklist uji per rilis ada di [`a11y-checklist.md`](./a11y-checklist.md).

## 1. Yang sudah disediakan package

| Kemampuan                   | Keterangan                                                                                                                                                                                                                                                                     | Tiket                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Pohon aksesibilitas paralel | Kanvas tidak terbaca pembaca layar, jadi renderer membuat daftar `role="list"` tersembunyi berisi satu item per elemen, dalam urutan baca: frame (atas ke bawah, kiri ke kanan), isinya, lalu elemen lepas. `aria-setsize` dan `aria-posinset` memberi tahu jumlah sebenarnya. | BOARD-1901                  |
| Navigasi keyboard           | `Tab`/`Shift+Tab` berpindah antar elemen, panah menggeser, `Enter` mengedit, `Esc` keluar. Papan bukan jebakan fokus: `Esc` lalu `Tab` keluar dari papan.                                                                                                                      | BOARD-1902                  |
| Pengumuman live region      | Elemen yang dibuat atau dihapus oleh pengguna sendiri, kolaborator yang bergabung atau keluar, dan koneksi terputus atau pulih diumumkan dengan jeda agar tidak membanjiri. Pesan aplikasi bisa ditambahkan dengan `view.announce(message)`.                                   | BOARD-1903                  |
| Reduced motion              | Mengikuti `prefers-reduced-motion`: animasi kamera langsung lompat, transisi UI dimatikan, dan inersia sentuh tidak berjalan. Bisa ditimpa dengan `mountRenderer(board, el, { reducedMotion })`.                                                                               | BOARD-1905, BOARD-911       |
| Teks alternatif gambar      | Elemen gambar punya `alt` yang bisa diedit dan ikut ke pohon aksesibilitas serta ekspor SVG.                                                                                                                                                                                   | BOARD-1906                  |
| Kontras dan fokus           | Token tema terang dan gelap lolos WCAG AA untuk teks UI, dan cincin fokus 2 px tampil di semua kontrol `@kujam/ui`.                                                                                                                                                            | BOARD-1006, BOARD-1907      |
| Bahasa                      | Semua teks bawaan tersedia dalam `id` dan `en` (`board.setLocale`), dan aplikasi bisa menambah atau menimpa kamus.                                                                                                                                                             | BOARD-1909                  |
| Target sentuh               | Handle resize, rotasi, titik garis, dan konektor punya area sentuh minimal 24 × 24 px CSS untuk jari (WCAG 2.5.8).                                                                                                                                                             | BOARD-911                   |
| Komponen `@kujam/ui`        | Toolbar dengan roving tabindex dan navigasi panah, menu dengan `role="menu"`, serta dialog (command palette, bantuan shortcut) dengan `aria-modal`, fokus yang dikembalikan saat ditutup, dan `Esc`. Diaudit `axe-core` di `e2e/a11y.spec.ts`.                                 | BOARD-1402–1409, BOARD-1908 |

## 2. Menulis `a11y` untuk elemen kustom

Setiap elemen kustom sebaiknya punya callback `a11y`. Tanpa callback itu, pembaca layar hanya membacakan "Elemen {type}", misalnya "Elemen contact-card", yang tidak berguna bagi pemakai.

```ts
const TEXT = {
  id: { card: (name: string) => `Kartu kontak: ${name}`, loading: 'Kartu kontak, memuat' },
  en: { card: (name: string) => `Contact card: ${name}`, loading: 'Contact card, loading' },
};

const contactCard = defineElement({
  type: 'contact-card',
  version: 1,
  props: schema({ refId: string() }),
  defaults: { refId: '' },
  resolve: (el, ctx) => ctx.resolvers.contact!(el.props.refId),
  a11y: (el, data, ctx) => {
    const text = ctx.locale === 'en' ? TEXT.en : TEXT.id;
    return {
      role: 'article',
      label: data ? text.card(data.name) : text.loading,
      description: data?.company,
    };
  },
});
```

Aturan yang perlu diikuti:

- **`label` pendek dan bermakna**, dimulai dengan jenis lalu isi: "Kartu kontak: Budi Santoso", bukan "Kartu" atau seluruh isi kartu. Sekitar 80 karakter sudah cukup. Detail tambahan masuk `description`.
- **Ikuti `ctx.locale`** (`'id'` atau `'en'`) agar label berganti bersama `board.setLocale`, seperti elemen bawaan. Simpan teks per bahasa di satu tempat, bukan tersebar di kode.
- **Tangani semua status data.** `data` bernilai `undefined` saat masih dimuat. Untuk placeholder `forbidden`, jangan bocorkan isi: cukup "Kartu terkunci". Label diperbarui otomatis saat resolver selesai atau `board.invalidate(...)` dipanggil.
- **Pilih `role` yang tepat:** `article` untuk kartu berisi konten, `note` untuk catatan, `img` untuk visual tanpa teks (wajib dengan label deskriptif), dan `group` untuk wadah. Jangan memakai role interaktif (`button`, `link`) kecuali elemennya memang bertindak seperti itu saat diaktifkan dengan `Enter`.
- **Status penting masuk ke label atau description**, misalnya "Tenggat lewat" atau "Menunggu persetujuan 2 dari 3". Warna saja tidak cukup (WCAG 1.4.1). Status terkunci ditambahkan otomatis oleh renderer.
- **Callback harus murah dan tidak boleh melempar.** Callback dipanggil untuk elemen di sekitar viewport saat dokumen berubah. Bila melempar, elemen kembali ke label bawaan dan elemen lain tidak terganggu.
- **Konten `render.html` yang interaktif** (tombol di dalam kartu) wajib bisa dijangkau keyboard dan punya nama sendiri. Tandai dengan `data-board-interactive` (BOARD-1304) agar klik dan tombol tidak diambil papan. Aksi utama sebaiknya juga tersedia sebagai aksi kontekstual (`actions`), supaya muncul di toolbar seleksi dan menu konteks yang sudah aksesibel.
- **`export.text`** dipakai pencarian dan ekspor teks. Isi dengan teks yang sama pentingnya dengan label.

Contoh lengkap ada di `examples/contact-card` dan di panduan [elemen kustom](./custom-elements.md).

### Komponen UI sendiri

Bila mengganti UI bawaan (lihat [custom-ui.md](./custom-ui.md)), pertahankan perilaku berikut:

- nama tombol tool memuat shortcut-nya (`board.keybindings.forTarget`), dan tombol memakai `aria-pressed`;
- dialog punya `role="dialog"`, `aria-modal`, fokus awal di dalam dialog, `Esc` untuk menutup, dan fokus dikembalikan saat ditutup;
- area yang bisa di-scroll bisa difokus dengan keyboard;
- target sentuh minimal 24 × 24 px CSS.

## 3. Shortcut bawaan

Daftar di bawah berlaku untuk `defaultTools` dan `defaultCommands`. `Mod` adalah `⌘` di macOS dan `Ctrl` di sistem lain. Aplikasi bisa mengubah atau menghapus binding mana pun (`createBoard({ keybindings })` atau `board.keybindings.set`). Daftar yang berlaku di papan selalu bisa dilihat dengan menekan `?` (panel `<kujam-shortcut-help>`, BOARD-1409), atau dibaca dengan `buildShortcutHelp(board)`.

### Tool

| Tool   | Shortcut | Tool      | Shortcut  |
| ------ | -------- | --------- | --------- |
| Pilih  | `V`      | Konektor  | `L`       |
| Tangan | `H`      | Garis     | `Shift+L` |
| Sticky | `S`      | Frame     | `F`       |
| Pena   | `P`      | Penghapus | `E`       |
| Teks   | `T`      | Kotak     | `R`       |
| Elips  | `O`      |           |           |

Tahan `Space` untuk memakai Tangan sementara. `Esc` membatalkan interaksi yang sedang berjalan, lalu kembali ke tool Pilih.

### Perintah

| Perintah                       | Shortcut                         |
| ------------------------------ | -------------------------------- |
| Urungkan / Ulangi              | `Mod+Z` / `Mod+Shift+Z`, `Mod+Y` |
| Pilih semua / Batalkan seleksi | `Mod+A` / `Esc`                  |
| Elemen berikutnya / sebelumnya | `Tab` / `Shift+Tab`              |
| Geser 1 px / 10 px             | Panah / `Shift+Panah`            |
| Edit teks elemen terpilih      | `Enter`                          |
| Duplikat                       | `Mod+D`                          |
| Hapus                          | `Delete`, `Backspace`            |
| Grup / Lepas grup              | `Mod+G` / `Mod+Shift+G`          |
| Kunci atau buka kunci          | `Mod+Shift+L`                    |
| Bawa maju / Kirim mundur       | `Mod+]` / `Mod+[`                |
| Paling depan / Paling belakang | `Mod+Shift+]` / `Mod+Shift+[`    |
| Perbesar / Perkecil / 100%     | `Mod+=` / `Mod+-` / `Mod+0`      |
| Pas ke layar / Zoom ke seleksi | `Shift+1` / `Shift+2`            |
| Potong / Salin / Tempel        | `Mod+X` / `Mod+C` / `Mod+V`      |
| Command palette                | `Mod+K`, `/`                     |
| Bantuan shortcut               | `?`                              |

### Sentuh dan stylus

| Gestur                                | Hasil                                     |
| ------------------------------------- | ----------------------------------------- |
| Ketuk dua jari / tiga jari            | Urungkan / Ulangi (bisa dimatikan)        |
| Dua jari geser dan cubit              | Geser dan zoom kamera                     |
| Tekan lama di elemen                  | Menu konteks                              |
| Tekan lama di area kosong, lalu seret | Kotak seleksi (tanpa seret: menu konteks) |

## 4. Keterbatasan yang diakui

Kami mencatatnya terus terang agar aplikasi bisa memberi alternatif:

- **Isi visual tidak dideskripsikan secara spasial.** Pembaca layar mendengar daftar elemen dan labelnya, bukan tata letak ("sticky ini di kanan atas frame itu"). Hubungan konektor juga belum dibacakan sebagai "A terhubung ke B".
- **Coretan bebas hanya berlabel "Coretan".** Bentuk dan makna gambar tangan tidak bisa diketahui. Bila penting, minta pengguna menambahkan teks di dekatnya.
- **Beberapa aksi masih butuh pointer:** membuat konektor dan garis, mengubah ukuran dan memutar elemen, lasso, menggambar, dan penghapus. Memindah, memilih, mengedit teks, menyusun lapisan, grup, dan perintah lain bisa dengan keyboard.
- **Hanya 200 elemen di sekitar viewport yang ada di pohon aksesibilitas** pada satu waktu, demi performa. Jumlah total tetap diumumkan, dan `Tab` menggeser kamera ke elemen berikutnya.
- **Mode kontras tinggi Windows (`forced-colors`) belum didukung.** Warna kanvas tidak mengikuti warna sistem.
- **Bahasa kanan-ke-kiri (RTL) belum didukung**; dijadwalkan di BOARD-1910 (0.6).
- **Kursor dan goresan kolaborator tidak diumumkan**, hanya bergabung atau keluarnya. Aktivitas orang lain tidak dibacakan agar tidak bising.
- **Uji pembaca layar manual belum dilakukan.** Yang sudah berjalan adalah audit otomatis `axe-core` di Chromium dan WebKit serta tes struktur pohon aksesibilitas. VoiceOver (macOS, iPadOS), NVDA, dan iPad dengan Apple Pencil belum diuji manual (BOARD-1901, BOARD-2105), jadi perilaku nyata di pembaca layar bisa berbeda dari yang dijelaskan di sini.

Laporan masalah aksesibilitas diperlakukan sebagai bug biasa. Masalah yang membuat sebuah fitur tidak bisa dipakai sama sekali dengan keyboard atau pembaca layar diprioritaskan seperti bug fungsional.
