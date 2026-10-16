---
'@kujam/core': minor
---

Registri perintah per board (BOARD-503).

- `board.run(id, args?)` menjalankan perintah terdaftar dan mengembalikan `false` bila `isEnabled` menolak. ID yang tidak terdaftar melempar `CommandError` (`unknown-command`).
- `board.commands` dengan `register` (`@beta`, mengembalikan fungsi pelepas), `get`, `has`, `list`, dan `isEnabled`. ID ganda ditolak dengan `CommandError` (`duplicate-command`).
- `defineCommand` memvalidasi definisi (`id` bernamespace seperti `'layer.bring-forward'`, `label` kunci i18n, `run`, `isEnabled` opsional) dan membekukannya. Tipe argumen perintah diinferensi di `run` dan `isEnabled`.
