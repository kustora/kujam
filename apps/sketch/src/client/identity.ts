/**
 * The local user: a random name and color on first visit, kept in `localStorage` and editable in
 * the share dialog. Other people see it on cursors and in the presence bar.
 */

import type { PresenceUser } from '@kujam/core';
import { cleanText, HEX_COLOR, MAX_USER_NAME, USER_ID } from '../shared/protocol.js';
import { storage } from './dom.js';

const KEY = 'kujam-sketch-user';

const ANIMALS = [
  'Rusa',
  'Kancil',
  'Elang',
  'Penyu',
  'Lumba',
  'Badak',
  'Merak',
  'Musang',
  'Tarsius',
  'Komodo',
  'Cendrawasih',
  'Anoa',
];
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

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

function randomUser(): PresenceUser {
  const id = `u-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`.slice(0, 40);
  return { id, name: `${pick(ANIMALS)} Anonim`, color: pick(COLORS) };
}

function parse(raw: string | null): PresenceUser | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PresenceUser>;
    const name = cleanText(value.name, MAX_USER_NAME);
    if (typeof value.id !== 'string' || !USER_ID.test(value.id) || !name) return null;
    if (typeof value.color !== 'string' || !HEX_COLOR.test(value.color)) return null;
    return { id: value.id, name, color: value.color };
  } catch {
    return null;
  }
}

export function loadUser(): PresenceUser {
  const stored = parse(storage.get(KEY));
  if (stored) return stored;
  const user = randomUser();
  storage.set(KEY, JSON.stringify(user));
  return user;
}

/** Saves a new display name; returns the updated user, or `null` for an empty name. */
export function renameUser(user: PresenceUser, name: string): PresenceUser | null {
  const clean = cleanText(name, MAX_USER_NAME);
  if (!clean) return null;
  const next = { ...user, name: clean };
  storage.set(KEY, JSON.stringify(next));
  return next;
}
