import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // BOARD-2401: Mengimpor package langsung dari source workspace untuk hot reload instan
    alias: {
      '@kujam/core': resolve(__dirname, '../../packages/core/src/index.ts'),
      '@kujam/renderer': resolve(__dirname, '../../packages/renderer/src/index.ts'),
      '@kujam/shapes': resolve(__dirname, '../../packages/shapes/src/index.ts'),
      '@kujam/sync-yjs': resolve(__dirname, '../../packages/sync-yjs/src/index.ts'),
      '@kujam/storage-memory': resolve(__dirname, '../../packages/storage-memory/src/index.ts'),
      '@kujam/storage-indexeddb': resolve(
        __dirname,
        '../../packages/storage-indexeddb/src/index.ts',
      ),
      '@kujam/storage-http': resolve(__dirname, '../../packages/storage-http/src/index.ts'),
      '@kujam/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
      '@kujam/react': resolve(__dirname, '../../packages/react/src/index.tsx'),
      '@kujam/vue': resolve(__dirname, '../../packages/vue/src/index.ts'),
      '@kujam/export': resolve(__dirname, '../../packages/export/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});

