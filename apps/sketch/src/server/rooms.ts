/**
 * Rooms: a shared board with two secret links, one to edit and one to view.
 *
 * Only SHA-256 hashes of the tokens are stored, so a leaked database does not leak working links.
 * The tokens themselves are shown once, to whoever creates the room.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { cleanText, MAX_ROOM_NAME, ROOM_ID, type RoomRole } from '../shared/protocol.js';

/** A new room with its tokens, returned once at creation. */
export interface CreatedRoom {
  readonly id: string;
  readonly name: string;
  readonly editToken: string;
  readonly viewToken: string;
  readonly createdAt: number;
}

/** Public facts about a room, for someone holding one of its tokens. */
export interface RoomInfo {
  readonly id: string;
  readonly name: string;
  readonly role: RoomRole;
  readonly createdAt: number;
}

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/** Matches `ROOM_ID`: lowercase letters and digits without look-alikes. */
const ID_LENGTH = 12;

function randomId(): string {
  const bytes = randomBytes(ID_LENGTH);
  let id = '';
  // 256 is a multiple of the 32-letter alphabet, so every letter is equally likely.
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}

function randomToken(): string {
  return randomBytes(24).toString('base64url');
}

function hash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function sameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

interface Row {
  id: string;
  name: string;
  edit_hash: Buffer;
  view_hash: Buffer;
  created_at: number;
}

/** SQLite table of rooms. */
export class RoomStore {
  private readonly db: Database.Database;

  /** @param path - SQLite file, or `':memory:'`. The same file as the documents is fine. */
  constructor(
    path = ':memory:',
    private readonly now: () => number = Date.now,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sketch_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        edit_hash BLOB NOT NULL,
        view_hash BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  /** Creates a room; the tokens in the result are not stored and cannot be read again. */
  create(name: unknown): CreatedRoom {
    const room = {
      id: randomId(),
      name: cleanText(name, MAX_ROOM_NAME) || 'Papan tanpa judul',
      editToken: randomToken(),
      viewToken: randomToken(),
      createdAt: this.now(),
    };
    this.db
      .prepare(
        'INSERT INTO sketch_rooms (id, name, edit_hash, view_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(room.id, room.name, hash(room.editToken), hash(room.viewToken), room.createdAt);
    return room;
  }

  /** The room and the role `token` gives in it, or `null` for an unknown room or a wrong token. */
  verify(id: unknown, token: unknown): RoomInfo | null {
    if (typeof id !== 'string' || !ROOM_ID.test(id)) return null;
    if (typeof token !== 'string' || token.length === 0 || token.length > 256) return null;
    const row = this.db.prepare('SELECT * FROM sketch_rooms WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) return null;
    const given = hash(token);
    // Both comparisons always run, so timing does not tell which token was close.
    const edit = sameHash(given, row.edit_hash);
    const view = sameHash(given, row.view_hash);
    if (!edit && !view) return null;
    return { id: row.id, name: row.name, role: edit ? 'edit' : 'view', createdAt: row.created_at };
  }

  close(): void {
    this.db.close();
  }
}
