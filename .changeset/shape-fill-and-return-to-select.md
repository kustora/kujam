---
'@kujam/shapes': patch
'@kujam/ui': patch
---

Perbaikan gaya shape dan alur tool shape:

- Memilih warna isian pada shape tanpa isian kini juga mengubah isian menjadi penuh, sehingga warnanya langsung terlihat (sebelumnya tidak ada perubahan visual). Gaya ini diingat untuk shape berikutnya.
- Popover warna di toolbar seleksi tampil sebagai grid swatch 5 kolom berjudul grup, bukan daftar vertikal yang bisa terpotong di atas layar.
- Tool shape geometri (persegi, elips, dan lainnya) kembali ke mode pilih setelah satu shape digambar, dengan shape baru terpilih. Opsi baru `returnToSelect` di `createBoxTool` mengatur perilaku ini; sticky dan teks tetap aktif sampai Esc.
