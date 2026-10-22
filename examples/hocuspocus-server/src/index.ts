/**
 * Main entrypoint for running the Hocuspocus collaboration server (BOARD-1510).
 *
 * Can be run via `pnpm dev`, `node dist/index.js`, or within a Docker container.
 *
 * @packageDocumentation
 */

import { createCollaborationServer } from './server.js';
import { DocumentDatabase } from './database.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 1234;
const DATABASE_PATH = process.env.DATABASE_PATH ?? './data/kujam.sqlite';
const AUTH_ENDPOINT = process.env.AUTH_ENDPOINT;
const DEBOUNCE_MS = process.env.DEBOUNCE_MS ? parseInt(process.env.DEBOUNCE_MS, 10) : 2000;
// Periodic compaction of stored documents (BOARD-1515); hourly by default, `0` turns it off.
const COMPACT_INTERVAL_MS = process.env.COMPACT_INTERVAL_MS
  ? parseInt(process.env.COMPACT_INTERVAL_MS, 10)
  : 3_600_000;

const db = new DocumentDatabase({ path: DATABASE_PATH });

const collaborationServer = createCollaborationServer({
  port: PORT,
  database: db,
  debounceMs: DEBOUNCE_MS,
  compactIntervalMs: COMPACT_INTERVAL_MS,
  auth: {
    authEndpointUrl: AUTH_ENDPOINT,
    allowAnonymous: false,
  },
  // Mock tokens are refused in production unless explicitly allowed (local Docker demo).
  ...(process.env.ALLOW_MOCK_TOKENS === 'true' ? { allowMockTokens: true } : {}),
});

async function main() {
  await collaborationServer.listen();

  console.log('----------------------------------------------------');
  console.log(' Whiteboard Collaboration Server (Hocuspocus)');
  console.log('----------------------------------------------------');
  console.log(` > WebSocket URL: ${collaborationServer.webSocketURL}`);
  console.log(` > HTTP URL:      ${collaborationServer.httpURL}`);
  console.log(` > Database:      ${DATABASE_PATH}`);
  if (AUTH_ENDPOINT) {
    console.log(` > Auth Endpoint: ${AUTH_ENDPOINT}`);
  } else {
    console.log(' > Auth Mode:     Mock Tokens (editor, viewer, or mock:<id>:<role>:<name>)');
  }
  console.log('----------------------------------------------------');

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down collaboration server gracefully...`);
    try {
      await collaborationServer.destroy();
      console.log('Collaboration server shut down cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start collaboration server:', err);
  process.exit(1);
});

export { createCollaborationServer, DocumentDatabase };
