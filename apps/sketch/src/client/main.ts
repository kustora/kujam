/**
 * kujam sketch entry point.
 *
 * - Without a room in the URL, the board is local: saved in IndexedDB in this browser.
 * - With `#room=<id>,<token>`, the board joins that room on the server; the token decides whether
 *   this person can edit or only view.
 *
 * Switching between the two reloads the page; the drawing is handed over through
 * `sessionStorage`, so starting a session moves the local drawing into the new room and leaving a
 * session keeps a local copy.
 */

import './styles.css';
import {
  attachStorage,
  createBoard,
  defaultCommands,
  type Board,
  type BoardDocument,
  type PresenceUser,
} from '@kujam/core';
import { importJSON } from '@kujam/export';
import { mountRenderer, type BoardView } from '@kujam/renderer';
import { attachTextEditor, defaultElements, defaultTools } from '@kujam/shapes';
import { createIndexedDbStorage } from '@kujam/storage-indexeddb';
import { mountDefaultUi, type MountedUi } from '@kujam/ui';
import { parseRoomHash, roomHash } from '../shared/protocol.js';
import { createRoom, getRoom, rememberLinks } from './api.js';
import {
  applyPageTheme,
  boardTheme,
  initialBackground,
  initialTheme,
  loadFont,
  mountChrome,
  type Chrome,
} from './chrome.js';
import { connectRoom, type RoomConnection } from './collab.js';
import { h, session } from './dom.js';
import { loadUser, renameUser } from './identity.js';
import { openLocalShare, openRoomShare } from './share.js';

const app = document.getElementById('app')!;
const LOCAL_SEED = 'kujam-sketch-local-seed';
const roomSeedKey = (id: string): string => `kujam-sketch-room-seed:${id}`;

interface Editor {
  readonly board: Board;
  readonly view: BoardView;
  readonly ui: MountedUi;
}

function createEditor(options: { document?: BoardDocument; readOnly?: boolean }): Editor {
  const container = h('div', { class: 'sk-board' });
  app.append(container);
  const board = createBoard({
    locale: 'id',
    plugins: [defaultCommands, defaultElements, defaultTools],
    document: options.document,
    readOnly: options.readOnly ?? false,
  });
  board.setTool('select');
  const theme = initialTheme();
  applyPageTheme(theme);
  const view = mountRenderer(board, container, {
    theme: boardTheme(theme),
    background: initialBackground(),
  });
  attachTextEditor(view);
  const ui = mountDefaultUi({ board, container });
  return { board, view, ui };
}

function parseDocument(raw: string | null): BoardDocument | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as BoardDocument;
  } catch {
    return undefined;
  }
}

/** Moves to another URL fragment; the `hashchange` listener reloads into the new mode. */
function go(hash: string): void {
  if (hash === '') {
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  } else {
    location.hash = hash;
  }
}

function showFatal(title: string, message: string): void {
  app.replaceChildren(
    h(
      'div',
      { class: 'sk-fatal' },
      h(
        'div',
        { class: 'sk-island sk-dialog-body', style: 'max-width:440px' },
        h('h2', {}, title),
        h('p', {}, message),
        h(
          'div',
          { class: 'sk-dialog-actions' },
          h(
            'button',
            { class: 'sk-button primary', type: 'button', onclick: () => go('') },
            'Buka papan lokal',
          ),
        ),
      ),
    ),
  );
}

// ---------- Local mode ----------

