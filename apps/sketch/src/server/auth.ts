/**
 * WebSocket authentication: the client sends its room token together with the name and color it
 * picked, as JSON in the Hocuspocus `token` (see `shared/protocol.ts`). The room token decides edit
 * or view; the identity is cleaned here and then enforced on the connection's presence by the
 * server guards (BOARD-2009), so nobody can show up as someone else.
 */

import {
  UnauthorizedError,
  type AuthResult,
  type AuthVerifier,
} from '@kujam/example-hocuspocus-server/auth';
import { parseConnectionToken } from '../shared/protocol.js';
import type { RoomStore } from './rooms.js';

/** Verifier for `createCollaborationServer`: the document name is the room ID. */
export function createRoomVerifier(rooms: RoomStore): AuthVerifier {
  return (raw: string, documentName: string): AuthResult => {
    const parsed = parseConnectionToken(raw);
    const room = parsed ? rooms.verify(documentName, parsed.token) : null;
    if (!parsed || !room) throw new UnauthorizedError('Link room tidak valid atau sudah dicabut.');
    return { user: parsed.user, readOnly: room.role === 'view' };
  };
}
