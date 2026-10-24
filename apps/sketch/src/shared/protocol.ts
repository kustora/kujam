/**
 * Shapes shared by the browser and the server: the room API and the WebSocket token.
 */

/** What a room token allows. */
export type RoomRole = 'edit' | 'view';

/** `POST /api/rooms` response: the tokens are shown only this once. */
export interface CreatedRoomResponse {
  readonly id: string;
  readonly name: string;
  readonly editToken: string;
  readonly viewToken: string;
}

/** `GET /api/rooms/:id` response for a valid token. */
export interface RoomInfoResponse {
  readonly id: string;
  readonly name: string;
  readonly role: RoomRole;
}

/** Error body of every failed API call. */
export interface ApiErrorResponse {
  readonly error: string;
}

/** Identity a client asks for on the WebSocket. */
export interface ConnectionUser {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** What the client puts in the Hocuspocus `token`. */
export interface ConnectionToken {
  /** Room token from the share link. */
  readonly token: string;
  readonly user: ConnectionUser;
}

/** Longest display name, in characters. */
export const MAX_USER_NAME = 40;
/** Longest room name, in characters. */
export const MAX_ROOM_NAME = 80;

export const USER_ID = /^[a-z0-9-]{1,64}$/;
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** Room IDs as the server generates them. */
export const ROOM_ID = /^[a-z0-9]{12}$/;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Text without control characters, trimmed to `max` characters. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, '').trim().slice(0, max);
}

export function encodeConnectionToken(value: ConnectionToken): string {
  return JSON.stringify(value);
}

/** Parses a Hocuspocus token; `null` when it is malformed. */
export function parseConnectionToken(raw: string): ConnectionToken | null {
  if (raw.length > 2048) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { token, user } = value as { token?: unknown; user?: Record<string, unknown> };
  if (typeof token !== 'string' || typeof user !== 'object' || user === null) return null;
  const name = cleanText(user.name, MAX_USER_NAME);
  if (typeof user.id !== 'string' || !USER_ID.test(user.id) || name === '') return null;
  if (typeof user.color !== 'string' || !HEX_COLOR.test(user.color)) return null;
  return { token, user: { id: user.id, name, color: user.color } };
}

/** Share link fragment: `#room=<id>,<token>`. The fragment never reaches servers or logs. */
export function roomHash(id: string, token: string): string {
  return `#room=${id},${token}`;
}

/** Reads `#room=<id>,<token>`; `null` when the fragment has no valid room. */
export function parseRoomHash(hash: string): { id: string; token: string } | null {
  const match = /^#room=([a-z0-9]{12}),([A-Za-z0-9_-]{16,256})$/.exec(hash);
  return match ? { id: match[1]!, token: match[2]! } : null;
}
