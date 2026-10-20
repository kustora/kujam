// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  createMemorySyncAdapter,
  createMemorySyncBus,
  definePlugin,
  defineTool,
  type Board,
  type PresencePeerState,
  type PresenceUser,
  type SyncAdapter,
  type SyncStatus,
} from '@kujam/core';
import {
  defineUiElements,
  mountDefaultUi,
  UI_TAGS,
} from './index.js';
import {
  getContrastColor,
  getInitials,
  translateStatus,
  type PresenceBarElement,
} from './presence-bar.js';

const dummyTool = definePlugin({
  id: 'test-tools',
  tools: [defineTool({ id: 'select', initial: 'idle', states: { idle: {} } })],
});

let boards: Board[] = [];

afterEach(() => {
  for (const board of boards) {
    if (!board.disposed) board.dispose();
  }
  boards = [];
  document.body.innerHTML = '';
});

function makeBoard(locale: 'id' | 'en' = 'id'): Board {
  const board = createBoard({ plugins: [dummyTool], locale });
  boards.push(board);
  return board;
}

function mountPresenceBar(board: Board): PresenceBarElement {
  defineUiElements();
  const el = document.createElement(UI_TAGS.presence) as PresenceBarElement;
  el.board = board;
  document.body.append(el);
  return el;
}

describe('BOARD-1407: getInitials and getContrastColor helpers', () => {
  it('computes initials correctly for single and multi-word names', () => {
    expect(getInitials('')).toBe('?');
    expect(getInitials('   ')).toBe('?');
    expect(getInitials('Alice')).toBe('A');
    expect(getInitials('alice')).toBe('A');
    expect(getInitials('Bob Builder')).toBe('BB');
    expect(getInitials('Charlie David Evans')).toBe('CE');
    expect(getInitials('  First   Last  ')).toBe('FL');
  });

  it('determines contrasting text color for backgrounds', () => {
    expect(getContrastColor('#000000')).toBe('#FFFFFF');
    expect(getContrastColor('#17191E')).toBe('#FFFFFF');
    expect(getContrastColor('#FFFFFF')).toBe('#17191E');
    expect(getContrastColor('#FFFF00')).toBe('#17191E');
    expect(getContrastColor(undefined)).toBe('#FFFFFF');
  });

  it('translates status with fallback', () => {
    const board = makeBoard('id');
    expect(translateStatus('offline', board)).toBe('Offline');
    expect(translateStatus('synced', board)).toBe('Tersinkron');
    expect(translateStatus('connecting', board)).toBe('Menyambungkan...');
    expect(translateStatus('error', board)).toBe('Gagal tersambung');

    const enBoard = makeBoard('en');
    expect(translateStatus('synced', enBoard)).toBe('Synced');
    expect(translateStatus('connecting', enBoard)).toBe('Connecting...');
    expect(translateStatus('error', enBoard)).toBe('Connection error');
  });
});

