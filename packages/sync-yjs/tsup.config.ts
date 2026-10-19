import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // composite (project references) conflicts with tsup's dts build for multi-file entries.
  dts: { compilerOptions: { composite: false } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['@kujam/core', 'yjs', 'y-protocols', 'y-indexeddb'],
});
