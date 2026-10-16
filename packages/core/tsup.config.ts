import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // BOARD-102: Inline small utility libraries so @kujam/core has zero runtime dependencies
  noExternal: ['rbush', 'fractional-indexing', 'nanoid'],
});

