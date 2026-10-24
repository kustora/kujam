/**
 * Serves the built client (`dist/client`) in production, with a single-page fallback to
 * `index.html` and security headers on the page.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/**
 * Content Security Policy of the page (BOARD-2006): no inline scripts or `eval`. Styles allow
 * `unsafe-inline` because the UI web components and the app set `style` attributes; the Playpen
 * Sans font comes from Google Fonts; images may be `data:` and `blob:` (exports, pasted images);
 * the WebSocket goes to the same host.
 */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' ws: wss:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Handles a static request from `root`; returns `false` when nothing matched. */
export function createStaticHandler(root: string) {
  const index = join(root, 'index.html');

  async function sendFile(response: ServerResponse, file: string, page: boolean): Promise<void> {
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const headers: Record<string, string> = {
      'content-type': type,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      // Hashed asset names never change; the page itself is always revalidated.
      'cache-control': file.includes(`${sep}assets${sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    };
    if (page) headers['content-security-policy'] = PAGE_CSP;
    response.writeHead(200, headers);
    await new Promise<void>((resolve, reject) => {
      createReadStream(file).on('error', reject).on('end', resolve).pipe(response);
    });
  }

  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = normalize(join(root, path));
    // Never serve anything outside the client folder.
    if (file !== root && !file.startsWith(root + sep)) return false;
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) {
      await sendFile(response, file, file === index);
      return true;
    }
    // Client-side routes fall back to the page; missing assets stay 404.
    if (extname(path) !== '') return false;
    await sendFile(response, index, true);
    return true;
  };
}
