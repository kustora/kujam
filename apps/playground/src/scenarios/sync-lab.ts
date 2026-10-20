/**
 * Multi-peer sync lab (BOARD-2410): two or three boards side by side, each as a different user,
 * synced through `@kujam/sync-yjs`.
 *
 * Query:
 * - `peers=1|2|3`: number of boards (default 2).
 * - `peer=<n>`: index of the first user (0 = Alice, 1 = Budi, 2 = Citra). With `peers=1` and the
 *   Hocuspocus transport, separate browser windows can each be one user (BOARD-1514).
 * - `transport=memory|hocuspocus`: in-page network without a server (default), or a local
 *   Hocuspocus server from `examples/hocuspocus-server` (BOARD-1510).
 * - `server=<ws url>` and `room=<name>`: Hocuspocus address and document name.
 *
 * Per peer: artificial latency, offline, and (in-memory only) holding incoming updates to release
 * them later, in order or shuffled. The convergence bar compares a hash of every board's document
 * once all updates have been delivered. In test mode the peers are exposed as `window.__lab`.
 */

import {
  attachSync,
  createBoard,
  defaultCommands,
  type Board,
  type BoardErrorEvent,
  type PresenceUser,
  type SyncAttachment,
} from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { attachTextEditor, defaultElements, defaultTools } from '@kujam/shapes';
import { createYjsSyncAdapter, type YjsSyncAdapter } from '@kujam/sync-yjs';
import { mountDefaultUi } from '@kujam/ui';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import { append, h, section } from '../dom.js';
import { defineScenario } from '../scenario.js';
import {
  convergence,
  createDelayedWebSocket,
  createLabNetwork,
  documentHash,
  type Convergence,
  type DelayedSocketControl,
  type LabNetwork,
} from '../sync-lab.js';

const USERS: readonly PresenceUser[] = [
  { id: 'alice', name: 'Alice', color: '#e11d48' },
  { id: 'budi', name: 'Budi', color: '#2563eb' },
  { id: 'citra', name: 'Citra', color: '#16a34a' },
];

type Transport = 'memory' | 'hocuspocus';

const DEFAULT_SERVER = 'ws://127.0.0.1:1234';
const DEFAULT_ROOM = 'kujam-lab';
const SYNC_TIMEOUT_MS = 5000;

/** Network controls of one peer, implemented by each transport. */
interface PeerLink {
  readonly supportsHold: boolean;
  setLatency(ms: number): void;
  setOnline(online: boolean): void;
  setHeld(held: boolean): void;
  release(shuffle: boolean): void;
  stats(): {
    latencyMs: number;
    online: boolean;
    held: boolean;
    heldCount: number;
    inFlight: number;
    /** Whether everything this peer sent has been acknowledged (always true in memory). */
    synced: boolean;
  };
  destroy(): void;
}

interface LabPeer {
  readonly user: PresenceUser;
  readonly board: Board;
  readonly doc: Y.Doc;
  readonly adapter: YjsSyncAdapter;
  link: PeerLink;
  sync: SyncAttachment | null;
  readonly errors: BoardErrorEvent[];
  readonly view: ReturnType<typeof mountRenderer>;
  readonly teardown: () => void;
  readonly el: {
    hash: HTMLElement;
    status: HTMLElement;
    latencyLabel: HTMLElement;
    latency: HTMLInputElement;
    online: HTMLInputElement;
    hold: HTMLInputElement;
    release: HTMLButtonElement;
    shuffle: HTMLButtonElement;
    undo: HTMLButtonElement;
    redo: HTMLButtonElement;
  };
}

/** Lab handle exposed as `window.__lab` in test mode (BOARD-1514). */
export interface SyncLabHandle {
  readonly transport: Transport;
  readonly boards: readonly Board[];
  readonly users: readonly PresenceUser[];
  convergence(): Convergence;
  hashes(): string[];
  setLatency(index: number, ms: number): void;
  setOnline(index: number, online: boolean): void;
}

declare global {
  interface Window {
    __lab?: SyncLabHandle;
  }
}

