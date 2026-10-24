import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const pkg = (name: string, entry = 'index.ts') =>
  resolve(__dirname, `../../packages/${name}/src/${entry}`);

export default defineConfig({
  resolve: {
    // Import the packages from source, like the playground, for instant reloads.
    alias: {
      '@kujam/core': pkg('core'),
      '@kujam/renderer': pkg('renderer'),
      '@kujam/shapes': pkg('shapes'),
      '@kujam/sync-yjs': pkg('sync-yjs'),
      '@kujam/storage-indexeddb': pkg('storage-indexeddb'),
      '@kujam/ui': pkg('ui'),
      '@kujam/export': pkg('export'),
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
