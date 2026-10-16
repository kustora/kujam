import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // composite (project references) bentrok dengan build dts tsup untuk entry multi-file.
  dts: { compilerOptions: { composite: false } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  // BOARD-102: Inline small utility libraries so @kujam/core has zero runtime dependencies
  noExternal: ['rbush', 'fractional-indexing', 'nanoid'],
});
