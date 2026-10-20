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

// BOARD-2006: Nonce Vite puts on the scripts and styles it injects, allowed by the strict policy.
const CSP_NONCE = 'kujam-playground';

/**
 * Strict Content Security Policy for pages opened with `?csp=1` (BOARD-2006): no `unsafe-eval` and
 * no `unsafe-inline`. Only the playground's own `<style>` and Vite's injected tags pass, through
 * the nonce; package code has to work without either.
 */
const STRICT_CSP = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${CSP_NONCE}'`,
  `style-src 'self' 'nonce-${CSP_NONCE}'`,
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function strictCsp(): Plugin {
  return {
    name: 'kujam-playground-strict-csp',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (new URL(req.url ?? '/', 'http://localhost').searchParams.get('csp') === '1') {
          res.setHeader('content-security-policy', STRICT_CSP);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [lanInfo(), strictCsp()],
  html: { cspNonce: CSP_NONCE },
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
