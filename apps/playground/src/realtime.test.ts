import { describe, expect, it } from 'vitest';
import { claimTabIdentity, mockToken, parseUser, randomUser } from './realtime.js';

/** In-memory `sessionStorage` of one tab. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

let channelId = 0;
/** A fresh channel name per test, so tabs of different tests never talk to each other. */
function channelFactory() {
  const name = `kujam-realtime-test-${channelId++}`;
  return () => new BroadcastChannel(name);
}

describe('realtime tab identity', () => {
  it('creates valid random users with an id, name, and color', () => {
    const user = randomUser();
    expect(user.id).toMatch(/^[a-z]+-[a-z0-9]{4}$/);
    expect(user.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseUser(JSON.stringify(user))).toEqual(user);
  });

  it('rejects malformed stored users', () => {
    expect(parseUser(null)).toBeNull();
    expect(parseUser('{')).toBeNull();
    expect(parseUser(JSON.stringify({ id: 'Bad Id', name: 'A', color: '#000000' }))).toBeNull();
    expect(parseUser(JSON.stringify({ id: 'a', name: '', color: '#000000' }))).toBeNull();
    expect(parseUser(JSON.stringify({ id: 'a', name: 'A', color: 'red' }))).toBeNull();
  });

  it('builds the mock token of the example server', () => {
    const user = { id: 'sari-0abc', name: 'Sa:ri', color: '#000000' };
    expect(mockToken(user, false)).toBe('mock:sari-0abc:editor:Sari');
    expect(mockToken(user, true)).toBe('mock:sari-0abc:viewer:Sari');
  });

  it('keeps the stored user across a reload of the same tab', async () => {
    const storage = memoryStorage();
    const first = await claimTabIdentity(storage, channelFactory());
    first.release();
    const again = await claimTabIdentity(storage, channelFactory());
    again.release();

    expect(again.user).toEqual(first.user);
    expect(again.replaced).toBe(false);
  });

  it('gives two new tabs different users', async () => {
    const channel = channelFactory();
    const a = await claimTabIdentity(memoryStorage(), channel);
    const b = await claimTabIdentity(memoryStorage(), channel);

    expect(a.user.id).not.toBe(b.user.id);
    a.release();
    b.release();
  });

  it('gives a duplicated tab (copied sessionStorage) a new user', async () => {
    const channel = channelFactory();
    const original = memoryStorage();
    const a = await claimTabIdentity(original, channel);
    const copy = memoryStorage(Object.fromEntries(original.data));
    const b = await claimTabIdentity(copy, channel);

    expect(b.replaced).toBe(true);
    expect(b.user.id).not.toBe(a.user.id);
    expect(parseUser(copy.getItem('kujam-realtime-user'))).toEqual(b.user);
    a.release();
    b.release();
  });

  it('works without storage or BroadcastChannel', async () => {
    const identity = await claimTabIdentity(null, null);
    expect(identity.user.id).toBeTruthy();
    identity.release();
  });
});
