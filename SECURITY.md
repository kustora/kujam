# Kebijakan Keamanan

Kebijakan ini berlaku untuk package `@kujam/*` di `packages/`, contoh di `examples/` (termasuk server Hocuspocus contoh), dan playground di `apps/playground` (BOARD-2007). Kerentanan di aplikasi Tayang (`apps/web`, `apps/api`) dilaporkan lewat kanal yang sama.

## Versi yang didukung

| Versi                                 | Didukung                        |
| ------------------------------------- | ------------------------------- |
| Cabang `main` (belum dirilis ke npm)  | Ya                              |
| `0.x` setelah dirilis: minor terakhir | Ya, perbaikan masuk rilis patch |
| `0.x` yang lebih lama                 | Tidak                           |

Sampai `1.0`, perbaikan keamanan hanya dibuat untuk rilis minor terakhir. Setelah `1.0`, mayor terakhir dan mayor sebelumnya mendapat perbaikan selama enam bulan.

## Melaporkan kerentanan

**Jangan membuka issue publik, pull request, atau diskusi untuk kerentanan.**

1. Laporkan secara privat lewat GitHub: tab **Security**, lalu **Report a vulnerability** ([buat laporan](https://github.com/kustora/tayang/security/advisories/new)). Laporan hanya terlihat oleh maintainer.
2. Bila tidak bisa memakai GitHub, hubungi pemilik teknis package, [@riziq](https://github.com/riziq) (ADR-002), lewat pesan langsung, lalu minta kanal privat. Jangan kirim detail teknis lewat kanal publik.

Sertakan bila ada:

- package dan versi atau commit yang terdampak;
- jenis masalah (misalnya XSS lewat rich text, data peer yang tidak tervalidasi, bypass mode baca saja) dan dampaknya;
- langkah reproduksi minimal atau dokumen/update yang memicunya;
- usulan perbaikan atau mitigasi, bila ada.

## Proses

| Tahap                                   | Target                                        |
| --------------------------------------- | --------------------------------------------- |
| Konfirmasi laporan diterima             | 3 hari kerja                                  |
| Penilaian awal dan tingkat keparahan    | 7 hari kerja                                  |
| Perbaikan untuk keparahan kritis/tinggi | 30 hari                                       |
| Perbaikan untuk keparahan sedang/rendah | Rilis minor berikutnya, paling lambat 90 hari |

Tingkat keparahan memakai CVSS 3.1. Pelapor mendapat kabar di setiap tahap. Setelah perbaikan dirilis, kami menerbitkan GitHub Security Advisory (dengan CVE bila perlu), mencatatnya di `CHANGELOG.md`, dan mencantumkan nama pelapor bila bersedia. Kami meminta pengungkapan terkoordinasi: detail tidak dipublikasikan sebelum perbaikan tersedia atau sebelum 90 hari sejak laporan, mana yang lebih dulu.

## Cakupan

Termasuk:

- eksekusi skrip atau HTML yang lolos sanitasi (rich text, `render.html`, ekspor SVG, embed iframe);
- data dari peer atau server yang melewati validasi (`validateBoardRecord`, validasi presence, `maxUpdateBytes`);
- klien baca saja atau token lihat saja yang bisa mengubah dokumen;
- kebocoran data elemen tanpa akses lewat resolver, ekspor, pencarian, atau thumbnail;
- kerentanan di dependensi yang benar-benar bisa dieksploitasi lewat package ini.

Tidak termasuk:

- kode aplikasi pemakai yang memakai API secara tidak aman, misalnya plugin yang memasang HTML tanpa sanitasi;
- server contoh yang dijalankan dengan token mock khusus pengembangan;
- serangan yang membutuhkan akses ke perangkat atau browser korban yang sudah dikuasai.

Model ancaman lengkap ada di [ADR-009](docs/adr/ADR-009-threat-model.md), dan panduan Content Security Policy di [docs/csp.md](docs/csp.md).

## Dependensi

Dependabot memeriksa dependensi npm (pnpm), GitHub Actions, dan image Docker server contoh setiap minggu (`.github/dependabot.yml`). Peringatan keamanan dari Dependabot langsung membuka pull request di luar jadwal itu. Pemeriksaan lisensi dan ukuran bundle dependensi baru di CI direncanakan di BOARD-108 dan BOARD-109, tetapi belum aktif.
