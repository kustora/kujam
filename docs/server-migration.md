# Bulk document migration on the server (BOARD-705)

`@kujam/server` migrates documents with the same code as the client (`board.prepareDocument`), in plain Node without a DOM. The input can be a JSON `BoardDocument` or a binary Yjs update (`Uint8Array`).

## One document

```ts
import { migrateServerDocument } from '@kujam/server';

const result = migrateServerDocument(rowFromDatabase, { plugins: [defaultElements, myPlugin] });
if (result.changed) {
  await save(result.update ?? result.document); // `update` is set when the input was binary
}
```

`result` holds `changed`, `fromVersion`, `toVersion`, and `rejected` (invalid records that were dropped). A document newer than the server understands is rejected (it throws) rather than downgraded.

## Bulk script with a dry run and a report

```ts
import { migrateServerBatch } from '@kujam/server';

const dryRun = process.argv.includes('--dry-run');

const report = await migrateServerBatch(await loadAllBoards(), {
  plugins: [defaultElements, myPlugin],
  dryRun,
  // Called only for documents that changed, and never with --dry-run.
  onMigrated: async (id, result) => {
    await saveBoard(id, result.update ?? result.document);
  },
});

console.log(dryRun ? 'DRY RUN, nothing saved' : 'Migration finished');
console.log(`${report.migrated} changed, ${report.unchanged} unchanged, ${report.failed} failed`);
for (const entry of report.entries.filter((e) => e.status === 'failed')) {
  console.error(`${entry.id}: ${entry.error}`);
}
process.exitCode = report.failed > 0 ? 1 : 0;
```

A failing document does not stop the batch; its failure shows up in `report.entries`. Always run with `--dry-run` first on production data.

## Thumbnails on the server (BOARD-1804)

```ts
import { renderThumbnail } from '@kujam/server';

const png = await renderThumbnail(doc, { width: 400, plugins: [defaultElements] });
```

`@napi-rs/canvas` is optional and loaded on first use. If it is not installed, the function throws a clear error so the app can fall back to client-side thumbnails (BOARD-1708). For another canvas, pass `canvasFactory(width, height)` returning `{ canvas, ctx }`; `canvas` must have `toBuffer('image/png')` or `encode('png')`.

## Complete worker (BOARD-1805)

A worker that combines validation, reference extraction with a placement diff, and thumbnails once changes settle is in [`examples/server-worker`](../examples/server-worker/README.md).
