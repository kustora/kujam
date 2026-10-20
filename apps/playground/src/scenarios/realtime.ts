/**
 * Realtime collaboration through the example Hocuspocus server: every browser tab is one user.
 *
 * Start the server with `pnpm --filter @kujam/example-hocuspocus-server dev`, open
 * `/s/realtime`, then open more tabs (or the "new tab" button). Each tab gets its own name and
 * color (see `realtime.ts`), which it keeps across reloads.
 *
 * Query:
 * - `room=<name>`: document name on the server (default `kujam-realtime`).
 * - `server=<ws url>`: Hocuspocus address (default `ws://<page host>:1234`, so phones and tablets
 *   on the same network reach the server through the LAN address).
 * - `role=viewer`: join read-only (the server rejects this tab's document updates).
 *
 * In test mode the tab's user and connection are exposed as `window.__realtime`.
 */

import {
  attachSync,
  createBoard,
  defaultCommands,
  type PresenceUser,
  type SyncAttachment,
} from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { attachTextEditor, defaultElements, defaultTools } from '@kujam/shapes';
import { createYjsSyncAdapter } from '@kujam/sync-yjs';
import { mountDefaultUi } from '@kujam/ui';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import { append, h, section } from '../dom.js';
import { claimTabIdentity, mockToken, type TabIdentity } from '../realtime.js';
import { defineScenario } from '../scenario.js';

const DEFAULT_ROOM = 'kujam-realtime';
const SERVER_PORT = 1234;
const SYNC_TIMEOUT_MS = 8000;

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

const CONNECTION_TEXT: Record<ConnectionState, string> = {
  connecting: 'Menyambung…',
  connected: 'Tersambung',
  disconnected: 'Terputus, mencoba lagi…',
  error: 'Gagal',
};
const CONNECTION_CLASS: Record<ConnectionState, string> = {
  connecting: 'status warn',
  connected: 'status ok',
  disconnected: 'status warn',
  error: 'status error',
};

/** Tab handle exposed as `window.__realtime` in test mode. */
export interface RealtimeHandle {
  readonly user: PresenceUser;
  readonly room: string;
  readonly readOnly: boolean;
  connection(): ConnectionState;
  /** Users currently in the room, this tab included. */
  peers(): PresenceUser[];
  /** Resolves once the first sync with the server finished. */
  readonly ready: Promise<void>;
}

declare global {
  interface Window {
    __realtime?: RealtimeHandle;
  }
}

