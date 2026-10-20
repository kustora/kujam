/**
 * Presence and collaboration bar custom element `<kujam-presence-bar>` (BOARD-1407).
 *
 * Displays:
 * - Active collaborator avatars from presence peers with follow-camera click toggles.
 * - Reactive synchronization connection status indicators (offline, connecting, synced, error)
 *   with translatable status labels.
 */

import type { Board, PresenceApi, PresencePeerState, SyncAdapter, SyncStatus } from '@kujam/core';
import { createElementClass, type KujamUiElement, type UiWindow } from './base.js';
import { t } from './i18n.js';

/**
 * Presence and collaboration bar custom element interface (BOARD-1407).
 *
 * @public
 */
export interface PresenceBarElement extends KujamUiElement {
  /** Forces an immediate refresh of collaborator avatars and connection status. */
  update(): void;
}

/**
 * Computes initials for display from a collaborator name.
 * For example:
 * - "Alice" -> "A"
 * - "Alice Bob" -> "AB"
 * - "Alice Bob Charlie" -> "AC"
 *
 * @internal
 */
export function getInitials(name?: string): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    return (first.charAt(0) + (last ? last.charAt(0) : '')).toUpperCase();
  }
  return first.charAt(0).toUpperCase();
}

/**
 * Calculates a readable text color (white or dark) based on background hex luminance.
 *
 * @internal
 */
