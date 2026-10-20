/**
 * Server-side guards against hostile clients (BOARD-2009, BOARD-2010; ADR-009 T2 and T4).
 *
 * - Message size and rate limits per connection, checked before a message is handled.
 * - Awareness: a connection may only write its own Yjs client IDs, and its `user` is replaced by
 *   the identity from `onAuthenticate`, so nobody can impersonate or overwrite another user.
 * - Documents: after every change, records that fail validation are put back to their last valid
 *   version (or removed when they never had one), so the stored document stays valid. Clients do
 *   the same on their side (BOARD-2004); this keeps the server copy clean for everyone.
 */

import type * as Y from 'yjs';
import {
  DEFAULT_BOARD_LIMITS,
  validateDocument,
  type BoardRecord,
  type DocumentPropsValidator,
  type ValidateDocumentOptions,
  type ValidationResult,
} from '@kujam/core';
import { recordToYMap, yDocToDocument } from '@kujam/sync-yjs';
import type { AuthResult } from './auth.js';

/** Transaction origin of the server's own repairs, so they are not validated again. */
export const REPAIR_ORIGIN = Symbol('kujam.server.repair');

/** Limits applied to each connection. */
export interface GuardLimits {
  /** Largest inbound message in bytes. Defaults to the board's 10 MB document limit. */
  readonly maxMessageBytes: number;
  /** Most inbound messages per connection within `rateWindowMs`. Defaults to 300. */
  readonly maxMessagesPerWindow: number;
  /** Rate limit window in milliseconds. Defaults to 1000. */
  readonly rateWindowMs: number;
}

export const DEFAULT_GUARD_LIMITS: Readonly<GuardLimits> = Object.freeze({
  maxMessageBytes: DEFAULT_BOARD_LIMITS.maxDocumentBytes,
  maxMessagesPerWindow: 300,
  rateWindowMs: 1000,
});

/** Error thrown to reject a message; Hocuspocus then drops it and closes the connection. */
export class GuardError extends Error {
  constructor(
    readonly code: 'message-too-large' | 'rate-limited',
    message: string,
  ) {
    super(message);
    this.name = 'GuardError';
  }
}

type Context = { user: AuthResult['user']; readOnly: boolean } | undefined;

