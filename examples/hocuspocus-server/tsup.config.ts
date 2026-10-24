import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts', 'src/auth.ts'],
  format: ['esm'],
  // tsup's declaration build sets `baseUrl`, which TypeScript 6 reports as deprecated (TS5101).
  dts: { compilerOptions: { ignoreDeprecations: '6.0', types: ['node'] } },
  sourcemap: true,
  clean: true,
  target: 'node20',
});
