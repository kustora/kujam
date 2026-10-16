import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // composite (project references) bentrok dengan build dts tsup untuk entry multi-file.
  dts: { compilerOptions: { composite: false } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  // BOARD-102: core harus jalan di Node, browser, dan Web Worker. Platform `neutral` dengan
  // kondisi `browser` memilih build lintas-runtime dari dependensi yang di-inline. Dengan
  // platform bawaan (`node`), nanoid ter-resolve ke build Node yang mengimpor `crypto`
  // sehingga bundel gagal dimuat di Worker.
  platform: 'neutral',
  esbuildOptions(options) {
    options.conditions = ['browser'];
    options.mainFields = ['browser', 'module', 'main'];
  },
  // BOARD-102: library utilitas kecil di-inline agar @kujam/core tanpa dependensi runtime.
  noExternal: ['rbush', 'fractional-indexing', 'nanoid'],
});