function defaultServer(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.hostname || '127.0.0.1'}:${SERVER_PORT}`;
}

export default defineScenario({
  id: 'realtime',
  title: 'Kolaborasi realtime (Hocuspocus)',
  description:
    'Satu papan penuh tersambung ke server Hocuspocus contoh; setiap tab browser menjadi pengguna berbeda.',
  order: 61,
  layout: 'board',
  mount({ main, controls, debug, state, expose }) {
    const testMode = new URL(location.href).searchParams.get('test') === '1';
    const room = state.get('room') || DEFAULT_ROOM;
    const server = state.get('server') || defaultServer();
    const readOnly = state.get('role') === 'viewer';

    let disposed = false;
    let connection: ConnectionState = 'connecting';
    let identity: TabIdentity | null = null;
    let teardown: (() => void) | null = null;

    // ---------- Controls ----------
    const you = h('div', { class: 'row' });
    const connectionStatus = h('p', { class: CONNECTION_CLASS.connecting }, '…');
    const peerList = h('ul', { class: 'checklist', dataset: { testid: 'realtime-peers' } });
    const roomInput = h('input', {
      value: room,
      'aria-label': 'Nama room',
      class: 'code-input',
      style: 'padding:4px 8px',
    });
    const newTab = h(
      'button',
      {
        type: 'button',
        // `noopener` gives the new tab its own (empty) sessionStorage, so it becomes a new user.
        onclick: () => window.open(location.href, '_blank', 'noopener'),
      },
      'Buka tab baru (pengguna baru)',
    );
    const resetIdentity = h(
      'button',
      {
        type: 'button',
        class: 'ghost',
        onclick: () => {
          try {
            sessionStorage.removeItem('kujam-realtime-user');
          } catch {
            // Storage blocked: the reload creates a new user anyway.
          }
          location.reload();
        },
      },
      'Ganti identitas',
    );
    const joinRoom = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const next = roomInput.value.trim();
          state.set('room', next && next !== DEFAULT_ROOM ? next : null);
          location.reload();
        },
      },
      'Masuk',
    );

    controls.append(
      section('Kamu', you, h('div', { class: 'row wrap' }, newTab, resetIdentity)),
      section('Koneksi', connectionStatus, h('p', { class: 'muted' }, h('code', {}, server))),
      section('Room', h('div', { class: 'row' }, roomInput, joinRoom)),
      section('Di room ini', peerList),
      section(
        'Cara pakai',
        h(
          'p',
          { class: 'muted' },
          'Jalankan ',
          h('code', {}, 'pnpm --filter @kujam/example-hocuspocus-server dev'),
          ', lalu buka halaman ini di beberapa tab atau perangkat. Setiap tab adalah satu pengguna. ',
          'Tambah ',
          h('code', {}, '?role=viewer'),
          ' untuk masuk baca-saja.',
        ),
      ),
    );

    const debugInfo = h('pre', {}, '…');
    debug.append(section('Sinkronisasi', debugInfo));

    function setConnection(next: ConnectionState, detail?: string): void {
      connection = next;
      connectionStatus.className = CONNECTION_CLASS[next];
      connectionStatus.dataset.state = next;
      connectionStatus.textContent = detail
        ? `${CONNECTION_TEXT[next]}: ${detail}`
        : CONNECTION_TEXT[next];
    }

    // ---------- Board and connection ----------
    const ready = (async () => {
      identity = await claimTabIdentity();
      if (disposed) {
        identity.release();
        return;
      }
      const user = identity.user;
      document.title = `${user.name} · realtime · @kujam/*`;
      you.replaceChildren();
      append(
        you,
        h('span', {
          style: `width:12px;height:12px;border-radius:50%;background:${user.color};flex:none`,
        }),
        h('strong', { dataset: { testid: 'realtime-user' } }, user.name),
        h('code', { class: 'muted' }, user.id),
        readOnly ? h('span', { class: 'muted' }, '(baca-saja)') : null,
      );

      const doc = new Y.Doc();
      const awareness = new Awareness(doc);
      const board = createBoard({
        locale: 'id',
        plugins: [defaultCommands, defaultElements, defaultTools],
      });
      board.setTool('select');
      expose(board);

      const view = mountRenderer(board, main, { background: 'dots' });
      const textEditor = attachTextEditor(view);
      const ui = mountDefaultUi({ board, container: main });
      const badge = h(
        'div',
        {
          style:
            'position:absolute;top:16px;left:16px;z-index:5;display:flex;align-items:center;gap:6px;' +
            'padding:4px 10px;border-radius:999px;background:rgba(15,23,42,.85);color:#f8fafc;font-size:12px;' +
            'pointer-events:none',
        },
        h('span', {
          style: `width:10px;height:10px;border-radius:50%;background:${user.color}`,
        }),
        readOnly ? `${user.name} (baca-saja)` : user.name,
      );
      main.append(badge);

      const mod = await import('@hocuspocus/provider');
      const socket = new mod.HocuspocusProviderWebsocket({ url: server });
      const provider = new mod.HocuspocusProvider({
        websocketProvider: socket,
        name: room,
        document: doc,
        awareness,
        token: mockToken(user, readOnly),
      });

      const renderPeers = (): void => {
        peerList.replaceChildren(
          ...peers().map((p) =>
            h('li', { style: `color:${p.color}` }, p.id === user.id ? `${p.name} (kamu)` : p.name),
          ),
        );
        debugInfo.textContent = JSON.stringify(
          {
            room,
            clientID: doc.clientID,
            synced: provider.isSynced,
            unsyncedChanges: provider.unsyncedChanges,
            records: board.getDocument().records.length,
            boardSync: board.sync?.status ?? null,
          },
          null,
          2,
        );
      };
      function peers(): PresenceUser[] {
        const seen = new Map<string, PresenceUser>();
        for (const value of awareness.getStates().values()) {
          const peer = (value as { user?: PresenceUser }).user;
          if (peer?.id && !seen.has(peer.id)) seen.set(peer.id, peer);
        }
        if (!seen.has(user.id)) seen.set(user.id, user);
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
      }

      // The provider owns the WebSocket and reconnects by itself. The adapter is told about drops
      // (so `board.sync` and the presence bar show them) and its reconnect only waits for the
      // provider's next sync.
      let providerStatus = 'connecting';
      let authFailure: Error | null = null;
      const waiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();

      function waitForSync(): Promise<void> {
        if (authFailure) return Promise.reject(authFailure);
        if (providerStatus === 'connected' && provider.isSynced) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          const waiter = {
            resolve: () => {
              clearTimeout(timer);
              waiters.delete(waiter);
              resolve();
            },
            reject: (error: Error) => {
              clearTimeout(timer);
              waiters.delete(waiter);
              reject(error);
            },
          };
          const timer = setTimeout(
            () =>
              waiter.reject(
                new Error(`server ${server} tidak menjawab dalam ${SYNC_TIMEOUT_MS / 1000} detik`),
              ),
            SYNC_TIMEOUT_MS,
          );
          waiters.add(waiter);
        });
      }

      let resolveReady!: () => void;
      let rejectReady!: (error: Error) => void;
      const firstSync = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });

      const adapter = createYjsSyncAdapter({
        doc,
        awareness,
        user,
        readOnly,
        indexeddb: false,
        reconnect: { initialDelayMs: 250, maxDelayMs: 5000 },
        connect: () =>
          waitForSync().then(resolveReady, (error: Error) => {
            rejectReady(error);
            throw error;
          }),
      });

      provider.on('status', ({ status }: { status: string }) => {
        providerStatus = status;
        if (authFailure) return;
        if (status === 'connected') setConnection('connected');
        else if (status === 'connecting') setConnection('connecting');
        else {
          setConnection('disconnected');
          if (adapter.status === 'synced') {
            adapter.handleError?.(new Error('Koneksi ke server terputus'));
          }
        }
        renderPeers();
      });
      provider.on('synced', () => {
        for (const waiter of [...waiters]) waiter.resolve();
        renderPeers();
      });
      provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
        // `reason: 'auth'` makes the adapter stop retrying and report status `error`.
        authFailure = Object.assign(new Error(`autentikasi ditolak (${reason})`), {
          reason: 'auth',
        });
        for (const waiter of [...waiters]) waiter.reject(authFailure);
        setConnection('error', authFailure.message);
      });
      provider.on('unsyncedChanges', renderPeers);
      awareness.on('change', renderPeers);
      const offChange = board.on('change', renderPeers);
      const offStatus = adapter.on?.('status', renderPeers);

      let sync: SyncAttachment | null = null;
      teardown = () => {
        offChange();
        offStatus?.();
        for (const waiter of [...waiters]) waiter.reject(new Error('scenario ditutup'));
        sync?.disconnect();
        provider.destroy();
        socket.destroy();
        ui.unmount();
        textEditor.detach();
        view.unmount();
        badge.remove();
        board.dispose();
        adapter.destroy?.();
        awareness.destroy();
        doc.destroy();
      };
      if (disposed) {
        teardown();
        return;
      }

      provider.attach();
      sync = attachSync(board, adapter);
      renderPeers();

      if (testMode) {
        window.__realtime = {
          user,
          room,
          readOnly,
          connection: () => connection,
          peers,
          ready: firstSync,
        };
      }

      await firstSync;
      if (!disposed) setConnection('connected');
    })();

    ready.catch((error: unknown) => {
      if (disposed) return;
      setConnection(
        'error',
        `${error instanceof Error ? error.message : String(error)}. Jalankan server dengan pnpm --filter @kujam/example-hocuspocus-server dev.`,
      );
    });

    return () => {
      disposed = true;
      teardown?.();
      identity?.release();
      delete window.__realtime;
    };
  },
});
