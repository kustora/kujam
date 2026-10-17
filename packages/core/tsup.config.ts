import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // composite (project references) conflicts with tsup's dts build for multi-file entries.
  dts: { compilerOptions: { composite: false } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  // BOARD-102: core must run in Node, browsers, and Web Workers. The `neutral` platform with
  // the `browser` condition picks the cross-runtime builds of inlined dependencies. With the
  // default platform (`node`), nanoid resolves to the Node build that imports `crypto`,
  // so the bundle fails to load in a Worker.
  platform: 'neutral',
  esbuildOptions(options) {
    options.conditions = ['browser'];
    options.mainFields = ['browser', 'module', 'main'];
  },
  // BOARD-102: small utility libraries are inlined so @kujam/core has no runtime dependencies.
  noExternal: ['rbush', 'fractional-indexing', 'nanoid'],
});
