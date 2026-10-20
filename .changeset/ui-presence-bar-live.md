---
'@kujam/ui': patch
---

Indikator status `<kujam-presence-bar>` tidak lagi menjadi live region, karena perubahan koneksi kini diumumkan oleh live region renderer (BOARD-1903). Tanpa ini pembaca layar membacakan status dua kali.
