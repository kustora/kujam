# ADR-004: Cakupan Sentuh dan Stylus iPad di Rilis 0.1

- **Status:** Diusulkan
- **Tanggal:** 2026-10-16
- **Tiket:** BOARD-004 (masukan untuk BOARD-806, BOARD-901, BOARD-911, BOARD-1005)
- **Pemilik:** @riziq

## Konteks

PRD Package menargetkan iPadOS Safari sejak awal dan meminta coretan yang terasa alami di mouse, trackpad, sentuh, dan stylus. Keputusan terbuka di PRD adalah apakah dukungan sentuh dan stylus harus penuh sejak MVP atau desktop dulu. Usulan PRD: **input dasar sentuh sejak awal, polesan stylus di 0.4**.

Di sisi aplikasi, PRD Tayang menulis "canvas desktop dulu" pada baris perangkat, tetapi juga mencatat "dukungan iPad sejak awal" sebagai keputusan terbuka. Karena itu package tidak boleh mengunci desain yang menyulitkan iPad, walaupun polesannya belum ada.

Perangkat acuan PRD adalah iPad generasi 9. Perangkat ini memakai Apple Pencil generasi 1, yang mendukung tekanan dan kemiringan tetapi tidak mendukung hover dan tidak punya tombol penghapus.

Risiko bila sentuh ditunda seluruhnya: model input di renderer (BOARD-806) dan state machine tool (BOARD-501) dirancang hanya untuk satu pointer, lalu harus dibongkar saat multi-sentuh ditambahkan. Risiko bila semua polesan masuk 0.1: rilis 0.1 yang sudah paling berat (sekitar 400 SP) bertambah, padahal polesan stylus butuh uji manual di perangkat.

## Keputusan

Sesuai usulan PRD. **Rilis 0.1 menyediakan input sentuh dan pena yang benar dan lengkap secara model, tetapi tanpa polesan.** Rilis 0.4 (BOARD-911) menambah polesan yang butuh penyetelan di perangkat.

### Wajib di 0.1

**Model input (BOARD-806)**

1. **Pointer Events saja.** Mouse, sentuh, dan pena memakai jalur yang sama (`pointerType` diteruskan ke tool). Touch Events tidak dipakai.
2. **Multi-pointer sejak awal.** Renderer melacak semua pointer aktif per `pointerId`. Tool menerima event ternormalisasi yang membawa `pointerId`, `pointerType`, `pressure`, `tiltX`, `tiltY`, `buttons`, serta koordinat layar dan papan. Satu tool aktif memegang satu pointer utama. Pointer tambahan dirutekan ke pengenal gestur.
3. **`pointercancel` aman.** Interaksi yang sedang berjalan dibatalkan dan transaksi undo-nya di-rollback, tidak di-commit setengah jadi. Ini terjadi misalnya saat iOS mengambil alih gestur atau ada panggilan masuk.
4. **Permukaan papan tidak memicu gestur browser:**
   - `touch-action: none`.
   - `user-select: none` dan `-webkit-touch-callout: none` di luar editor teks.
   - `preventDefault` pada `gesturestart` dan `gesturechange` di Safari.
   - Scroll halaman di luar papan tetap normal.

**Gestur**

5. **Pinch dan geser dua jari bersamaan.** Zoom berpusat di titik tengah kedua jari, dan pergeseran titik tengah menggeser kamera.
   - Saat jari kedua menyentuh, aksi jari pertama dibatalkan (rollback), bukan di-commit. Contohnya coretan yang baru mulai atau elemen yang baru diseret.
   - Jari ketiga dan seterusnya diabaikan.
6. **Pinch trackpad di semua browser desktop:**
   - Chrome, Edge, dan Firefox mengirim pinch trackpad sebagai `wheel` dengan `ctrlKey`.
   - Safari macOS mengirim `GestureEvent` (`gesturestart`, `gesturechange`, `gestureend` dengan `scale`). Keduanya ditangani dan menghasilkan perilaku zoom yang sama.
   - Rinciannya diverifikasi di Lab input playground (BOARD-2408).
7. **Geser satu jari:**
   - Dengan tool Pilih, geser satu jari di area kosong menggeser kamera, bukan membuat kotak seleksi seperti mouse. Kotak seleksi lewat sentuh menunggu 0.4.
   - Geser satu jari di atas elemen memindahkan elemen tersebut.
   - Tool Tangan selalu menggeser.
8. **Ketuk untuk memilih.** Ambang seret dibedakan per jenis pointer agar ketukan jari tidak terbaca sebagai seret: mouse 3 px, pena 4 px, sentuh 8 px, dalam piksel CSS. Ketuk dua kali meneruskan ke `onDoubleClick` elemen.

**Coretan dan pena**

9. **Coretan pena dengan tekanan.**
   - Pena memakai `pressure` asli. Nilai 0 di event pertama dijepit ke nilai minimum agar awal garis tidak hilang.
   - Mouse dan sentuh memakai tekanan simulasi perfect-freehand, karena tekanan sentuh tidak bisa diandalkan antar browser.
   - Satu jari menggambar di tool Pena. Belum ada tolak telapak tangan.
