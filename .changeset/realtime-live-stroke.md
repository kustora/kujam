---
'@kujam/core': patch
'@kujam/shapes': patch
'@kujam/sync-yjs': patch
---

Implementasi Goresan Live Lewat Awareness (BOARD-1505):
- `BOARD-1505`: Streaming titik goresan aktif bebas via Yjs Awareness (ephemeral) tanpa mencemari dokumen Y.Doc.
  - Streaming goresan live dengan throttling ~30 Hz (33ms) dan pengiriman seketika pada sapuan awal (*instant leading-edge flush*).
  - Satu kali commit permanen ke Y.Doc saat goresan selesai (`pointerUp`) dan pembersihan seketika dari awareness (`setLiveStroke(null)`).
  - Alokasi ID elemen di muka (`data.elementId` pada `DrawTool`) dan helper `getLiveStrokes` dengan eliminasi duplikasi visual saat elemen permanen tiba di store remote (*zero-flicker deduplication*).
  - Pembersihan seketika saat pembatalan sapuan (tombol Escape).
