# kujam sketch

An Excalidraw-style whiteboard built on the `@kujam/*` packages, with rooms you can share by link.

- **Local first.** Without a room, the board is saved in IndexedDB in your browser.
- **Live collaboration.** "Bagikan" (Share) creates a room on the server, moves the current
  drawing into it, and gives you two links: one to edit and one to view only. Anyone with a link
  can join; cursors, selections, and live strokes show up for everyone.
- **Built from the package UI.** The tools, zoom, undo/redo, selection toolbar, context menu,
  command palette (`/`), presence bar, and shortcut help (`?`) are the `@kujam/ui` web components,
  placed in an Excalidraw-like layout. The app adds the main menu, the share dialog, and the
  welcome screen.
- **Files.** Open `.json` boards and `.excalidraw` files, save as JSON, and export PNG, SVG, or a
  PDF with one page per frame (`@kujam/export`).

## Run it

```sh
pnpm install
pnpm turbo run build --filter=@kujam/app-sketch^...   # build the packages it uses
pnpm --filter @kujam/app-sketch dev                    # http://localhost:3100
```

In development the page, the API, and the WebSocket share port 3100; Vite runs inside the server
and uses port 3101 for hot reload.

Production:

```sh
pnpm --filter @kujam/app-sketch build
pnpm --filter @kujam/app-sketch start
```

| Variable        | Default                | Meaning                                                 |
| --------------- | ---------------------- | ------------------------------------------------------- |
| `PORT`          | `3100`                 | HTTP and WebSocket port                                 |
| `DATABASE_PATH` | `./data/sketch.sqlite` | SQLite file for rooms and drawings                      |
| `TRUST_PROXY`   | unset                  | `1` to read the client address from `X-Forwarded-For`   |
| `NODE_ENV`      | unset                  | `production` serves the built client from `dist/client` |

Behind a reverse proxy, forward WebSocket upgrades on `/collab` and use HTTPS, so share links and
the WebSocket travel encrypted.

## How rooms work

```
browser ──HTTP──▶ POST /api/rooms           → { id, editToken, viewToken }
        ──HTTP──▶ GET  /api/rooms/:id        (Authorization: Bearer <token>) → { name, role }
        ──WS────▶ /collab, document = room id, token = { room token, name, color }
```

- A share link is `https://host/#room=<id>,<token>`. The token is in the URL fragment, so it never
  reaches server logs or `Referer` headers.
- The server stores only SHA-256 hashes of the tokens. The view token gives a read-only
  connection: the server drops document updates from it.
- The collaboration server is `@kujam/example-hocuspocus-server`: SQLite persistence, document
  validation, and guards against oversized or forged messages. The name and color a person picks
  are cleaned and then enforced on their presence, so nobody can appear as someone else.
- Room creation is rate limited per client address (20 per 10 minutes).

There are no accounts: whoever holds a link has its access. Links cannot be revoked yet; create a
new room to stop sharing an old one.

## Code

| Path                     | What                                                     |
| ------------------------ | -------------------------------------------------------- |
| `src/client/main.ts`     | Local and room modes, switching between them             |
| `src/client/chrome.ts`   | Layout, main menu, files and exports, welcome screen     |
| `src/client/share.ts`    | Share dialog: start a session, links, name, leave        |
| `src/client/collab.ts`   | Hocuspocus provider + `@kujam/sync-yjs` adapter          |
| `src/server/app.ts`      | Collaboration server with the API as an `onRequest` hook |
| `src/server/api.ts`      | Room API                                                 |
| `src/server/rooms.ts`    | Room store (SQLite, hashed tokens)                       |
| `src/shared/protocol.ts` | Types and parsing shared by browser and server           |

Tests: `pnpm vitest run --project sketch` (room API, tokens, read-only connections, persistence).
