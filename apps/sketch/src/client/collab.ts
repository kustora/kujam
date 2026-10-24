/**
 * Connects a board to a room on the sketch server: Hocuspocus over WebSocket, the board bound to a
 * `Y.Doc` by `@kujam/sync-yjs`, and presence (cursors, selections, live strokes) through awareness.
 *
 * The provider owns the socket and reconnects by itself; the adapter only waits for its next sync,
 * and is told about drops so `board.sync` and the presence bar show them.
 */

import { attachSync, type Board, type PresenceUser, type SyncAttachment } from '@kujam/core';
import { createYjsSyncAdapter, type YjsSyncAdapter } from '@kujam/sync-yjs';
import { Awareness } from 'y-protocols/awareness.js';
import * as Y from 'yjs';
import { encodeConnectionToken } from '../shared/protocol.js';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface RoomConnectionOptions {
  readonly board: Board;
  readonly roomId: string;
  readonly token: string;
  readonly user: PresenceUser;
  readonly readOnly: boolean;
  /** WebSocket URL; defaults to the page's own host. */
  readonly url?: string;
  readonly onState?: (state: ConnectionState, detail?: string) => void;
  /** Called when the set of people in the room changes. */
  readonly onPeers?: (peers: readonly PresenceUser[]) => void;
}

export interface RoomConnection {
  readonly adapter: YjsSyncAdapter;
  /** Resolves after the first sync with the server, or rejects when it fails. */
  readonly ready: Promise<void>;
  peers(): PresenceUser[];
  destroy(): void;
}

/** First sync timeout, in milliseconds. */
const SYNC_TIMEOUT_MS = 10_000;

function defaultUrl(): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/collab`;
}

export async function connectRoom(options: RoomConnectionOptions): Promise<RoomConnection> {
  const { board, user, readOnly } = options;
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const { HocuspocusProvider, HocuspocusProviderWebsocket } = await import('@hocuspocus/provider');
  const socket = new HocuspocusProviderWebsocket({ url: options.url ?? defaultUrl() });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: options.roomId,
    document: doc,
    awareness,
    token: encodeConnectionToken({ token: options.token, user }),
  });

  let status = 'connecting';
  let authFailure: Error | null = null;
  const waiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();

  function waitForSync(): Promise<void> {
    if (authFailure) return Promise.reject(authFailure);
    if (status === 'connected' && provider.isSynced) return Promise.resolve();
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
        () => waiter.reject(new Error('Server tidak menjawab; mencoba lagi.')),
        SYNC_TIMEOUT_MS,
      );
      waiters.add(waiter);
    });
  }

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const adapter = createYjsSyncAdapter({
    doc,
    awareness,
    user,
    readOnly,
    indexeddb: false,
    reconnect: { initialDelayMs: 300, maxDelayMs: 8000 },
    connect: () =>
      waitForSync().then(resolveReady, (error: Error) => {
        if (authFailure) rejectReady(error);
        throw error;
      }),
  });

  function peers(): PresenceUser[] {
    const seen = new Map<string, PresenceUser>([[user.id, user]]);
    for (const value of awareness.getStates().values()) {
      const peer = (value as { user?: PresenceUser }).user;
      if (peer?.id && !seen.has(peer.id)) seen.set(peer.id, peer);
    }
    return [...seen.values()];
  }
  const notifyPeers = (): void => options.onPeers?.(peers());

  provider.on('status', ({ status: next }: { status: string }) => {
    status = next;
    if (authFailure) return;
    if (next === 'connected') options.onState?.('connected');
    else if (next === 'connecting') options.onState?.('connecting');
    else {
      options.onState?.('disconnected');
      if (adapter.status === 'synced') adapter.handleError?.(new Error('Koneksi terputus'));
    }
  });
  provider.on('synced', () => {
    for (const waiter of [...waiters]) waiter.resolve();
  });
  provider.on('authenticationFailed', () => {
    // `reason: 'auth'` makes the adapter stop retrying and report status `error`.
    authFailure = Object.assign(new Error('Link room tidak valid atau sudah dicabut.'), {
      reason: 'auth',
    });
    for (const waiter of [...waiters]) waiter.reject(authFailure);
    rejectReady(authFailure);
    options.onState?.('error', authFailure.message);
  });
  awareness.on('change', notifyPeers);

  provider.attach();
  const sync: SyncAttachment = attachSync(board, adapter);
  notifyPeers();

  return {
    adapter,
    ready,
    peers,
    destroy() {
      awareness.off('change', notifyPeers);
      for (const waiter of [...waiters]) waiter.reject(new Error('Koneksi ditutup'));
      sync.disconnect();
      provider.destroy();
      socket.destroy();
      adapter.destroy?.();
      awareness.destroy();
      doc.destroy();
    },
  };
}
