import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // composite (project references) bentrok dengan build dts tsup untuk entry multi-file.
  dts: { compilerOptions: { composite: false } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['@kujam/core', 'perfect-freehand'],
});