10. **Event terkoalesensi.** Coretan memakai `getCoalescedEvents()` bila tersedia, dengan fallback ke event biasa. Ketersediaannya di iPadOS Safari dicek di Lab input (BOARD-2408), bukan diasumsikan.
11. **Tombol penghapus stylus** (`buttons & 32`) tetap di 0.1 sesuai BOARD-1005 karena murah. Apple Pencil tidak punya tombol ini, jadi fitur ini hanya relevan untuk stylus Windows dan Wacom.

**Lain-lain**

12. **Editor teks di iPad berfungsi.** Mengetuk dua kali sticky atau teks membuka `contenteditable` dan keyboard virtual muncul. Penyesuaian posisi saat keyboard menutupi editor menunggu 0.4.

### Ditunda ke 0.4 (BOARD-911)

| Polesan                                                                                                  | Alasan ditunda                                                                      |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Tolak telapak tangan: setelah pena terdeteksi, sentuhan jari tidak menggambar (dua jari tetap menggeser) | Butuh penyetelan heuristik di perangkat nyata                                       |
| Mode "pena menggambar, jari menggeser" sebagai opsi                                                      | Bergantung pada tolak telapak tangan                                                |
| Ketuk dua jari untuk undo, tiga jari untuk redo                                                          | Rawan bentrok dengan pinch; perlu uji manual                                        |
| Hover pena (pratinjau ujung kuas)                                                                        | Tidak didukung Apple Pencil generasi 1 (iPad generasi 9); hanya iPad Pro M2 ke atas |
| `getPredictedEvents()` untuk menurunkan latensi coretan                                                  | Optimasi; target latensi di bawah 16 ms diukur dulu di 0.1                          |
| Kemiringan (`tiltX`, `tiltY`) memengaruhi bentuk kuas                                                    | Data sudah diteruskan sejak 0.1, pemakaiannya menyusul lewat `defineBrush`          |
| Kotak seleksi lewat sentuh (tekan lama lalu seret) dan lasso                                             | Lasso memang dijadwalkan 0.4                                                        |
| Ukuran area sentuh handle resize dan rotasi minimal 24 px CSS (WCAG 2.5.8)                               | Selaras dengan pekerjaan aksesibilitas 0.4                                          |
| Inersia setelah geser dan pinch                                                                          | Rasa, bukan fungsi                                                                  |
| Penyesuaian `visualViewport` saat keyboard virtual muncul                                                | Polesan pengalaman edit teks di iPad                                                |

Tekan lama untuk menu konteks tetap di 0.3 (BOARD-912).

### Di luar cakupan

- Ketuk dua kali dan remas (squeeze) pada Apple Pencil. Keduanya tidak tersedia untuk web.
- Touch Events dan dukungan browser tanpa Pointer Events.

## Dampak ke tiket lain

- **BOARD-806:** kriteria penerimaan sudah ditambah poin 2, 3, 5, 6 (bagian Safari `GestureEvent`), 7, 8, 9, dan 10. Estimasi 8 SP masih masuk akal, tetapi perlu dicek ulang saat grooming karena sudah di batas atas.
- **BOARD-501 (state machine tool):** kriteria penerimaan sudah ditambah: event tool membawa `pointerId` dan `pointerType`, dan transisi `cancel` wajib ada di setiap state.
- **BOARD-901:** tes E2E sentuh di WebKit. Playwright tidak punya API pinch multi-sentuh untuk WebKit, jadi tes pinch mengirim `PointerEvent` sintetis dari halaman. Di Chromium bisa memakai CDP `Input.dispatchTouchEvent`.
- **BOARD-911:** kriteria penerimaan sudah ditambah hover pena, predicted events, kotak seleksi sentuh, area sentuh handle, inersia, dan `visualViewport`. Estimasi kemungkinan naik dari 5 ke 8 SP.
- **BOARD-2408 (Lab input playground):** dipakai untuk memverifikasi poin 6 dan 10 di Safari macOS dan iPad sebelum BOARD-806 ditutup.
- **Jam Tayang:** sejak 0.1, iPad bisa menggeser, zoom, memilih, memindah, menggambar, dan mengedit teks. Bila Tayang memutuskan iPad bisa mengedit di MVP, package tidak menghalangi. Pengalaman stylus yang nyaman baru tersedia di 0.4, yang memang menjadi syarat MVP Jam Tayang.

## Alternatif yang ditolak

- **Desktop dulu, sentuh di 0.4.** Model input satu pointer harus dibongkar nanti, dan uji iPad baru dimulai menjelang MVP. Risiko performa Safari dan iPad di PRD justru meminta iPad diuji sejak fase 1.
- **Sentuh dan stylus penuh di 0.1.** Menambah sekitar 5 SP dan uji manual perangkat ke rilis yang sudah paling berat, tanpa menambah kemampuan baru bagi pemakai package.
