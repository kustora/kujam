/**
 * Room HTTP API, served next to the collaboration WebSocket:
 *
 * - `POST /api/rooms` `{ name? }` creates a room and returns its edit and view tokens (once).
 * - `GET /api/rooms/:id` with `Authorization: Bearer <token>` returns the room name and the role
 *   the token gives. An unknown room and a wrong token both answer 404, so IDs cannot be probed.
 * - `GET /api/health` for load balancers.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  ApiErrorResponse,
  CreatedRoomResponse,
  RoomInfoResponse,
} from '../shared/protocol.js';
import type { RoomStore } from './rooms.js';

/** Largest accepted request body, in bytes. */
const MAX_BODY_BYTES = 4096;

/** Room creation limit per client address. */
export interface RateLimit {
  readonly max: number;
  readonly windowMs: number;
}

export const DEFAULT_CREATE_LIMIT: RateLimit = { max: 20, windowMs: 10 * 60_000 };

export interface ApiOptions {
  readonly rooms: RoomStore;
  readonly createLimit?: RateLimit;
  /** Read the client address from `X-Forwarded-For` (only behind a trusted proxy). */
  readonly trustProxy?: boolean;
  readonly now?: () => number;
}

/** Handles `/api/*` requests; returns `false` for other paths. */
export type ApiHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(text);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const type = request.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'Body wajib berupa application/json.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Body terlalu besar.');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body bukan JSON yang valid.');
  }
}

function clientAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

/** Fixed-window counter per key. */
function createLimiter(limit: RateLimit, now: () => number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const t = now();
    // Forget old windows now and then, so the map does not grow without bound.
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (t - w.start >= limit.windowMs) windows.delete(k);
    }
    const current = windows.get(key);
    if (!current || t - current.start >= limit.windowMs) {
      windows.set(key, { start: t, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit.max;
  };
}

export function createApiHandler(options: ApiOptions): ApiHandler {
  const { rooms } = options;
  const now = options.now ?? Date.now;
  const allowCreate = createLimiter(options.createLimit ?? DEFAULT_CREATE_LIMIT, now);

  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        send(response, 200, { ok: true });
        return true;
      }

      if (url.pathname === '/api/rooms') {
        if (request.method !== 'POST') throw new HttpError(405, 'Metode tidak didukung.');
        if (!allowCreate(clientAddress(request, options.trustProxy ?? false))) {
          throw new HttpError(429, 'Terlalu banyak room dibuat; coba lagi nanti.');
        }
        const body = (await readJson(request)) as { name?: unknown };
        const room = rooms.create(body?.name);
        const result: CreatedRoomResponse = {
          id: room.id,
          name: room.name,
          editToken: room.editToken,
          viewToken: room.viewToken,
        };
        send(response, 201, result);
        return true;
      }

      const match = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
      if (match) {
        if (request.method !== 'GET') throw new HttpError(405, 'Metode tidak didukung.');
        const auth = request.headers.authorization ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        const room = rooms.verify(decodeURIComponent(match[1]!), token);
        if (!room) throw new HttpError(404, 'Room tidak ditemukan atau link tidak valid.');
        const result: RoomInfoResponse = { id: room.id, name: room.name, role: room.role };
        send(response, 200, result);
        return true;
      }

      throw new HttpError(404, 'Endpoint tidak ditemukan.');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'Kesalahan server.';
      if (status === 500) console.error('[sketch] API error:', error);
      const body: ApiErrorResponse = { error: message };
      send(response, status, body);
      return true;
    }
  };
}