/** Link used until the transport is connected: reports a peer that is not synced yet. */
function connectingLink(): PeerLink {
  return {
    supportsHold: false,
    setLatency() {},
    setOnline() {},
    setHeld() {},
    release() {},
    stats: () => ({
      latencyMs: 0,
      online: true,
      held: false,
      heldCount: 0,
      inFlight: 0,
      synced: false,
    }),
    destroy() {},
  };
}

function memoryLink(network: LabNetwork, id: string): PeerLink {
  return {
    supportsHold: true,
    setLatency: (ms) => network.setLatency(id, ms),
    setOnline: (online) => network.setOnline(id, online),
    setHeld: (held) => network.setHeld(id, held),
    release: (shuffle) => void network.release(id, { shuffle }),
    stats: () => ({ ...network.stats(id), synced: true }),
    destroy: () => network.leave(id),
  };
}

type ProviderModule = typeof import('@hocuspocus/provider');

/** Connects `doc` to a Hocuspocus server; resolves once the first sync finished. */
async function hocuspocusLink(
  mod: ProviderModule,
  options: { url: string; room: string; user: PresenceUser; doc: Y.Doc; awareness: Awareness },
  onChange: () => void,
): Promise<PeerLink> {
  const control: DelayedSocketControl = { latencyMs: 0, inFlight: 0, onChange };
  const socket = new mod.HocuspocusProviderWebsocket({
    url: options.url,
    WebSocketPolyfill: createDelayedWebSocket(control),
  });
  const provider = new mod.HocuspocusProvider({
    websocketProvider: socket,
    name: options.room,
    document: options.doc,
    awareness: options.awareness,
    token: `mock:${options.user.id}:editor:${options.user.name}`,
  });
  provider.attach();
  let online = true;
  for (const event of ['synced', 'unsyncedChanges', 'status', 'disconnect'] as const) {
    provider.on(event, onChange);
  }

  const link: PeerLink = {
    supportsHold: false,
    setLatency(ms) {
      control.latencyMs = ms;
      onChange();
    },
    setOnline(next) {
      if (online === next) return;
      online = next;
      if (next) void socket.connect();
      else socket.disconnect();
      onChange();
    },
    setHeld() {},
    release() {},
    stats: () => ({
      latencyMs: control.latencyMs,
      online,
      held: false,
      heldCount: 0,
      inFlight: control.inFlight,
      synced: provider.isSynced && provider.unsyncedChanges === 0,
    }),
    destroy() {
      provider.destroy();
      socket.destroy();
    },
  };

  await new Promise<void>((resolve, reject) => {
    if (provider.isSynced) return resolve();
    const timer = setTimeout(() => {
      reject(
        new Error(`Tidak tersambung ke ${options.url} dalam ${SYNC_TIMEOUT_MS / 1000} detik.`),
      );
    }, SYNC_TIMEOUT_MS);
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
      clearTimeout(timer);
      reject(new Error(`Autentikasi ditolak: ${reason}`));
    });
  }).catch((error: unknown) => {
    link.destroy();
    throw error;
  });
  return link;
}

const CONVERGENCE_TEXT: Record<Convergence, string> = {
  converged: 'Konvergen: semua dokumen sama',
  diverged: 'BERBEDA: semua update terkirim, tetapi dokumen tidak sama',
  pending: 'Menunggu: update masih di jalan atau ditahan',
  offline: 'Ada peer offline: konvergensi dinilai setelah tersambung lagi',
};
const CONVERGENCE_CLASS: Record<Convergence, string> = {
  converged: 'status ok',
  diverged: 'status error',
  pending: 'status warn',
  offline: 'status',
};

