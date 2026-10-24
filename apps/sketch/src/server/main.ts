/**
 * Starts the sketch server.
 *
 * - Development (`pnpm dev`): Vite runs inside the server in middleware mode, so the page, the API,
 *   and the WebSocket share one port; Vite's hot reload uses its own port.
 * - Production (`pnpm build && pnpm start`): the built client in `dist/client` is served.
 *
 * Environment: `PORT` (3100), `DATABASE_PATH` (`./data/sketch.sqlite`), `TRUST_PROXY=1` behind a
 * reverse proxy, `NODE_ENV=production`.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSketchServer, type ClientHandler } from './app.js';
import { createStaticHandler } from './static.js';

const here = dirname(fileURLToPath(import.meta.url));
// `src/server` in development and `dist/server` once built: the app folder is two levels up.
const appRoot = resolve(here, '../..');
const production = process.env.NODE_ENV === 'production';
const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3100;
const databasePath = process.env.DATABASE_PATH ?? resolve(appRoot, 'data/sketch.sqlite');

async function devClient(): Promise<{ handler: ClientHandler; close: () => Promise<void> }> {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: appRoot,
    configFile: resolve(appRoot, 'vite.config.ts'),
    appType: 'spa',
    server: { middlewareMode: true, hmr: { port: port + 1 } },
  });
  const handler: ClientHandler = (request, response) =>
    new Promise((done) => {
      response.once('finish', () => done(true));
      vite.middlewares(request, response, () => done(false));
    });
  return { handler, close: () => vite.close() };
}

async function main(): Promise<void> {
  const dev = production ? null : await devClient();
  const client = dev?.handler ?? createStaticHandler(resolve(appRoot, 'dist/client'));
  const server = createSketchServer({
    port,
    databasePath,
    client,
    trustProxy: process.env.TRUST_PROXY === '1',
    quiet: true,
  });
  await server.listen();
  console.log(
    `kujam sketch: http://localhost:${port} (${production ? 'production' : 'development'})`,
  );
  console.log(`  database: ${databasePath}`);

  const shutdown = async (): Promise<void> => {
    await server.destroy();
    await dev?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error('kujam sketch failed to start:', error);
  process.exit(1);
});
