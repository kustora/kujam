---
'@kujam/core': minor
---

Store record bertransaksi, pembuat ID, dan fractional indexing (BOARD-201, BOARD-202, BOARD-204).

- `board.transact(fn, { label, origin })`: semua perubahan record lewat transaksi. Transaksi bersarang digabung ke transaksi terluar, `fn` yang melempar membatalkan semua perubahan, dan satu transaksi memancarkan satu event `change` berisi `{ added, updated: { before, after }, removed, origin, label }`. Origin: `local`, `remote`, `undo`, `redo`, `load`, `migration` (`CHANGE_ORIGINS`).
- `board.on('change', fn)` mengembalikan fungsi unsubscribe; listener tidak dibagi antar board.
- Handle transaksi tingkat rendah `tx.get`, `tx.has`, `tx.put`, `tx.remove` (`@beta`); `create`/`update`/`delete` menyusul.
- Papan `readOnly` menolak transaksi `local` dengan `ReadOnlyBoardError`; `loadDocument` tetap diizinkan dan kini memancarkan event `change` berasal `load`.
- Snapshot memakai structural sharing; opsi `createBoard({ freezeSnapshots })` (bawaan `true`) mengatur pembekuan snapshot.
- `createId()` (nanoid dibundel, memakai `crypto.getRandomValues` global) dan opsi `createBoard({ createId })` serta `board.createId()` untuk ID deterministik di tes.
- Helper urutan `indexBetween`, `indexAbove`, `indexBelow`, `indicesBetween`, dan `compareIndex`.
- `deepClone` kini menyalin kunci `__proto__` sebagai data biasa.