export default defineScenario({
  id: 'sync-lab',
  title: 'Lab sinkronisasi',
  description:
    'Dua atau tiga papan berdampingan sebagai pengguna berbeda: latensi, offline, tunda/acak update, konvergensi, dan undo per orang.',
  order: 60,
  layout: 'lab',
  mount({ main, controls, debug, state, expose }) {
    const testMode = new URL(location.href).searchParams.get('test') === '1';
    const transport: Transport = state.get('transport') === 'hocuspocus' ? 'hocuspocus' : 'memory';
    const count = Math.min(3, Math.max(1, Number(state.get('peers') ?? 2) || 2));
    const first = Math.min(USERS.length - 1, Math.max(0, Number(state.get('peer') ?? 0) || 0));
    const server = state.get('server') ?? DEFAULT_SERVER;
    const room = state.get('room') ?? DEFAULT_ROOM;
    const users = Array.from({ length: count }, (_, i) => USERS[(first + i) % USERS.length]!);

    const network = createLabNetwork();
    const peers: LabPeer[] = [];
    let disposed = false;

    // ---------- Layout ----------
    const banner = h('div', { class: 'status', dataset: { testid: 'convergence' } }, '…');
    const grid = h('div', {
      style: `display:grid;grid-template-columns:repeat(${count},minmax(0,1fr));gap:8px;flex:1;min-height:0`,
    });
    main.append(
      h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:8px;height:100%;padding:8px' },
        banner,
        grid,
      ),
    );

    // ---------- Refresh (coalesced to one per frame) ----------
    let frame = 0;
    function refresh(): void {
      if (frame || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        render();
      });
    }
    network.onChange(refresh);

    function currentConvergence(): Convergence {
      const stats = peers.map((p) => p.link.stats());
      const settled =
        network.idle && stats.every((s) => s.inFlight === 0 && s.heldCount === 0 && s.synced);
      return convergence(
        hashes(),
        settled,
        stats.every((s) => s.online),
      );
    }

    function hashes(): string[] {
      return peers.map((p) => documentHash(p.board.getDocument()));
    }

    const debugBody = h('tbody');
    const errorLog = h('ol', { class: 'muted', style: 'font-size:12px;padding-left:18px' });
    debug.append(
      section(
        'Peer',
        h(
          'table',
          { class: 'issues' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ...['Peer', 'clientID', 'Record', 'Y.Doc', 'Di jalan', 'Ditahan'].map((t) =>
                h('th', {}, t),
              ),
            ),
          ),
          debugBody,
        ),
      ),
      section('Error sinkronisasi', errorLog),
    );

    function render(): void {
      const state = currentConvergence();
      const peerHashes = hashes();
      banner.className = CONVERGENCE_CLASS[state];
      banner.dataset.state = state;
      banner.textContent =
        state === 'converged' && peerHashes[0]
          ? `${CONVERGENCE_TEXT[state]} (${peerHashes[0]})`
          : CONVERGENCE_TEXT[state];
      const differs = new Set(peerHashes).size > 1;

      debugBody.replaceChildren();
      peers.forEach((peer, i) => {
        const stats = peer.link.stats();
        const { el } = peer;
        el.hash.textContent = peerHashes[i]!;
        el.hash.style.color = differs && state === 'diverged' ? 'var(--error)' : 'var(--muted)';
        el.status.textContent = !stats.online
          ? 'offline'
          : stats.held
            ? `menahan ${stats.heldCount} update`
            : stats.inFlight > 0
              ? `${stats.inFlight} pesan di jalan`
              : 'online';
        el.latencyLabel.textContent = `Latensi ${stats.latencyMs} ms`;
        el.latency.value = String(stats.latencyMs);
        el.online.checked = stats.online;
        el.hold.checked = stats.held;
        el.release.disabled = stats.heldCount === 0;
        el.shuffle.disabled = stats.heldCount < 2;
        el.release.textContent = `Kirim tertunda (${stats.heldCount})`;
        el.undo.disabled = !peer.board.history.canUndo;
        el.redo.disabled = !peer.board.history.canRedo;

        debugBody.append(
          h(
            'tr',
            {},
            h('td', {}, peer.user.name),
            h('td', {}, String(peer.doc.clientID)),
            h('td', {}, String(Object.keys(peer.board.getDocument().records).length)),
            h('td', {}, `${Y.encodeStateAsUpdate(peer.doc).byteLength} B`),
            h('td', {}, String(stats.inFlight)),
            h('td', {}, String(stats.heldCount)),
          ),
        );
      });
      errorLog.replaceChildren(
        ...peers
          .flatMap((p) => p.errors.map((e) => `${p.user.name}: [${e.code}] ${e.message}`))
          .slice(-20)
          .map((text) => h('li', {}, text)),
      );
    }

    // ---------- Peers ----------
    function createPeer(user: PresenceUser): LabPeer {
      const doc = new Y.Doc();
      const awareness = new Awareness(doc);
      const board = createBoard({
        locale: 'id',
        plugins: [defaultCommands, defaultElements, defaultTools],
      });
      const adapter = createYjsSyncAdapter({
        doc,
        awareness,
        user,
        indexeddb: false,
        reconnect: false,
      });

      const container = h('div', {
        style: `position:relative;flex:1;min-height:0;border:2px solid ${user.color};border-radius:8px;overflow:hidden;background:#fff`,
        dataset: { testid: `board-${user.id}` },
      });
      const el = {
        hash: h('code', {
          style: 'font-size:12px;color:var(--muted)',
          dataset: { testid: `hash-${user.id}` },
        }),
        status: h('span', { class: 'muted', style: 'font-size:12px' }),
        latencyLabel: h('span', { style: 'font-size:12px;min-width:110px' }),
        latency: h('input', {
          type: 'range',
          min: '0',
          max: '2000',
          step: '50',
          value: '0',
          'aria-label': `Latensi ${user.name}`,
          oninput: () => peer.link.setLatency(Number(el.latency.value)),
        }),
        online: h('input', {
          type: 'checkbox',
          checked: true,
          'aria-label': `${user.name} online`,
          onchange: () => peer.link.setOnline(el.online.checked),
        }),
        hold: h('input', {
          type: 'checkbox',
          'aria-label': `Tahan update untuk ${user.name}`,
          onchange: () => peer.link.setHeld(el.hold.checked),
        }),
        release: h('button', { onclick: () => peer.link.release(false) }, 'Kirim tertunda'),
        shuffle: h('button', { onclick: () => peer.link.release(true) }, 'Kirim acak'),
        undo: h('button', { onclick: () => board.undo() }, 'Undo'),
        redo: h('button', { onclick: () => board.redo() }, 'Redo'),
      };

      const row = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
      grid.append(
        h(
          'div',
          { style: 'display:flex;flex-direction:column;gap:6px;min-width:0' },
          h(
            'div',
            { style: 'display:flex;gap:8px;align-items:center' },
            h('span', {
              style: `width:12px;height:12px;border-radius:50%;background:${user.color}`,
            }),
            h('strong', {}, user.name),
            el.status,
            h('span', { style: 'flex:1' }),
            el.hash,
          ),
          container,
          h(
            'div',
            { style: row },
            el.latencyLabel,
            el.latency,
            h('label', { style: 'font-size:12px' }, el.online, ' Online'),
          ),
          h(
            'div',
            { style: row },
            el.undo,
            el.redo,
            transport === 'memory'
              ? h('label', { style: 'font-size:12px;margin-left:8px' }, el.hold, ' Tahan update')
              : null,
            transport === 'memory' ? el.release : null,
            transport === 'memory' ? el.shuffle : null,
          ),
        ),
      );

      const view = mountRenderer(board, container, { background: 'dots' });
      const textEditor = attachTextEditor(view);
      const ui = mountDefaultUi({ board, container });
      // Narrow columns: keep the toolbar and presence bar; undo and redo sit below the board.
      ui.minimap.remove();
      ui.zoom.remove();
      ui.history.remove();
      board.setTool('select');

      const errors: BoardErrorEvent[] = [];
      const offError = board.on('error', (event) => {
        errors.push(event);
        refresh();
      });
      const offChange = board.on('change', refresh);

      const peer: LabPeer = {
        user,
        board,
        doc,
        adapter,
        link: connectingLink(),
        sync: null,
        errors,
        view,
        el,
        teardown: () => {
          offError();
          offChange();
          peer.sync?.disconnect();
          peer.link.destroy();
          ui.unmount();
          textEditor.detach();
          view.unmount();
          board.dispose();
          adapter.destroy?.();
          awareness.destroy();
          doc.destroy();
        },
      };
      return peer;
    }

    async function connect(peer: LabPeer, awareness: Awareness): Promise<void> {
      if (transport === 'memory') {
        network.join(peer.user.id, peer.doc, awareness);
        peer.link = memoryLink(network, peer.user.id);
      } else {
        const mod = await import('@hocuspocus/provider');
        if (disposed) return;
        peer.link = await hocuspocusLink(
          mod,
          { url: server, room, user: peer.user, doc: peer.doc, awareness },
          refresh,
        );
        if (disposed) {
          peer.link.destroy();
          return;
        }
      }
      peer.sync = attachSync(peer.board, peer.adapter);
    }

    for (const user of users) peers.push(createPeer(user));
    expose(peers[0]!.board);

    const connectStatus = h('p', { class: 'muted' });
    void Promise.all(peers.map((p) => connect(p, p.adapter.awareness)))
      .then(() => {
        connectStatus.textContent = '';
        refresh();
      })
      .catch((error: unknown) => {
        connectStatus.className = 'status error';
        connectStatus.textContent =
          `${error instanceof Error ? error.message : String(error)} ` +
          'Jalankan server dengan `pnpm --filter @kujam/example-hocuspocus-server dev`.';
      });

    if (testMode) {
      window.__lab = {
        transport,
        boards: peers.map((p) => p.board),
        users,
        convergence: currentConvergence,
        hashes,
        setLatency: (i, ms) => peers[i]!.link.setLatency(ms),
        setOnline: (i, online) => peers[i]!.link.setOnline(online),
      };
    }

    // ---------- Left panel ----------
    const transportSelect = h(
      'select',
      {
        'aria-label': 'Transport',
        onchange: () => {
          state.set('transport', transportSelect.value === 'memory' ? null : transportSelect.value);
          location.reload();
        },
      },
      h(
        'option',
        { value: 'memory', selected: transport === 'memory' },
        'In-memory (tanpa server)',
      ),
      h(
        'option',
        { value: 'hocuspocus', selected: transport === 'hocuspocus' },
        'Hocuspocus lokal',
      ),
    );
    const peersSelect = h(
      'select',
      {
        'aria-label': 'Jumlah peer',
        onchange: () => {
          state.set('peers', peersSelect.value === '2' ? null : peersSelect.value);
          location.reload();
        },
      },
      ...['1', '2', '3'].map((n) =>
        h('option', { value: n, selected: Number(n) === count }, `${n} peer`),
      ),
    );
    const serverInput = h('input', {
      value: server,
      'aria-label': 'URL server',
      class: 'code-input',
    });
    const roomInput = h('input', { value: room, 'aria-label': 'Nama room', class: 'code-input' });
    const all = (fn: (p: LabPeer) => void) => () => {
      for (const p of peers) fn(p);
    };

    append(
      controls,
      section('Transport', transportSelect, peersSelect, connectStatus),
      transport === 'hocuspocus'
        ? section(
            'Server Hocuspocus',
            serverInput,
            roomInput,
            h(
              'button',
              {
                onclick: () => {
                  state.set(
                    'server',
                    serverInput.value === DEFAULT_SERVER ? null : serverInput.value,
                  );
                  state.set('room', roomInput.value === DEFAULT_ROOM ? null : roomInput.value);
                  location.reload();
                },
              },
              'Sambung ulang',
            ),
            h(
              'p',
              { class: 'muted', style: 'font-size:12px' },
              'Token mock per pengguna (mock:<id>:editor:<nama>). Tunda/acak update hanya tersedia di transport in-memory.',
            ),
          )
        : null,
      section(
        'Semua peer',
        h(
          'div',
          { style: 'display:flex;gap:6px;flex-wrap:wrap' },
          h('button', { onclick: all((p) => p.link.setOnline(true)) }, 'Semua online'),
          h('button', { onclick: all((p) => p.link.setLatency(0)) }, 'Latensi 0'),
          transport === 'memory'
            ? h('button', { onclick: all((p) => p.link.setHeld(false)) }, 'Kirim semua tertunda')
            : null,
        ),
        h(
          'p',
          { class: 'muted', style: 'font-size:12px' },
          'Undo hanya membatalkan perubahan orang itu sendiri. Hash merah berarti dokumen berbeda setelah semua update terkirim.',
        ),
      ),
    );

    refresh();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (window.__lab?.boards[0] === peers[0]?.board) delete window.__lab;
      for (const peer of peers) peer.teardown();
      network.destroy();
    };
  },
});
