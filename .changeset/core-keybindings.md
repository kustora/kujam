---
'@kujam/core': minor
'@kujam/shapes': minor
---

Keybinding yang bisa diganti (BOARD-504).

- Plugin mendeklarasikan `keybindings` (`{ [shortcut]: idPerintah | 'tool:<id>' }`), dan pemakai lewat `createBoard({ keybindings })`. Bila bentrok, pemakai menang; plugin yang dipasang belakangan menang atas yang lebih awal. Nilai `null` dari pemakai menghapus shortcut plugin.
- Notasi lintas platform: `Mod` = Cmd di macOS dan Ctrl di platform lain (`createBoard({ platform })`, bawaan dideteksi dari `navigator`). Modifier harus cocok persis. Tombol yang karakternya berubah karena layout atau modifier (misalnya Shift+1 → `!`) dicocokkan lewat tombol fisiknya (`event.code`).
- `board.keybindings`: `list`, `get`, `forTarget` (untuk tooltip dan command palette), `set` (ganti saat runtime), `match`, dan `format` (label tampilan, misalnya `⇧⌘L` di macOS).
- `board.dispatch` menjalankan shortcut yang cocok saat tool diam. Selama interaksi tool berlangsung, tombol hanya diteruskan ke tool. Event tombol dengan `inTextInput: true` diabaikan kecuali Esc.
- `@kujam/shapes`: `defaultTools` memasang `V` untuk tool Pilih dan `H` untuk tool Tangan.