async function startLocal(): Promise<void> {
  let user = loadUser();
  const { board, view, ui } = createEditor({});
  const adapter = createIndexedDbStorage({ databaseName: 'kujam-sketch' });
  const storage = attachStorage(board, adapter, { boardId: 'local' });

  const chrome: Chrome = mountChrome({
    root: app,
    board,
    view,
    ui,
    mode: 'local',
    readOnly: false,
    user,
    fileName: () => 'kujam-sketch',
    onShare: () =>
      openLocalShare({
        user,
        async start(roomName, userName) {
          user = renameUser(user, userName) ?? user;
          const room = await createRoom(roomName);
          rememberLinks(room.id, { edit: room.editToken, view: room.viewToken });
          // The new room starts with the current drawing.
          await storage.flush();
          session.set(roomSeedKey(room.id), JSON.stringify(board.getDocument()));
          go(roomHash(room.id, room.editToken));
        },
      }),
  });

  storage.on('save:error', (event) => {
    if (!event.willRetry) chrome.toast('Gagal menyimpan ke browser ini.', 'error');
  });
  await storage.ready.catch(() => chrome.toast('Papan lokal gagal dimuat.', 'error'));

  // Coming back from a room: keep its drawing as the local board.
  const seed = parseDocument(session.take(LOCAL_SEED));
  if (seed) {
    const ids = board
      .query({})
      .filter((el) => el.parentId === null)
      .map((el) => el.id);
    if (ids.length > 0) board.delete(ids);
    importJSON(board, seed);
    board.history.clear();
    chrome.toast('Sesi selesai. Salinan papan disimpan di browser ini.');
  }
  if (board.query({}).length > 0) board.camera.zoomToFit();
}

// ---------- Room mode ----------

async function startRoom(id: string, token: string): Promise<void> {
  let info;
  try {
    info = await getRoom(id, token);
  } catch (error) {
    showFatal(
      'Room tidak bisa dibuka',
      error instanceof Error ? error.message : 'Link room tidak valid atau sudah dicabut.',
    );
    return;
  }
  rememberLinks(id, { [info.role]: token });
  document.title = `${info.name} · kujam sketch`;

  const user = loadUser();
  const readOnly = info.role === 'view';
  const seed = readOnly ? undefined : parseDocument(session.take(roomSeedKey(id)));
  const { board, view, ui } = createEditor({ document: seed, readOnly });

  let connection: RoomConnection | null = null;
  const chrome: Chrome = mountChrome({
    root: app,
    board,
    view,
    ui,
    mode: 'room',
    readOnly,
    user,
    fileName: () => info.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'kujam-sketch',
    onShare: () =>
      openRoomShare({
        user,
        roomId: id,
        roomName: info.name,
        role: info.role,
        peers: () => connection?.peers() ?? [user],
        rename(name) {
          // The name travels in the connection token, so a reload reconnects with it.
          if (renameUser(user, name)) location.reload();
        },
        leave() {
          session.set(LOCAL_SEED, JSON.stringify(board.getDocument()));
          connection?.destroy();
          go('');
        },
      }),
  });

  try {
    connection = await connectRoom({
      board,
      roomId: id,
      token,
      user,
      readOnly,
      onState: (state, detail) => {
        chrome.setConnection(state, detail);
        if (state === 'disconnected')
          chrome.setBanner('Koneksi terputus. Perubahanmu dikirim saat tersambung lagi.');
        else if (state === 'connected') chrome.setBanner(readOnly ? 'Mode lihat saja' : null);
      },
      onPeers: (peers: readonly PresenceUser[]) => chrome.setPeers(peers),
    });
    await connection.ready;
    chrome.setConnection('connected');
    if (board.query({}).length > 0) board.camera.zoomToFit();
    chrome.toast(
      seed ? 'Room dibuat. Bagikan link dari tombol Room.' : `Bergabung ke "${info.name}".`,
    );
  } catch (error) {
    chrome.setConnection('error');
    chrome.toast(error instanceof Error ? error.message : String(error), 'error');
  }
}

// ---------- Start ----------

async function start(): Promise<void> {
  window.addEventListener('hashchange', () => location.reload());
  await loadFont();
  const room = parseRoomHash(location.hash);
  if (room) await startRoom(room.id, room.token);
  else if (location.hash.startsWith('#room=')) {
    showFatal('Link tidak valid', 'Format link room ini tidak dikenali.');
  } else await startLocal();
}

void start();