export function getContrastColor(hexColor?: string): string {
  if (!hexColor || !hexColor.startsWith('#')) return '#FFFFFF';
  const hex = hexColor.replace('#', '');
  if (hex.length !== 3 && hex.length !== 6) return '#FFFFFF';
  const isShort = hex.length === 3;
  const rStr = isShort ? (hex[0] ?? '') + (hex[0] ?? '') : hex.slice(0, 2);
  const gStr = isShort ? (hex[1] ?? '') + (hex[1] ?? '') : hex.slice(1, 3);
  const bStr = isShort ? (hex[2] ?? '') + (hex[2] ?? '') : hex.slice(2, 4);
  const r = parseInt(rStr, 16);
  const g = parseInt(gStr, 16);
  const b = parseInt(bStr, 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#17191E' : '#FFFFFF';
}

/**
 * Translates synchronization connection status to a human-readable localized label.
 *
 * @internal
 */
export function translateStatus(status: string, board: Board): string {
  try {
    const key = `sync.status.${status}`;
    if (typeof board.t === 'function') {
      const translated = t(key, board);
      if (translated && translated !== key) return translated;
    }
  } catch {
    // Fall back to default English string if translation fails
  }
  const defaults: Record<string, string> = {
    offline: 'Offline',
    connecting: 'Connecting...',
    synced: 'Synced',
    error: 'Connection error',
  };
  return defaults[status] ?? (status.charAt(0).toUpperCase() + status.slice(1));
}

function getSyncAdapter(board: Board): SyncAdapter | undefined {
  return (board as unknown as { sync?: SyncAdapter }).sync;
}

function getPresenceApi(board: Board): PresenceApi | undefined {
  const sync = getSyncAdapter(board);
  return sync?.presence ?? board.presence;
}

function getPeerEntries(presence?: PresenceApi | null): [string, PresencePeerState][] {
  if (!presence || !presence.peers) return [];
  const { peers } = presence;
  if (peers instanceof Map || typeof (peers as Map<string, PresencePeerState>).entries === 'function') {
    return Array.from(peers.entries());
  }
  if (Array.isArray(peers)) {
    return peers;
  }
  if (typeof peers === 'object') {
    return Object.entries(peers);
  }
  return [];
}

const PRESENCE_BAR_CSS = `
  :host {
    display: inline-flex;
    user-select: none;
    font: var(--kujam-ui-font);
  }
  .presence-bar {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--kujam-ui-surface);
    border: 1px solid var(--kujam-ui-border);
    border-radius: var(--kujam-ui-radius-lg);
    box-shadow: var(--kujam-ui-shadow-float);
    color: var(--kujam-ui-ink);
    box-sizing: border-box;
  }
  .status-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    line-height: 16px;
    color: var(--kujam-ui-ink-muted);
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background-color: var(--kujam-ui-ink-disabled, #8A8F99);
  }
  .status-dot.offline,
  .status-dot-offline {
    background-color: var(--kujam-ui-ink-disabled, #8A8F99);
  }
  .status-dot.connecting,
  .status-dot-connecting {
    background-color: #F59E0B;
    animation: kujam-pulse 1.5s infinite ease-in-out;
  }
  .status-dot.synced,
  .status-dot-synced {
    background-color: #10B981;
  }
  .status-dot.error,
  .status-dot-error {
    background-color: #EF4444;
  }
  @keyframes kujam-pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.4;
      transform: scale(0.85);
    }
  }
  .status-label {
    font-size: 12px;
    line-height: 16px;
    white-space: nowrap;
  }
  .separator {
    width: 1px;
    height: 16px;
    background-color: var(--kujam-ui-border);
  }
  .separator[hidden] {
    display: none !important;
  }
  .avatar-list {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .avatar-item {
    position: relative;
    display: inline-flex;
  }
  .avatar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--kujam-ui-surface);
    background-color: var(--kujam-ui-surface-hover);
    color: #FFFFFF;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    text-align: center;
    cursor: pointer;
    padding: 0;
    position: relative;
    box-shadow: 0 0 0 1px var(--kujam-ui-border);
    transition: transform var(--kujam-ui-motion), box-shadow var(--kujam-ui-motion);
    box-sizing: border-box;
  }
  .avatar-btn:hover {
    transform: scale(1.08);
    z-index: 2;
  }
  .avatar-btn.following {
    box-shadow: 0 0 0 2px var(--kujam-ui-surface), 0 0 0 4px var(--kujam-ui-focus-ring);
    transform: scale(1.08);
    z-index: 3;
  }
  .following-badge {
    position: absolute;
    bottom: -1px;
    right: -1px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--kujam-ui-focus-ring);
    border: 2px solid var(--kujam-ui-surface);
    pointer-events: none;
    box-sizing: border-box;
  }
  .avatar-img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }
  .tip {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    border-radius: var(--kujam-ui-radius-md);
    background: var(--kujam-ui-surface-inverse);
    color: var(--kujam-ui-on-inverse);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    font-size: 11px;
    line-height: 14px;
    font-weight: 500;
    transition: opacity var(--kujam-ui-motion);
    z-index: 10;
  }
  .avatar-btn:hover + .tip,
  .avatar-btn:focus-visible + .tip {
    opacity: 1;
  }
`;

function renderPresenceBar(root: ShadowRoot, board: Board, host: HTMLElement): () => void {
  const doc = host.ownerDocument;

  const bar = doc.createElement('div');
  bar.className = 'presence-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Presence and connection status');

  const statusContainer = doc.createElement('div');
  statusContainer.className = 'status-indicator';
  statusContainer.setAttribute('role', 'status');
  statusContainer.setAttribute('aria-live', 'polite');

  const statusDot = doc.createElement('span');
  statusDot.className = 'status-dot';

  const statusLabel = doc.createElement('span');
  statusLabel.className = 'status-label';

  statusContainer.append(statusDot, statusLabel);

  const separator = doc.createElement('div');
  separator.className = 'separator';
  separator.hidden = true;

  const avatarList = doc.createElement('div');
  avatarList.className = 'avatar-list';
  avatarList.setAttribute('role', 'group');
  avatarList.setAttribute('aria-label', 'Collaborators');

  bar.append(statusContainer, separator, avatarList);
  root.append(bar);

  let unbindSync: (() => void) | null = null;
  let unbindPresence: (() => void) | null = null;
  let currentBoundSync: SyncAdapter | undefined;
  let currentBoundPresence: PresenceApi | undefined;

  function renderStatus(statusOverride?: SyncStatus): void {
    const sync = getSyncAdapter(board);
    const status: SyncStatus = statusOverride ?? sync?.status ?? 'offline';

    statusDot.className = `status-dot ${status} status-dot-${status}`;
    statusContainer.className = `status-indicator status-${status}`;
    statusContainer.dataset.status = status;

    const labelText = translateStatus(status, board);
    statusLabel.textContent = labelText;
    statusContainer.setAttribute('aria-label', labelText);
  }

  function getFollowingUserId(): string | null {
    const cam = board.camera as unknown as { followingUserId?: string | null; following?: string | null };
    return cam.followingUserId ?? cam.following ?? null;
  }

  function renderPeers(): void {
    const presence = getPresenceApi(board);
    const peerEntries = getPeerEntries(presence);
    const followingId = getFollowingUserId();

    if (peerEntries.length === 0) {
      separator.hidden = true;
      avatarList.replaceChildren();
      return;
    }

    separator.hidden = false;

    // Check existing items for in-place updates
    const existingItems = Array.from(avatarList.querySelectorAll<HTMLElement>('.avatar-item'));
    const existingPeerIds = existingItems.map((item) => {
      const b = item.querySelector<HTMLButtonElement>('.avatar-btn');
      return b?.dataset.peerId;
    });

    const newPeerIds = peerEntries.map(([peerId]) => peerId);

    const canUpdateInPlace =
      existingItems.length === peerEntries.length &&
      existingPeerIds.every((id, idx) => id === newPeerIds[idx]);

    if (canUpdateInPlace) {
      for (let i = 0; i < peerEntries.length; i++) {
        const entry = peerEntries[i];
        const item = existingItems[i];
        if (!entry || !item) continue;
        const [peerId, peerState] = entry;
        const user = peerState.user ?? { id: peerId, name: peerId, color: '#4A4F59' };
        const userId = user.id ?? peerId;
        const isFollowing = followingId !== null && (followingId === peerId || followingId === userId);

        const btn = item.querySelector<HTMLButtonElement>('.avatar-btn');
        if (!btn) continue;

        btn.dataset.userId = userId;
        btn.classList.toggle('following', isFollowing);
        if (isFollowing) {
          btn.dataset.following = 'true';
          btn.setAttribute('aria-pressed', 'true');
        } else {
          delete btn.dataset.following;
          btn.removeAttribute('data-following');
          btn.setAttribute('aria-pressed', 'false');
        }

        let badge = btn.querySelector('.following-badge');
        if (isFollowing && !badge) {
          badge = doc.createElement('span');
          badge.className = 'following-badge';
          badge.setAttribute('aria-hidden', 'true');
          btn.append(badge);
        } else if (!isFollowing && badge) {
          badge.remove();
        }

        btn.title = user.name;
        btn.setAttribute('aria-label', user.name);

        const tip = item.querySelector('.tip');
        if (tip) tip.textContent = user.name;
      }
      return;
    }

    avatarList.replaceChildren();

    for (const [peerId, peerState] of peerEntries) {
      const user = peerState.user ?? { id: peerId, name: peerId, color: '#4A4F59' };
      const userId = user.id ?? peerId;
      const isFollowing = followingId !== null && (followingId === peerId || followingId === userId);

      const item = doc.createElement('div');
      item.className = 'avatar-item';

      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = isFollowing ? 'avatar-btn following' : 'avatar-btn';
      btn.dataset.peerId = peerId;
      btn.dataset.userId = userId;
      if (isFollowing) {
        btn.dataset.following = 'true';
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.setAttribute('aria-pressed', 'false');
      }

      btn.title = user.name;
      btn.setAttribute('aria-label', user.name);
      btn.style.backgroundColor = user.color ?? 'var(--kujam-ui-surface-inverse)';
      btn.style.color = getContrastColor(user.color);

      if (user.avatar) {
        const img = doc.createElement('img');
        img.className = 'avatar-img';
        img.src = user.avatar;
        img.alt = user.name ?? 'Avatar';
        img.onerror = () => {
          img.remove();
          btn.textContent = getInitials(user.name);
          if (isFollowing) {
            const badge = doc.createElement('span');
            badge.className = 'following-badge';
            badge.setAttribute('aria-hidden', 'true');
            btn.append(badge);
          }
        };
        btn.append(img);
      } else {
        btn.textContent = getInitials(user.name);
      }

      if (isFollowing) {
        const badge = doc.createElement('span');
        badge.className = 'following-badge';
        badge.setAttribute('aria-hidden', 'true');
        btn.append(badge);
      }

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const currentFollowing = getFollowingUserId();
        const currentlyFollowingThisPeer =
          currentFollowing !== null && (currentFollowing === peerId || currentFollowing === userId);

        if (currentlyFollowingThisPeer) {
          if (typeof board.camera.unfollow === 'function') {
            board.camera.unfollow();
          } else if (typeof board.camera.follow === 'function') {
            board.camera.follow(null);
          }
        } else {
          if (typeof board.camera.follow === 'function') {
            board.camera.follow(userId);
          }
        }
      });

      const tip = doc.createElement('span');
      tip.className = 'tip';
      tip.setAttribute('aria-hidden', 'true');
      tip.textContent = user.name;

      item.append(btn, tip);
      avatarList.append(item);
    }
  }

  function bindSync(): void {
    const sync = getSyncAdapter(board);
    if (sync === currentBoundSync) return;

    if (unbindSync) {
      unbindSync();
      unbindSync = null;
    }
    currentBoundSync = sync;

    if (!sync) return;

    const cleanups: (() => void)[] = [];
    if (typeof sync.on === 'function') {
      cleanups.push(
        sync.on('status', (status: SyncStatus) => {
          renderStatus(status);
        }),
      );
      cleanups.push(
        sync.on('peer-join', () => {
          renderPeers();
        }),
      );
      cleanups.push(
        sync.on('peer-leave', () => {
          renderPeers();
        }),
      );
    }
    unbindSync = () => {
      for (const fn of cleanups) fn();
    };
  }

  function bindPresence(): void {
    const presence = getPresenceApi(board);
    if (presence === currentBoundPresence) return;

    if (unbindPresence) {
      unbindPresence();
      unbindPresence = null;
    }
    currentBoundPresence = presence;

    if (!presence) return;

    const cleanups: (() => void)[] = [];
    if (typeof presence.on === 'function') {
      cleanups.push(
        presence.on('change', () => {
          renderPeers();
        }),
      );
      cleanups.push(
        presence.on('peer-join', () => {
          renderPeers();
        }),
      );
      cleanups.push(
        presence.on('peer-leave', () => {
          renderPeers();
        }),
      );
    }
    unbindPresence = () => {
      for (const fn of cleanups) fn();
    };
  }

  function updateAll(): void {
    bindSync();
    bindPresence();
    renderStatus();
    renderPeers();
  }

  // Initial render & bindings
  updateAll();

  const offCameraFollow = board.on('camera-follow', () => renderPeers());
  const offFollow = board.on('follow', () => renderPeers());
  const offCamera = board.on('camera', () => renderPeers());

  // Attach update method to element host
  const presenceEl = host as unknown as PresenceBarElement;
  presenceEl.update = () => updateAll();

  return () => {
    if (unbindSync) {
      unbindSync();
      unbindSync = null;
    }
    if (unbindPresence) {
      unbindPresence();
      unbindPresence = null;
    }
    offCameraFollow();
    offFollow();
    offCamera();
  };
}

/**
 * Creates the `<kujam-presence-bar>` custom element class for a window (BOARD-1407).
 *
 * @internal
 */
export function createPresenceBarClass(win: UiWindow): new () => KujamUiElement {
  return createElementClass(win, { css: PRESENCE_BAR_CSS, render: renderPresenceBar });
}
