---
'@kujam/core': patch
'@kujam/ui': patch
---

Panel bantuan shortcut (BOARD-1409): elemen `<kujam-shortcut-help>` (`UI_TAGS.shortcutHelp`, ikut dipasang `mountDefaultUi`) dibuka dengan `?` di luar input teks dan ditutup dengan Esc, tombol Tutup, klik latar, atau `?` lagi. Daftarnya dibaca ulang dari `board.keybindings` setiap kali dibuka, jadi selalu mengikuti binding pemakai. Isinya dikelompokkan per target (tool dulu sesuai urutan registrasi, lalu perintah urut label) dan diformat per platform. Helper `buildShortcutHelp(board)` tersedia untuk UI buatan sendiri. Kamus `shortcuts.*` (id/en) ditambahkan di `@kujam/core`. Label 28 perintah bawaan (`command.history.*`, `command.layer.*`, `command.element.*`, `command.selection.*`, `command.camera.*`) kini ada di kamus id/en, sehingga command palette dan panel ini tidak lagi menampilkan key mentah.
