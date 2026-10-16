/* global console */
// BOARD-007: ukuran bundle (minify + tree-shake + gzip/brotli) untuk skema identik di tiap kandidat.
import { build } from 'esbuild';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const entries = ['mini', 'valibot', 'zod-mini', 'zod'];
console.log('| Kandidat | minify (B) | gzip (B) | brotli (B) |');
console.log('| --- | ---: | ---: | ---: |');
for (const name of entries) {
  const res = await build({
    entryPoints: [`src/entries/${name}.ts`],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'neutral',
    treeShaking: true,
    write: false,
    target: 'es2022',
  });
  const code = res.outputFiles[0].contents;
  console.log(
    `| ${name} | ${code.length} | ${gzipSync(code, { level: 9 }).length} | ${brotliCompressSync(code).length} |`,
  );
}
