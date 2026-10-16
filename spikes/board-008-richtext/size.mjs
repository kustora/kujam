/* global console */
// BOARD-008: ukuran bundle editor minimal (minify + tree-shake + gzip) untuk fitur yang sama.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const entries = ['quill', 'lexical', 'prosemirror', 'yjs-binding'];
console.log('| Entri | minify (KB) | gzip (KB) |');
console.log('| --- | ---: | ---: |');
for (const name of entries) {
  const res = await build({
    entryPoints: [`src/editors/${name}.ts`],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
    conditions: ['production'],
    metafile: true,
  });
  const code = res.outputFiles[0].contents;
  const kb = (n) => (n / 1024).toFixed(1);
  console.log(`| ${name} | ${kb(code.length)} | ${kb(gzipSync(code, { level: 9 }).length)} |`);
}
