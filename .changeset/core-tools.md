---
'@kujam/core': minor
---

State machine tool dan `defineTool` (BOARD-501), semuanya `@beta`.

- `defineTool({ id, cursor, oneShot, initial, states, data })`. Nama state diinferensi dari kunci `states`, sehingga handler hanya boleh mengembalikan state yang ada, dan `ctx.data` bertipe sesuai `data`.
- Event input ternormalisasi untuk renderer (`BoardInputEvent`): pointer (`pointerId`, `pointerType`, koordinat papan dan layar, tekanan, kemiringan, tombol, pengubah), keyboard, wheel, dan pinch. Renderer mengirimnya lewat `board.dispatch(event)`.
- `board.tools`, `board.setTool(id)`, `board.tool`, `board.toolState`, `board.cursor`, event `tool`, dan opsi `createBoard({ defaultTool })`.
- Interaksi tool: perubahan lewat `ctx.change` langsung terlihat, lalu menjadi satu langkah undo saat tool kembali ke state awal, atau di-rollback saat `cancel` (pointer-cancel, Esc, ganti tool, undo, atau handler yang melempar), sesuai ADR-004.
- Esc kembali ke tool bawaan, tool `oneShot` kembali setelah satu interaksi, dan spasi ditahan mengaktifkan tool `hand` sementara.
- `ToolEvent.id` kini `string | null`.
