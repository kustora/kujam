# Migrasi dokumen massal di server (BOARD-705)

`@kujam/server` menjalankan migrasi dokumen dengan kode yang sama seperti klien
(`board.prepareDocument`), di Node murni tanpa DOM. Input boleh JSON `BoardDocument` atau
update Yjs biner (`Uint8Array`).

## Satu dokumen

```ts
import { migrateServerDocument } from '@kujam/server';

const result = migrateServerDocument(rowFromDatabase, { plugins: [defaultElements, myPlugin] });
if (result.changed) {
  await save(result.update ?? result.document); // `update` terisi bila inputnya biner
}
```

`result` berisi `changed`, `fromVersion`, `toVersion`, dan `rejected` (record tidak valid yang
dibuang). Dokumen yang lebih baru dari yang dipahami server ditolak (melempar error), bukan
diturunkan versinya.

## Skrip massal dengan dry-run dan laporan

```ts
import { migrateServerBatch } from '@kujam/server';

const dryRun = process.argv.includes('--dry-run');

const report = await migrateServerBatch(await loadAllBoards(), {
  plugins: [defaultElements, myPlugin],
  dryRun,
  // Hanya dipanggil untuk dokumen yang berubah, dan tidak pernah saat --dry-run.
  onMigrated: async (id, result) => {
    await saveBoard(id, result.update ?? result.document);
  },
});

console.log(dryRun ? 'DRY RUN, tidak ada yang disimpan' : 'Migrasi selesai');
console.log(`${report.migrated} diubah, ${report.unchanged} tetap, ${report.failed} gagal`);
for (const entry of report.entries.filter((e) => e.status === 'failed')) {
  console.error(`${entry.id}: ${entry.error}`);
}
process.exitCode = report.failed > 0 ? 1 : 0;
```

Satu dokumen yang gagal tidak menghentikan batch; kegagalannya muncul di `report.entries`.
Selalu jalankan `--dry-run` dulu pada data produksi.

## Thumbnail di server (BOARD-1804)

```ts
import { renderThumbnail } from '@kujam/server';

const png = await renderThumbnail(doc, { width: 400, plugins: [defaultElements] });
```

`@napi-rs/canvas` bersifat opsional dan dimuat saat dipakai. Bila tidak terpasang, fungsi melempar
error yang jelas sehingga aplikasi bisa jatuh ke thumbnail klien (BOARD-1708). Untuk canvas
lain, berikan `canvasFactory(width, height)` yang mengembalikan `{ canvas, ctx }`; `canvas` harus
punya `toBuffer('image/png')` atau `encode('png')`.

## Worker lengkap (BOARD-1805)

Contoh worker yang menggabungkan validasi, ekstraksi referensi dengan diff penempatan, dan thumbnail setelah perubahan reda ada di [`examples/server-worker`](../examples/server-worker/README.md).
