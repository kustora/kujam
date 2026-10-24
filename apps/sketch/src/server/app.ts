/**
 * The sketch server: one port for the page, the room API, and the collaboration WebSocket.
 *
 * It is the example Hocuspocus server (BOARD-1510: SQLite persistence, read-only connections,
 * document validation, and the BOARD-2009/2010 guards) with room tokens as its authentication and
 * an `onRequest` extension that answers HTTP: `/api/*` first, then the client (Vite in development,
 * the built files in production).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createCollaborationServer,
  type CollaborationServer,
} from '@kujam/example-hocuspocus-server/server';
import { createApiHandler, type RateLimit } from './api.js';
import { createRoomVerifier } from './auth.js';
import { RoomStore } from './rooms.js';

/** Serves the client; returns `false` when the request was not handled. */
export type ClientHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

export interface SketchServerOptions {
  readonly port?: number;
  /** SQLite file for rooms and documents, or `':memory:'` (default). */
  readonly databasePath?: string;
  /** Serves the page and its assets. Without it, only the API and the WebSocket answer. */
  readonly client?: ClientHandler;
  readonly createLimit?: RateLimit;
  readonly trustProxy?: boolean;
  readonly quiet?: boolean;
}

export interface SketchServer {
  readonly collaboration: CollaborationServer;
  readonly rooms: RoomStore;
  listen(port?: number): Promise<SketchServer>;
  destroy(): Promise<void>;
  readonly httpURL: string;
}

export function createSketchServer(options: SketchServerOptions = {}): SketchServer {
  const databasePath = options.databasePath ?? ':memory:';
  const rooms = new RoomStore(databasePath);
  const api = createApiHandler({
    rooms,
    createLimit: options.createLimit,
    trustProxy: options.trustProxy,
  });
  const client = options.client;

  const collaboration = createCollaborationServer({
    port: options.port ?? 3100,
    database: { path: databasePath },
    auth: createRoomVerifier(rooms),
    quiet: options.quiet ?? false,
    debounceMs: 1000,
    extensions: [
      {
        async onRequest({ request, response }) {
          let handled = await api(request, response);
          if (!handled && client) handled = await client(request, response);
          if (!handled) {
            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Tidak ditemukan');
          }
          // Rejecting with nothing stops Hocuspocus from writing its own response.
          return Promise.reject();
        },
      },
    ],
  });

  const server: SketchServer = {
    collaboration,
    rooms,
    async listen(port) {
      await collaboration.listen(port);
      return server;
    },
    async destroy() {
      await collaboration.destroy();
      rooms.close();
    },
    get httpURL() {
      return collaboration.httpURL;
    },
  };
  return server;
}