export interface GuardOptions {
  readonly limits?: Partial<GuardLimits>;
  readonly validatorRegistry?: DocumentPropsValidator;
  readonly validationLimits?: ValidateDocumentOptions;
  /** Called with the validation result when a change had to be repaired. */
  readonly onRepair?: (
    documentName: string,
    validation: ValidationResult,
    repairedIds: string[],
  ) => void;
  /** Clock, for tests. */
  readonly now?: () => number;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function createGuards(options: GuardOptions = {}) {
  const limits: GuardLimits = { ...DEFAULT_GUARD_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const rate = new Map<string, { start: number; count: number }>();
  /** Per document: Yjs client ID → socket that first wrote it. */
  const owners = new Map<string, Map<number, string>>();
  /** Per document: last valid version of every record. */
  const lastValid = new Map<string, Map<string, BoardRecord>>();

  function checkMessage(socketId: string, bytes: number): void {
    if (bytes > limits.maxMessageBytes) {
      throw new GuardError(
        'message-too-large',
        `Message of ${bytes} bytes exceeds ${limits.maxMessageBytes} bytes.`,
      );
    }
    const t = now();
    const entry = rate.get(socketId);
    if (!entry || t - entry.start >= limits.rateWindowMs) {
      rate.set(socketId, { start: t, count: 1 });
      return;
    }
    entry.count++;
    if (entry.count > limits.maxMessagesPerWindow) {
      throw new GuardError(
        'rate-limited',
        `More than ${limits.maxMessagesPerWindow} messages in ${limits.rateWindowMs} ms.`,
      );
    }
  }

  /**
   * Keeps only the awareness states this socket owns, with the authenticated user.
   * A client ID belongs to the first socket that writes it, until that socket disconnects.
   */
  function guardAwareness(
    documentName: string,
    socketId: string,
    context: Context,
    states: Map<number, Record<string, unknown>>,
    removedClients: Set<number>,
  ): void {
    let docOwners = owners.get(documentName);
    if (!docOwners) owners.set(documentName, (docOwners = new Map()));
    for (const clientId of [...states.keys()]) {
      const owner = docOwners.get(clientId);
      if (owner === undefined) docOwners.set(clientId, socketId);
      else if (owner !== socketId) {
        states.delete(clientId);
        continue;
      }
      const state = states.get(clientId);
      if (state && context?.user) {
        const claimed = (state.user ?? {}) as Record<string, unknown>;
        const color =
          context.user.color ??
          (typeof claimed.color === 'string' && HEX_COLOR.test(claimed.color)
            ? claimed.color
            : '#888888');
        state.user = {
          id: context.user.id,
          name: context.user.name,
          color,
          ...(context.user.avatar ? { avatar: context.user.avatar } : {}),
        };
      }
    }
    for (const clientId of [...removedClients]) {
      const owner = docOwners.get(clientId);
      if (owner !== undefined && owner !== socketId) removedClients.delete(clientId);
      else docOwners.delete(clientId);
    }
  }

  function releaseSocket(socketId: string): void {
    rate.delete(socketId);
    for (const docOwners of owners.values()) {
      for (const [clientId, owner] of docOwners) if (owner === socketId) docOwners.delete(clientId);
    }
  }

  /** Remembers the valid records of a freshly loaded document. */
  function rememberValid(documentName: string, doc: Y.Doc): void {
    const boardDoc = yDocToDocument(doc);
    const validation = validateDocument(
      boardDoc,
      options.validatorRegistry,
      options.validationLimits,
    );
    const valid = new Map<string, BoardRecord>();
    for (const [id, record] of Object.entries(boardDoc.records)) {
      if (!validation.invalidRecords[id]) valid.set(id, record);
    }
    lastValid.set(documentName, valid);
  }

  /**
   * Validates `doc` after a change. Invalid records go back to their last valid version, or are
   * removed when they have none; elements added past `maxElements` are removed. Returns the
   * validation result before the repair.
   */
  function repair(
    documentName: string,
    doc: Y.Doc,
  ): { validation: ValidationResult; repaired: string[] } {
    const boardDoc = yDocToDocument(doc);
    const validation = validateDocument(
      boardDoc,
      options.validatorRegistry,
      options.validationLimits,
    );
    let valid = lastValid.get(documentName);
    if (!valid) lastValid.set(documentName, (valid = new Map()));

    const records = doc.getMap<Y.Map<unknown>>('records');
    // Malformed records (for example a non-number coordinate) are left out of `boardDoc` by the
    // conversion, so they count as invalid too.
    const repairIds = Object.keys(validation.invalidRecords);
    for (const id of records.keys()) {
      if (!(id in boardDoc.records) && !repairIds.includes(id)) repairIds.push(id);
    }
    const maxElements =
      options.validationLimits?.limits?.maxElements ?? DEFAULT_BOARD_LIMITS.maxElements;
    const elements = Object.values(boardDoc.records).filter((r) => r.kind === 'element');
    if (elements.length > maxElements) {
      // Too many elements: drop the ones the server has not accepted before.
      for (const el of elements)
        if (!valid.has(el.id) && !repairIds.includes(el.id)) repairIds.push(el.id);
    }

    for (const [id, record] of Object.entries(boardDoc.records)) {
      if (!repairIds.includes(id)) valid.set(id, record);
    }
    for (const id of [...valid.keys()]) if (!records.has(id)) valid.delete(id);

    if (repairIds.length > 0) {
      doc.transact(() => {
        for (const id of repairIds) {
          const previous = valid.get(id);
          const yMap = records.get(id);
          if (previous && yMap) recordToYMap(previous, yMap);
          else records.delete(id);
        }
      }, REPAIR_ORIGIN);
    }
    return { validation, repaired: repairIds };
  }

  function forgetDocument(documentName: string): void {
    owners.delete(documentName);
    lastValid.delete(documentName);
  }

  return {
    limits,
    checkMessage,
    guardAwareness,
    releaseSocket,
    rememberValid,
    repair,
    forgetDocument,
  };
}
