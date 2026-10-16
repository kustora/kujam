import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Menerima hasil bench lewat POST /__results agar Safari asli dan iPad (lewat LAN)
// bisa menyimpan angka ke repo tanpa Playwright.
function resultsSink(): Plugin {
  return {
    name: 'board-003-results-sink',
    configureServer(server) {
      server.middlewares.use('/__results', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const parsed = JSON.parse(body) as { label: string };
          const dir = resolve(__dirname, 'results');
          mkdirSync(dir, { recursive: true });
          const safe = parsed.label.replace(/[^a-zA-Z0-9_-]+/g, '-');
          writeFileSync(resolve(dir, `${safe}.json`), JSON.stringify(parsed, null, 2));
          res.setHeader('content-type', 'application/json');
          res.end('{"ok":true}');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [resultsSink()],
  server: {
    port: 5199,
    host: true,
    // Cross-origin isolation agar performance.measureUserAgentSpecificMemory() tersedia di Chromium.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
