/** Room API client and the links this browser knows per room. */

import {
  roomHash,
  type ApiErrorResponse,
  type CreatedRoomResponse,
  type RoomInfoResponse,
} from '../shared/protocol.js';
import { storage } from './dom.js';

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error('Server tidak dapat dihubungi.');
  }
  const body = (await response.json().catch(() => null)) as T | ApiErrorResponse | null;
  if (!response.ok) {
    throw new Error(
      (body as ApiErrorResponse | null)?.error ?? `Permintaan gagal (${response.status}).`,
    );
  }
  return body as T;
}

export function createRoom(name: string): Promise<CreatedRoomResponse> {
  return call('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function getRoom(id: string, token: string): Promise<RoomInfoResponse> {
  return call(`/api/rooms/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Tokens of one room that this browser has seen (the creator knows both). */
export interface KnownLinks {
  edit?: string;
  view?: string;
}

const KEY = 'kujam-sketch-rooms';

function readAll(): Record<string, KnownLinks> {
  try {
    const value = JSON.parse(storage.get(KEY) ?? '{}') as unknown;
    return typeof value === 'object' && value !== null ? (value as Record<string, KnownLinks>) : {};
  } catch {
    return {};
  }
}

export function knownLinks(id: string): KnownLinks {
  return readAll()[id] ?? {};
}

export function rememberLinks(id: string, links: KnownLinks): void {
  const all = readAll();
  all[id] = { ...all[id], ...links };
  storage.set(KEY, JSON.stringify(all));
}

/** Absolute share URL for a room token. */
export function shareUrl(id: string, token: string): string {
  return `${location.origin}/${roomHash(id, token)}`;
}
