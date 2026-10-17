import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// BOARD-2401: LAN addresses for the "open on another device" QR code.
function lanInfo(): Plugin {
  return {
    name: 'kujam-playground-lan-info',
    configureServer(server) {
      server.middlewares.use('/__playground/lan', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ network: server.resolvedUrls?.network ?? [] }));
      });
    },
  };
}

export default defineConfig({
  plugins: [lanInfo()],
  resolve: {
    // BOARD-2401: Import packages directly from workspace source for instant hot reload
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