describe('BOARD-1407: Presence Bar Component (<kujam-presence-bar>)', () => {
  it('registers in customElements and renders offline indicator by default', () => {
    const board = makeBoard();
    const el = mountPresenceBar(board);

    const shadow = el.shadowRoot!;
    const statusDot = shadow.querySelector('.status-dot')!;
    const statusLabel = shadow.querySelector('.status-label')!;

    expect(statusDot.classList.contains('offline')).toBe(true);
    expect(statusLabel.textContent).toBe('Offline');
  });

  it('reflects reactive sync connection status transitions', () => {
    const board = makeBoard('id');
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    let currentStatus: SyncStatus = 'connecting';
    const mockSync: Partial<SyncAdapter> = {
      get status() {
        return currentStatus;
      },
      on(event, listener) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(listener as (...args: unknown[]) => void);
        return () => {
          listeners[event] = listeners[event].filter((l) => l !== listener);
        };
      },
    };

    (board as unknown as { sync: Partial<SyncAdapter> }).sync = mockSync;
    const el = mountPresenceBar(board);

    const shadow = el.shadowRoot!;
    const statusDot = shadow.querySelector('.status-dot')!;
    const statusLabel = shadow.querySelector('.status-label')!;

    // Initial connecting state
    expect(statusDot.classList.contains('connecting')).toBe(true);
    expect(statusLabel.textContent).toBe('Menyambungkan...');

    // Transition to synced
    currentStatus = 'synced';
    listeners['status']?.forEach((cb) => cb('synced'));
    expect(statusDot.classList.contains('synced')).toBe(true);
    expect(statusLabel.textContent).toBe('Tersinkron');

    // Transition to error
    currentStatus = 'error';
    listeners['status']?.forEach((cb) => cb('error'));
    expect(statusDot.classList.contains('error')).toBe(true);
    expect(statusLabel.textContent).toBe('Gagal tersambung');

    // Transition to offline
    currentStatus = 'offline';
    listeners['status']?.forEach((cb) => cb('offline'));
    expect(statusDot.classList.contains('offline')).toBe(true);
    expect(statusLabel.textContent).toBe('Offline');
  });

  it('renders active collaborator avatars with colors, initials, and images', () => {
    const board = makeBoard();
    const peersMap = new Map<string, PresencePeerState>();

    peersMap.set('peer-1', {
      user: {
        id: 'u-1',
        name: 'Alice Johnson',
        color: '#E11D48',
      },
    });

    peersMap.set('peer-2', {
      user: {
        id: 'u-2',
        name: 'Bob Smith',
        color: '#2563EB',
        avatar: 'https://example.com/avatar-bob.png',
      },
    });

    (board as unknown as { sync?: { presence: { peers: Map<string, PresencePeerState> } } }).sync = {
      presence: { peers: peersMap },
    };

    const el = mountPresenceBar(board);
    const shadow = el.shadowRoot!;

    const avatarButtons = shadow.querySelectorAll<HTMLButtonElement>('.avatar-btn');
    expect(avatarButtons.length).toBe(2);

    // First avatar: initials AJ
    const firstAvatar = avatarButtons[0];
    expect(firstAvatar.textContent?.trim()).toBe('AJ');
    expect(firstAvatar.title).toBe('Alice Johnson');
    expect(firstAvatar.getAttribute('aria-label')).toBe('Alice Johnson');
    expect(firstAvatar.dataset.userId).toBe('u-1');

    // Second avatar: contains img
    const secondAvatar = avatarButtons[1];
    const img = secondAvatar.querySelector<HTMLImageElement>('img.avatar-img')!;
    expect(img).not.toBeNull();
    expect(img.src).toBe('https://example.com/avatar-bob.png');
    expect(secondAvatar.title).toBe('Bob Smith');
    expect(secondAvatar.getAttribute('aria-label')).toBe('Bob Smith');
    expect(secondAvatar.dataset.userId).toBe('u-2');
  });

  it('supports image load error fallback to initials', () => {
    const board = makeBoard();
    const peersMap = new Map<string, PresencePeerState>();

    peersMap.set('peer-1', {
      user: {
        id: 'u-1',
        name: 'Charlie Brown',
        color: '#10B981',
        avatar: 'https://example.com/broken.png',
      },
    });

    (board as unknown as { sync?: { presence: { peers: Map<string, PresencePeerState> } } }).sync = {
      presence: { peers: peersMap },
    };

    const el = mountPresenceBar(board);
    const shadow = el.shadowRoot!;

    const avatar = shadow.querySelector<HTMLButtonElement>('.avatar-btn')!;
    const img = avatar.querySelector<HTMLImageElement>('img.avatar-img')!;
    expect(img).not.toBeNull();

    // Trigger image error
    img.dispatchEvent(new Event('error'));

    // Image removed, replaced with initials
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar.textContent?.trim()).toBe('CB');
  });

  it('clicking an avatar follows the collaborator, and clicking again unfollows', () => {
    const board = makeBoard();
    const peersMap = new Map<string, PresencePeerState>();

    peersMap.set('peer-1', {
      user: {
        id: 'user-alice',
        name: 'Alice',
        color: '#F59E0B',
      },
    });

    (board as unknown as { sync?: { presence: { peers: Map<string, PresencePeerState> } } }).sync = {
      presence: { peers: peersMap },
    };

    const el = mountPresenceBar(board);
    const shadow = el.shadowRoot!;

    const avatar = shadow.querySelector<HTMLButtonElement>('.avatar-btn')!;
    expect(avatar.classList.contains('following')).toBe(false);

    // Spy on camera follow and unfollow
    const followSpy = vi.spyOn(board.camera, 'follow');
    const unfollowSpy = vi.spyOn(board.camera, 'unfollow');

    // First click: follow user-alice
    avatar.click();
    expect(followSpy).toHaveBeenCalledWith('user-alice');
    expect(board.camera.following).toBe('user-alice');

    // UI updates with following active state
    expect(avatar.classList.contains('following')).toBe(true);
    expect(avatar.dataset.following).toBe('true');
    expect(avatar.getAttribute('aria-pressed')).toBe('true');
    expect(avatar.querySelector('.following-badge')).not.toBeNull();

    // Second click: unfollow
    avatar.click();
    expect(unfollowSpy).toHaveBeenCalled();
    expect(board.camera.following).toBeNull();

    // UI removes following active state
    expect(avatar.classList.contains('following')).toBe(false);
    expect(avatar.hasAttribute('data-following')).toBe(false);
    expect(avatar.getAttribute('aria-pressed')).toBe('false');
    expect(avatar.querySelector('.following-badge')).toBeNull();
  });

  it('reacts to external camera follow and unfollow changes', () => {
    const board = makeBoard();
    const peersMap = new Map<string, PresencePeerState>();

    peersMap.set('peer-x', {
      user: {
        id: 'user-x',
        name: 'Xavier',
        color: '#8B5CF6',
      },
    });

    (board as unknown as { sync?: { presence: { peers: Map<string, PresencePeerState> } } }).sync = {
      presence: { peers: peersMap },
    };

    const el = mountPresenceBar(board);
    const shadow = el.shadowRoot!;
    const avatar = shadow.querySelector<HTMLButtonElement>('.avatar-btn')!;

    expect(avatar.classList.contains('following')).toBe(false);

    // External follow
    board.camera.follow('user-x');
    expect(avatar.classList.contains('following')).toBe(true);

    // External unfollow
    board.camera.unfollow();
    expect(avatar.classList.contains('following')).toBe(false);
  });

  it('works with in-memory sync adapter peers', () => {
    const board = makeBoard();
    const bus = createMemorySyncBus();

    const user1: PresenceUser = { id: 'u-self', name: 'Self', color: '#10B981' };
    const user2: PresenceUser = { id: 'u-peer', name: 'Collaborator Two', color: '#3B82F6' };

    const adapter1 = createMemorySyncAdapter({ bus, channel: 'presence-test', user: user1 });
    const adapter2 = createMemorySyncAdapter({ bus, channel: 'presence-test', user: user2 });

    (board as unknown as { sync: SyncAdapter }).sync = adapter1;
    const el = mountPresenceBar(board);

    // Initially no remote peers
    expect(el.shadowRoot!.querySelectorAll('.avatar-btn').length).toBe(0);

    // Connect remote collaborator via bus
    adapter1.connect(board);
    const dummyRemoteBoard = makeBoard();
    adapter2.connect(dummyRemoteBoard);

    // Collaborator Two is now active in adapter1.presence.peers
    el.update();

    const avatars = el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.avatar-btn');
    expect(avatars.length).toBe(1);
    expect(avatars[0].title).toBe('Collaborator Two');
    expect(avatars[0].textContent?.trim()).toBe('CT');

    // Clean up
    adapter1.disconnect();
    adapter2.disconnect();
  });

  it('is integrated into mountDefaultUi at top right', () => {
    const board = makeBoard();
    const container = document.createElement('div');
    document.body.append(container);

    const ui = mountDefaultUi({ board, container });

    expect(ui.presence).toBeDefined();
    expect(ui.presence.tagName.toLowerCase()).toBe('kujam-presence-bar');
    expect(ui.presence.style.top).toBe('20px');
    expect(ui.presence.style.right).toBe('20px');

    ui.unmount();
    expect(container.querySelector('kujam-presence-bar')).toBeNull();
  });

  it('reads peers directly from board.presence when sync is undefined', () => {
    const board = makeBoard();
    const peersMap = new Map<string, PresencePeerState>();
    peersMap.set('peer-standalone', {
      user: {
        id: 'u-standalone',
        name: 'Standalone Peer',
        color: '#6366F1',
      },
    });

    Object.defineProperty(board, 'presence', {
      get: () => ({
        peers: peersMap,
        on: vi.fn(() => () => {}),
      }),
      configurable: true,
    });

    const el = mountPresenceBar(board);
    const avatars = el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.avatar-btn');
    expect(avatars.length).toBe(1);
    expect(avatars[0].title).toBe('Standalone Peer');
    expect(avatars[0].textContent?.trim()).toBe('SP');
  });

  it('handles peer join and leave events dynamically', () => {
    const board = makeBoard();
    const peersMap = new Map<string, PresencePeerState>();
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    const mockPresence = {
      peers: peersMap,
      on: (event: string, fn: (...args: unknown[]) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
        return () => {
          listeners[event] = listeners[event].filter((l) => l !== fn);
        };
      },
    };

    (board as unknown as { sync?: { presence: unknown } }).sync = {
      presence: mockPresence,
    };

    const el = mountPresenceBar(board);
    expect(el.shadowRoot!.querySelectorAll('.avatar-btn').length).toBe(0);

    // Peer joins
    peersMap.set('p-1', {
      user: { id: 'u-1', name: 'Dan', color: '#10B981' },
    });
    listeners['peer-join']?.forEach((cb) => cb('p-1'));

    expect(el.shadowRoot!.querySelectorAll('.avatar-btn').length).toBe(1);
    expect(el.shadowRoot!.querySelector('.avatar-btn')!.textContent?.trim()).toBe('D');

    // Peer leaves
    peersMap.delete('p-1');
    listeners['peer-leave']?.forEach((cb) => cb('p-1'));
    expect(el.shadowRoot!.querySelectorAll('.avatar-btn').length).toBe(0);
  });

  it('handles unbinding when board is disconnected or set to null', () => {
    const board = makeBoard();
    const el = mountPresenceBar(board);

    expect(el.board).toBe(board);
    expect(el.shadowRoot!.querySelector('.presence-bar')).not.toBeNull();

    // Disconnect board
    el.board = null;
    expect(el.board).toBeNull();

    // Reassign new board
    const board2 = makeBoard();
    el.board = board2;
    expect(el.board).toBe(board2);
  });

  it('reflects board theme mode on host', () => {
    const board = makeBoard();
    const el = mountPresenceBar(board);

    expect(el.dataset.theme).toBe('light');

    board.setTheme('dark');
    expect(el.dataset.theme).toBe('dark');
  });
});
