/**
 * Per-tab identity for the realtime scenario: every browser tab is one collaborator.
 *
 * The identity lives in `sessionStorage`, which is per tab and survives a reload, so reloading a
 * tab keeps its user while a new tab gets a new one. "Duplicate tab" copies `sessionStorage`; a
 * `BroadcastChannel` handshake detects the copy and gives the newer tab a fresh identity.
 */
import type { PresenceUser } from '@kujam/core';

const NAMES = [
  'Adi',
  'Bunga',
  'Cahya',
  'Dewi',
  'Eko',
  'Fajar',
  'Gita',
  'Hana',
  'Indra',
  'Joko',
  'Kirana',
  'Lestari',
  'Made',
  'Nadia',
  'Oka',
  'Putri',
  'Rangga',
  'Sari',
  'Tegar',
  'Wulan',
];

/** Distinct, saturated cursor colors that read on light and dark boards. */
const COLORS = [
  '#e11d48',
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
];

const STORAGE_KEY = 'kujam-realtime-user';
const CHANNEL = 'kujam-realtime-users';
/** How long a new tab waits for another tab to report that its identity is taken. */
const CLAIM_WAIT_MS = 150;

/** Creates a random user; `random` returns values in `[0, 1)`. */
export function randomUser(random: () => number = Math.random): PresenceUser {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const suffix = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  const name = pick(NAMES);
  return { id: `${name.toLowerCase()}-${suffix}`, name, color: pick(COLORS) };
}

/** Parses a stored user, or `null` when it is missing or malformed. */
export function parseUser(raw: string | null): PresenceUser | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PresenceUser>;
    if (typeof value.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.id)) return null;
    if (typeof value.name !== 'string' || value.name.length === 0 || value.name.length > 64)
      return null;
    if (typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color)) return null;
    return { id: value.id, name: value.name, color: value.color };
  } catch {
    return null;
  }
}

/**
 * Mock token of the example server (`mock:<id>:<role>:<name>`). Colons in the name would split
 * the token, so they are removed.
 */
export function mockToken(user: PresenceUser, readOnly: boolean): string {
  return `mock:${user.id}:${readOnly ? 'viewer' : 'editor'}:${user.name.replace(/:/g, '')}`;
}

type Message = { type: 'claim'; id: string } | { type: 'taken'; id: string };

/** Identity of this tab, with a way to give it up when the scenario unmounts. */
export interface TabIdentity {
  readonly user: PresenceUser;
  /** Whether the stored identity was replaced because another tab already used it. */
  readonly replaced: boolean;
  release(): void;
}

/**
 * Resolves this tab's user: the stored one, unless another open tab already uses it (a duplicated
 * tab), in which case a new user is created and stored. Keeps answering other tabs' claims until
 * {@link TabIdentity.release}.
 */
export async function claimTabIdentity(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSessionStorage(),
  createChannel: (() => BroadcastChannel | null) | null = defaultChannel,
): Promise<TabIdentity> {
  let user = parseUser(read(storage));
  let replaced = false;
  const channel = createChannel?.() ?? null;

  if (user && channel) {
    const taken = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        channel.removeEventListener('message', onMessage);
        resolve(false);
      }, CLAIM_WAIT_MS);
      function onMessage(event: MessageEvent<Message>): void {
        if (event.data?.type !== 'taken' || event.data.id !== user!.id) return;
        clearTimeout(timer);
        channel!.removeEventListener('message', onMessage);
        resolve(true);
      }
      channel.addEventListener('message', onMessage);
      channel.postMessage({ type: 'claim', id: user!.id } satisfies Message);
    });
    if (taken) {
      user = null;
      replaced = true;
    }
  }

  user ??= randomUser();
  write(storage, JSON.stringify(user));

  const current = user;
  const answer = (event: MessageEvent<Message>): void => {
    if (event.data?.type === 'claim' && event.data.id === current.id) {
      channel!.postMessage({ type: 'taken', id: current.id } satisfies Message);
    }
  };
  channel?.addEventListener('message', answer);

  return {
    user: current,
    replaced,
    release() {
      channel?.removeEventListener('message', answer);
      channel?.close();
    },
  };
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function defaultChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
}

function read(storage: Pick<Storage, 'getItem'> | null): string | null {
  try {
    return storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Pick<Storage, 'setItem'> | null, value: string): void {
  try {
    storage?.setItem(STORAGE_KEY, value);
  } catch {
    // Private mode or blocked storage: the identity lasts until the tab reloads.
  }
}
