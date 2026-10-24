import { defineConfig } from 'tsup';

// Server bundle: dependencies stay external and are installed next to it.
export default defineConfig({
  entry: { 'server/main': 'src/server/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: false,
  sourcemap: true,
  external: ['vite'],
});
