---
'@kujam/core': patch
'@kujam/sync-yjs': patch
'@kujam/shapes': patch
---

Implementasi Kolaborasi Teks Realtime dan Presence Awareness (Epic BOARD-E15: BOARD-1503 & BOARD-1504):
- `BOARD-1503`: Teks sticky dan teks sebagai `Y.Text` dengan format attributes di `@kujam/sync-yjs` dan `@kujam/shapes`.
  - Pemetaan properti teks (`props.text` pada sticky/text dan `props.label` pada geo/connector) ke instance `Y.Text` dengan diffing awalan/akhiran karakter (`syncRichTextToYText`) dan sinkronisasi atribut format (tebal, miring, tautan).
  - Kolaborasi teks realtime: dua pengguna dapat mengetik bersamaan pada catatan sticky atau teks yang sama tanpa saling menimpa karakter.
  - Editor inline (`attachTextEditor` di `@kujam/shapes`): sinkronisasi langsung input lokal (`mergeKey: edit:<id>`) dan preservasi posisi kursor/caret (`getCaretCharacterOffset` & `setCaretCharacterOffset`) saat pembaruan teks remote tiba.
- `BOARD-1504`: Presence lewat awareness (kursor, seleksi, kamera, pengguna) di `@kujam/sync-yjs` dan `@kujam/core`.
  - Penyebaran state awareness pengguna (`user`), kursor (`cursor` dengan throttling ~30 Hz / 33ms), seleksi elemen (`selection`), kamera (`camera`), dan tool aktif (`tool`).
  - Event `peer-join`, `peer-leave`, dan `change` untuk pelacakan kolaborator aktif.
  - Expose `board.presence` di instance `Board` melalui pendelegasian otomatis saat `attachSync`.
